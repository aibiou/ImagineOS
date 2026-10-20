// POST /api/contents/:id/revision/plan —— 修订定位（R3 缓解：返回"我将修改 X"确认点）
// 2026-10-10 异步化（025 战线二）：入队 revision.plan 计算型 Job 即返回 { jobId }——
// plan+structure+feedback 存 Job.outputJson，前端轮询 GET /revision/plan?jobId= 取结果。
// 并发语义（supersede）：同 feedback 复用活跃 Job；不同 feedback → 取代旧 Job 入新 Job
// （用户改了反馈重新提交，永远拿新反馈的结果）。
// GET —— 轮询 Job 状态与产出（计算型 Job 的结果通道，不进 /creation 聚合）。
import { requireSessionUser, domainErrorToResponse, readJson } from '../../../../_lib/session'
import { intentService } from '@/core/intent/intent-service'
import { planService } from '@/core/planning/plan-service'
import { jobService } from '@/core/jobs/job-service'
import { z } from 'zod'

const BodySchema = z.object({ feedback: z.string().trim().min(2, '想怎么改？用一句话说说。').max(300) })

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
      return Response.json({ error: 'permission_denied', message: '只有作者可以修改这个作品' }, { status: 403 })
    }
    if (!content.currentVersionId) {
      return Response.json({ error: 'domain_validation', message: '先完成一次生成，再修改' }, { status: 422 })
    }

    const { jobId, alreadyRunning, supersededJobId } = await planService.startRevisionPlan(
      id,
      parsed.data.feedback,
      user.id,
    )
    return Response.json({
      jobId,
      alreadyRunning,
      supersededJobId,
      feedback: parsed.data.feedback,
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const jobId = new URL(req.url).searchParams.get('jobId')
    if (!jobId) return Response.json({ error: 'invalid_input', message: '缺少 jobId' }, { status: 400 })
    const { user } = await requireSessionUser()
    const content = await intentService.requireContent(id)
    if (content.ownerId !== user.id) {
      return Response.json({ error: 'permission_denied', message: '只有作者可以查看这个修订' }, { status: 403 })
    }
    const job = await jobService.getJob(jobId)
    if (!job || job.contentId !== id) {
      return Response.json({ error: 'not_found', message: '修订任务不存在' }, { status: 404 })
    }
    const output = job.outputJson ? (JSON.parse(job.outputJson) as Record<string, unknown>) : {}
    return Response.json({
      jobId: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      ...(job.status === 'succeeded'
        ? { plan: output.plan ?? null, structure: output.structure ?? null, feedback: output.feedback ?? null }
        : {}),
      ...(job.status === 'failed' || job.status === 'timeout' ? { error: job.error ?? '修订没有成功' } : {}),
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
