// GET /api/contents/:id —— 作品详情（含版本计数、Remix 血缘、溯源尾部）
import { getSessionUser, domainErrorToResponse } from '../../_lib/session'
import { contentService } from '@/core/content/content-service'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getSessionUser()
    const bundle = await contentService.getContentBundle(id, user?.id ?? null)
    return Response.json(bundle)
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
