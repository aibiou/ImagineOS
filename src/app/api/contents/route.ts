// GET /api/contents?scope=mine|explore
// mine：我的创作（Projects 雏形 §36）；explore：公开已发布（§39）
import { getSessionUser, domainErrorToResponse } from '../_lib/session'
import { contentService } from '@/core/content/content-service'

export async function GET(req: Request) {
  try {
    const scope = new URL(req.url).searchParams.get('scope') ?? 'mine'
    if (scope === 'explore') {
      const items = await contentService.listExplore()
      return Response.json({ scope, items })
    }
    const user = await getSessionUser()
    if (!user) return Response.json({ scope, items: [], anonymous: true })
    const items = await contentService.listMyContents(user.id)
    return Response.json({ scope, items })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
