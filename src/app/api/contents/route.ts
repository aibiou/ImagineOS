// GET /api/contents?scope=mine|explore
// mine：我的创作（Projects 雏形 §36）；explore：公开已发布（§39）
// M1（评审 P0-1）：列表项携带视觉资产（poster/video/duration）——视觉内容是卡片第一元素
import { getSessionUser, domainErrorToResponse } from '../_lib/session'
import { contentService } from '@/core/content/content-service'
import { assetService } from '@/core/assets/asset-service'

function withVisuals(
  items: Array<Record<string, unknown> & { id: string; currentVersionId: string | null }>,
  visuals: Map<string, { finalAssetId: string | null; posterAssetId: string | null; durationMs: number | null }>,
) {
  return items.map((item) => {
    const v = visuals.get(item.id)
    return {
      ...item,
      posterUrl: v?.posterAssetId ? `/api/assets/${v.posterAssetId}` : null,
      videoUrl: v?.finalAssetId ? `/api/assets/${v.finalAssetId}` : null,
      durationMs: v?.durationMs ?? null,
    }
  })
}

export async function GET(req: Request) {
  try {
    const scope = new URL(req.url).searchParams.get('scope') ?? 'mine'
    if (scope === 'explore') {
      const items = await contentService.listExplore()
      const visuals = await assetService.visualsForContents(
        items.map((c) => ({ id: c.id, currentVersionId: c.currentVersionId })),
      )
      return Response.json({ scope, items: withVisuals(items as never, visuals) })
    }
    const user = await getSessionUser()
    if (!user) return Response.json({ scope, items: [], anonymous: true })
    const items = await contentService.listMyContents(user.id)
    const visuals = await assetService.visualsForContents(
      items.map((c) => ({ id: c.id, currentVersionId: c.currentVersionId })),
    )
    return Response.json({ scope, items: withVisuals(items as never, visuals) })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
