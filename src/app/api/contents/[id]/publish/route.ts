// POST /api/contents/:id/publish —— 最小发布（E10-lite：状态+Publication+可见性；完整表单属 M3）
import { getSessionUser, domainErrorToResponse, readJson } from '../../../_lib/session'
import { contentService } from '@/core/content/content-service'
import { PublishInputSchema } from '@/core/content/schemas'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await readJson<unknown>(req)
    const parsed = PublishInputSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return Response.json({ error: 'invalid_input', message: parsed.error.issues[0]?.message ?? '输入无效' }, { status: 400 })
    }
    const user = await getSessionUser()
    if (!user) {
      return Response.json({ error: 'no_session', message: '请先开始一次创作以建立会话' }, { status: 401 })
    }
    const updated = await contentService.publishMinimal(id, user.id, parsed.data)
    return Response.json({ contentId: updated.id, status: updated.status, visibility: updated.visibility })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
