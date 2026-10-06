// POST /api/contents/:id/directions/select —— 选定方向，冻结 Concept（§18）→ PLANNING
import { requireSessionUser, domainErrorToResponse, readJson } from '../../../../_lib/session'
import { intentService } from '@/core/intent/intent-service'
import { planService } from '@/core/planning/plan-service'
import { z } from 'zod'

const BodySchema = z.object({ directionId: z.string().trim().min(1) })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await readJson<unknown>(req)
    const parsed = BodySchema.safeParse(body ?? {})
    if (!parsed.success) {
      return Response.json(
        { error: 'invalid_input', message: parsed.error.issues[0]?.message ?? '输入无效' },
        { status: 400 },
      )
    }
    const { user } = await requireSessionUser()
    const content = await intentService.requireContent(id)
    if (content.ownerId !== user.id) {
      return Response.json({ error: 'permission_denied', message: '只有作者可以继续这个创作' }, { status: 403 })
    }
    if (content.status !== 'INTENT') {
      return Response.json({ error: 'illegal_transition', message: '先挑选一个创作方向' }, { status: 422 })
    }

    const direction = await planService.selectDirection(id, parsed.data.directionId, user.id)
    return Response.json({
      concept: {
        directionId: direction.id,
        name: direction.name,
        oneLiner: direction.oneLiner,
        emotion: direction.emotion,
        visualDirection: direction.visualDirection,
      },
      status: 'PLANNING',
      message: `方向已锁定：「${direction.name}」。接下来展开故事。`,
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
