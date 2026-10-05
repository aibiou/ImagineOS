// POST /api/contents/:id/remix —— Remix（§35）：新 Content + 新 Version + 血缘三件套，原作零改动
import { requireSessionUser, domainErrorToResponse } from '../../../_lib/session'
import { forkService } from '@/core/content/fork-service'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user } = await requireSessionUser()
    const result = await forkService.forkContent({ sourceContentId: id, newOwnerId: user.id })
    return Response.json(
      {
        contentId: result.content.id,
        title: result.content.title,
        status: result.content.status,
        remixId: result.remix.id,
        sourceContentId: result.remix.sourceContentId,
        sourceVersionId: result.remix.sourceVersionId,
        message: `已基于《${result.remix.sourceContentId}》创建你的 Remix 副本，进入你的创作循环。`,
      },
      { status: 201 },
    )
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
