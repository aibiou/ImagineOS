// POST /api/contents/:id/render —— 渲染成片（REVIEW→RENDERING + 合成 Job 入队）
import { requireSessionUser, domainErrorToResponse } from '../../../_lib/session'
import { generationFlow } from '@/core/content/generation-flow'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user } = await requireSessionUser()
    const result = await generationFlow.startRender(id, user.id)
    return Response.json({
      jobId: result.jobId,
      message: '正在把画面、声音与字幕合成为一支完整的视频。',
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
