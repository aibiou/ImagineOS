// POST /api/contents/:id/story —— 生成故事（叙述弧+场景）→ PLANNING→STORY（E4 / §19）
// 2026-10-09 异步化：入队 story.draft Job 即返回（§53 绝不长请求挂生成）。
// 故事展开是分钟级 LLM 调用（含 429 冷却重试）——同步挂 HTTP 会造成前端裸转圈、
// 断连僵死（需手动刷新）、刷新重复烧配额。进度与完成由前端轮询 /creation 接续。
import { requireSessionUser, domainErrorToResponse } from '../../../_lib/session'
import { intentService } from '@/core/intent/intent-service'
import { planService } from '@/core/planning/plan-service'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user } = await requireSessionUser()
    const content = await intentService.requireContent(id)
    if (content.ownerId !== user.id) {
      return Response.json({ error: 'permission_denied', message: '只有作者可以继续这个创作' }, { status: 403 })
    }

    const result = await planService.startStoryDraft(id, user.id)

    return Response.json({
      jobId: result.jobId,
      status: 'PLANNING',
      message: result.alreadyRunning
        ? 'AI 编剧正在写，稍候就好——这里完成后会自动出现。'
        : 'AI 编剧已开工：正在展开你的故事，完成后这里会自动出现。',
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
