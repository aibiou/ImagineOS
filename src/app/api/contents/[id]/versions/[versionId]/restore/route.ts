// POST /api/contents/:id/versions/:versionId/restore —— 恢复历史版本（§25）
import { getSessionUser, domainErrorToResponse } from '../../../../../_lib/session'
import { versionService } from '@/core/content/version-service'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const { id, versionId } = await params
    const user = await getSessionUser()
    if (!user) {
      return Response.json({ error: 'no_session', message: '请先开始一次创作以建立会话' }, { status: 401 })
    }
    const version = await versionService.restoreVersion(id, versionId, user.id)
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
