// POST /api/contents/:id/intent —— Intent Engine 编译（E3 主链第一环）
// body: { answers?: string[]（访谈答案）, confirm?: boolean }
// 行为：抽取/合并 → 持久化 → 有澄清问题且未确认 → 返回问题（停留 IDEA）；确认 → IDEA→INTENT
import { requireSessionUser, domainErrorToResponse, readJson } from '../../../_lib/session'
import { intentService } from '@/core/intent/intent-service'
import { contentService } from '@/core/content/content-service'
import { extractIntent } from '@/ai/intent/engine'
import { z } from 'zod'

const BodySchema = z.object({
  answers: z.array(z.string().trim().max(500)).max(3).optional(),
  confirm: z.boolean().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await readJson<unknown>(req)
    const parsed = BodySchema.safeParse(body ?? {})
    if (!parsed.success) {
      return Response.json({ error: 'invalid_input', message: '输入无效' }, { status: 400 })
    }
    const { user } = await requireSessionUser()
    const content = await intentService.requireContent(id)
    if (content.ownerId !== user.id) {
      return Response.json({ error: 'permission_denied', message: '只有作者可以继续这个创作' }, { status: 403 })
    }
    if (content.status !== 'IDEA') {
      return Response.json({ error: 'illegal_transition', message: '这一步已经完成，继续下一步吧' }, { status: 422 })
    }

    const rawExpression = await intentService.requireRawExpression(id)
    // 已问过的问题（访谈状态）
    const intentRow = await intentService.getIntent(id)
    let asked: string[] = []
    try {
      const prev = intentRow?.fieldsJson ? (JSON.parse(intentRow.fieldsJson) as { interview?: { asked?: string[] } }) : null
      asked = prev?.interview?.asked ?? []
    } catch {
      asked = []
    }

    const extraction = await extractIntent(
      { rawExpression, answers: parsed.data.answers, askedQuestions: asked },
      { contentId: id, purpose: 'intent.extract', actorId: user.id },
    )

    await intentService.saveExtracted(id, extraction.record, {
      provider: extraction.provider ?? 'intent-engine',
      model: extraction.model ?? 'default',
      degraded: extraction.degraded,
      actorId: user.id,
    })

    const hasNewQuestions = extraction.questions.length > 0 && !parsed.data.confirm
    if (!hasNewQuestions || parsed.data.confirm) {
      await contentService.advanceStatus(id, 'INTENT', user.id)
      return Response.json({
        status: 'INTENT',
        record: extraction.record,
        questions: [],
        degraded: extraction.degraded,
        message: '我理解了你的表达。接下来给你几个创作方向。',
      })
    }

    return Response.json({
      status: 'IDEA',
      record: extraction.record,
      questions: extraction.questions,
      degraded: extraction.degraded,
      message: '还有几个小问题想确认（也可以跳过，交给我来定）。',
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
