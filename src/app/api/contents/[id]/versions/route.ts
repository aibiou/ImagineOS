// GET  /api/contents/:id/versions —— 版本时间线（§25）
// POST /api/contents/:id/versions —— 创建新版本（修订永不覆盖 §24）
import { getSessionUser, domainErrorToResponse, readJson } from '../../../_lib/session'
import { contentService } from '@/core/content/content-service'
import { versionService } from '@/core/content/version-service'
import { CreateVersionInputSchema } from '@/core/content/schemas'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getSessionUser()
    const { content, isOwner } = await contentService.getOwnedOrVisibleContent(id, user?.id ?? null)
    if (!isOwner && content.visibility === 'private') {
      return Response.json({ error: 'not_found', message: '作品不存在' }, { status: 404 })
    }
    const versions = await versionService.listTimeline(id)
    return Response.json({ versions })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await readJson<unknown>(req)
    const parsed = CreateVersionInputSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return Response.json(
        { error: 'invalid_input', message: parsed.error.issues[0]?.message ?? '输入无效' },
        { status: 400 },
      )
    }
    const user = await getSessionUser()
    if (!user) {
      return Response.json({ error: 'no_session', message: '请先开始一次创作以建立会话' }, { status: 401 })
    }
    const version = await versionService.createVersion(id, user.id, parsed.data)
    return Response.json(
      {
        versionId: version.id,
        versionNumber: version.versionNumber,
        creationMethod: version.creationMethod,
        changelog: version.changelog,
      },
      { status: 201 },
    )
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
