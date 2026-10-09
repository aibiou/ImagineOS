// GET /api/contents?scope=mine|explore
// mine：我的创作（Projects 雏形 §36）；explore：公开已发布（§39）
// M1（评审 P0-1）：列表项携带视觉资产（poster/video/duration）——视觉内容是卡片第一元素
// 2026-10-07：携带 generationMode（真实产物路径：composition/native/hybrid）——防止把合成误认为 AI 视频模型产物
import { getSessionUser, domainErrorToResponse } from '../_lib/session'
import { contentService } from '@/core/content/content-service'
import { assetService } from '@/core/assets/asset-service'
import { jobService } from '@/core/jobs/job-service'

function withVisuals(
  items: Array<Record<string, unknown> & { id: string; currentVersionId: string | null }>,
  visuals: Map<
    string,
    {
      finalAssetId: string | null
      posterAssetId: string | null
      durationMs: number | null
      width: number | null
      height: number | null
    }
  >,
  modes: Map<string, { mode: string; nativeShots: number; totalShots: number } | null>,
) {
  return items.map((item) => {
    const v = visuals.get(item.id)
    const m = modes.get(item.id) ?? null
    return {
      ...item,
      posterUrl: v?.posterAssetId ? `/api/assets/${v.posterAssetId}` : null,
      videoUrl: v?.finalAssetId ? `/api/assets/${v.finalAssetId}` : null,
      durationMs: v?.durationMs ?? null,
      // 展示面画幅（成片宽高推断；未知按 9:16）——播放弹窗自适应用
      aspectRatio: v?.width != null && v?.height != null && v.width > v.height ? '16:9' : '9:16',
      generationMode: m
        ? { mode: m.mode, nativeShots: m.nativeShots, totalShots: m.totalShots }
        : null,
    }
  })
}

export async function GET(req: Request) {
  try {
    const scope = new URL(req.url).searchParams.get('scope') ?? 'mine'
    if (scope === 'explore') {
      const items = await contentService.listExplore()
      const [visuals, modes] = await Promise.all([
        assetService.visualsForContents(items.map((c) => ({ id: c.id, currentVersionId: c.currentVersionId }))),
        jobService.generationModesForContents(items.map((c) => ({ id: c.id, currentVersionId: c.currentVersionId }))),
      ])
      return Response.json({ scope, items: withVisuals(items as never, visuals, modes as never) })
    }
    const user = await getSessionUser()
    if (!user) return Response.json({ scope, items: [], anonymous: true })
    const items = await contentService.listMyContents(user.id)
    const [visuals, modes] = await Promise.all([
      assetService.visualsForContents(items.map((c) => ({ id: c.id, currentVersionId: c.currentVersionId }))),
      jobService.generationModesForContents(items.map((c) => ({ id: c.id, currentVersionId: c.currentVersionId }))),
    ])
    return Response.json({ scope, items: withVisuals(items as never, visuals, modes as never) })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
