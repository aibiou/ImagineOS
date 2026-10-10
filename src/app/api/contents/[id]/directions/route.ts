// POST /api/contents/:id/directions —— 生成 2–4 个创作方向（E4 / §18）
// 2026-10-10 异步化（025 战线二）：入队 intent.directions Job 即返回（§53 绝不长请求挂生成
// 的最后一处同步死角）。方向由前端轮询 /creation 接续；完成落库于 planService.saveDirections。
// body: { regenerate?: boolean } —— regenerate=true 整批换新（旧批仍在跑时幂等复用，语义诚实）
import { requireSessionUser, domainErrorToResponse, readJson } from '../../../_lib/session'
import { intentService } from '@/core/intent/intent-service'
import { planService } from '@/core/planning/plan-service'
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

    const { jobId, alreadyRunning } = await planService.startDirections(id, user.id)
    return Response.json({
      jobId,
      alreadyRunning,
      message: alreadyRunning
        ? '这批方向还在构思中，马上就好。'
        : parsed.data.regenerate
          ? '正在重新构思一批方向。'
          : '正在为你构思创作方向。',
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
