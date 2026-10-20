// GET /api/contents/:id —— 作品详情（含版本计数、Remix 血缘、溯源尾部）
// DELETE /api/contents/:id —— 删除作品（Owner 硬删除：级联清关联 + 孤儿文件回收）
import { getSessionUser, requireSessionUser, domainErrorToResponse } from '../../_lib/session'
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

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user } = await requireSessionUser()
    const deleted = await contentService.deleteContent(id, user.id)
    return Response.json({
      ...deleted,
      message: '作品已删除，画面、配音与任务记录一并清理。',
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
