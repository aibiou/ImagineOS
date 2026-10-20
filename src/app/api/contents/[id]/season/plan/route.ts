// POST /api/contents/:id/season/plan —— 连续剧季规划（serial-season-027 §6）
// 入队 season.plan 计算型 Job 即返回 { jobId }；结果（分集几何 + 季圣经摘要 + 剧集列表）存
// Job.outputJson，前端轮询 GET /season/plan?jobId= 取用（仿 revision.plan 范式）。
// 语义：
//   - 幂等：已有 Season → { alreadyPlanned: true }（附季视图）；有活跃 Job → 复用
//   - 诚实拒绝：总时长 < 240 秒 → 422（单集作品走常规流程，不静默降级）
// GET —— 轮询 Job 状态与产出；无 jobId 时返回当前季视图（集列表 + 各集状态）。
import { requireSessionUser, domainErrorToResponse } from '../../../../_lib/session'
import { intentService } from '@/core/intent/intent-service'
import { jobService } from '@/core/jobs/job-service'
import { seasonService } from '@/core/planning/season-service'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user } = await requireSessionUser()
    const content = await intentService.requireContent(id)
    if (content.ownerId !== user.id) {
      return Response.json({ error: 'permission_denied', message: '只有作者可以规划这个作品' }, { status: 403 })
    }
    const { jobId, alreadyRunning, alreadyPlanned } = await seasonService.startSeasonPlan(id, user.id)
    return Response.json({ jobId, alreadyRunning, alreadyPlanned })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user } = await requireSessionUser()
    const content = await intentService.requireContent(id)
    if (content.ownerId !== user.id) {
      return Response.json({ error: 'permission_denied', message: '只有作者可以查看这个季' }, { status: 403 })
    }
    const jobId = new URL(req.url).searchParams.get('jobId')
    if (jobId) {
      const job = await jobService.getJob(jobId)
      if (!job || job.contentId !== id) {
        return Response.json({ error: 'not_found', message: '季规划任务不存在' }, { status: 404 })
      }
      const output = job.outputJson ? (JSON.parse(job.outputJson) as Record<string, unknown>) : {}
      return Response.json({
        jobId: job.id,
        type: job.type,
        status: job.status,
        createdAt: job.createdAt,
        ...(job.status === 'succeeded'
          ? {
              seasonId: output.seasonId ?? null,
              anchorHash: output.anchorHash ?? null,
              episodeCount: output.episodeCount ?? null,
              episodeSec: output.episodeSec ?? null,
              totalSec: output.totalSec ?? null,
              seasonLogline: output.seasonLogline ?? null,
              episodeContentIds: output.episodeContentIds ?? [],
              label: output.label ?? null,
            }
          : {}),
        ...(job.status === 'failed' || job.status === 'timeout' ? { error: job.error ?? '季规划没有成功' } : {}),
      })
    }
    // 无 jobId：直接返回季视图（未规划 → { season: null } 诚实缺席）
    const view = await seasonService.getSeasonView(id)
    return Response.json({ season: view })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
