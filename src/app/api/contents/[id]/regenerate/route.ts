// POST /api/contents/:id/regenerate —— 重新生成（REVIEW/READY：同版本重跑，T9.1.1）
import { requireSessionUser, domainErrorToResponse } from '../../../_lib/session'
import { generationFlow } from '@/core/content/generation-flow'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user } = await requireSessionUser()
    const result = await generationFlow.regenerate(id, user.id)
    return Response.json({
      ...result,
      message: '换一批画面重新来过——版本历史都还在。',
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
