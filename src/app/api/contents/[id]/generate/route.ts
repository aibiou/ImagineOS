// POST /api/contents/:id/generate —— 开始 AI 生成（STORYBOARD→GENERATING + Job 入队）
// HTTP 快速返回（§53）：进度经 GET /api/contents/:id/creation 轮询
import { requireSessionUser, domainErrorToResponse } from '../../../_lib/session'
import { generationFlow } from '@/core/content/generation-flow'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user } = await requireSessionUser()
    const result = await generationFlow.startStoryboardGeneration(id, user.id)
    return Response.json({
      ...result,
      message: 'AI 创作团队开工了：先画每个镜头的画面，再配音。',
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
