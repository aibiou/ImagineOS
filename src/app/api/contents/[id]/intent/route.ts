// POST /api/contents/:id/intent —— Intent Engine 编译（E3 主链第一环）
// body: { answers?: string[]（访谈答案）, confirm?: boolean, aspectRatio?: '9:16'|'16:9'（画幅直改，零 LLM） }
// 行为：抽取/合并 → 持久化 → 有澄清问题且未确认 → 返回问题（停留 IDEA）；确认 → IDEA→INTENT
// 画幅直改：仅携带 aspectRatio（无 answers/confirm）时走轻量补丁——改 IntentRecord.fields/sources 后直接持久化，
// 不触发 LLM（IdeaStage 画幅切换钮；来源标 user——用户明确指定）。
import { requireSessionUser, domainErrorToResponse, readJson } from '../../../_lib/session'
import { intentService } from '@/core/intent/intent-service'
import { contentService } from '@/core/content/content-service'
import { extractIntent } from '@/ai/intent/engine'
import { AspectRatioSchema } from '@/core/content/schemas'
import { z } from 'zod'

const BodySchema = z.object({
  answers: z.array(z.string().trim().max(500)).max(3).optional(),
  confirm: z.boolean().optional(),
  aspectRatio: AspectRatioSchema.optional(),
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

    // ---- 画幅直改通道（零 LLM）：仅 aspectRatio、无 answers/confirm ----
    const aspectOnly =
      parsed.data.aspectRatio != null && !parsed.data.confirm && !(parsed.data.answers?.length)
    if (aspectOnly) {
      const record = intentRow ? intentService.parseRecord(intentRow) : null
      if (!record) {
        return Response.json(
          { error: 'not_ready', message: 'AI 还在理解你的表达，稍等一下再选画幅。' },
          { status: 409 },
        )
      }
      record.fields.aspectRatio = parsed.data.aspectRatio
      record.sources.aspectRatio = 'user'
      await intentService.saveExtracted(id, record, {
        provider: 'intent-engine',
        model: 'aspect-patch',
        degraded: false,
        actorId: user.id,
      })
      return Response.json({
        status: 'IDEA',
        record,
        questions: [],
        message: parsed.data.aspectRatio === '16:9' ? '已切换为横屏 16:9。' : '已切换为竖屏 9:16。',
      })
    }

    const extraction = await extractIntent(
      { rawExpression, answers: parsed.data.answers, askedQuestions: asked },
      { contentId: id, purpose: 'intent.extract', actorId: user.id },
    )

    // 画幅（用户意志的持久性——两道防线）：
    //   1. 本轮显式覆盖（UI 直改钮与抽取同轮提交）：用户意志优先于 LLM 猜测；
    //   2. 历史用户选择持久：confirm/answers 轮重新抽取时，LLM 可能把用户已切换的画幅
    //      重置回默认——若上一记录 sources.aspectRatio === 'user' 且本轮无显式覆盖，则原样保留。
    if (parsed.data.aspectRatio != null) {
      extraction.record.fields.aspectRatio = parsed.data.aspectRatio
      extraction.record.sources.aspectRatio = 'user'
    } else {
      const prevRecord = intentRow ? intentService.parseRecord(intentRow) : null
      if (prevRecord?.sources.aspectRatio === 'user' && prevRecord.fields.aspectRatio) {
        extraction.record.fields.aspectRatio = prevRecord.fields.aspectRatio
        extraction.record.sources.aspectRatio = 'user'
      }
    }

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
