// POST /api/contents/:id/status —— 创作状态机推进（唯一合法入口，§51）
import { getSessionUser, domainErrorToResponse, readJson } from '../../../_lib/session'
import { contentService } from '@/core/content/content-service'
import { AdvanceStatusInputSchema } from '@/core/content/schemas'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await readJson<unknown>(req)
    const parsed = AdvanceStatusInputSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return Response.json({ error: 'invalid_input', message: '缺少目标状态 to' }, { status: 400 })
    }
    const user = await getSessionUser()
    if (!user) {
      return Response.json({ error: 'no_session', message: '请先开始一次创作以建立会话' }, { status: 401 })
    }
    const content = await contentService.getOwnedOrVisibleContent(id, user.id)
    if (!content.isOwner) {
      return Response.json({ error: 'permission_denied', message: '只有作者可以推进创作状态' }, { status: 403 })
    }
    const updated = await contentService.advanceStatus(id, parsed.data.to, user.id)
    return Response.json({ contentId: updated.id, status: updated.status })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
