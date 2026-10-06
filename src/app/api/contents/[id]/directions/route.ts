// POST /api/contents/:id/directions —— 生成 2–4 个创作方向（E4 / §18）
// body: { regenerate?: boolean } —— regenerate=true 整批换新
import { requireSessionUser, domainErrorToResponse, readJson } from '../../../_lib/session'
import { intentService } from '@/core/intent/intent-service'
import { planService } from '@/core/planning/plan-service'
import { generateDirections } from '@/ai/planning/directions'
import { z } from 'zod'

const BodySchema = z.object({ regenerate: z.boolean().optional() })

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
    if (content.status !== 'INTENT') {
      return Response.json({ error: 'illegal_transition', message: '先确认你的表达，再挑选创作方向' }, { status: 422 })
    }

    const record = await intentService.requireRecord(id)
    const directions = await generateDirections(record, {
      contentId: id,
      versionId: content.currentVersionId,
      purpose: 'directions.generate',
      actorId: user.id,
    })
    await planService.saveDirections(id, directions, user.id)

    return Response.json({
      directions,
      message: parsed.data.regenerate ? '换了一批新方向。' : '为你准备了几个创作方向，挑一个你心动的。',
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
