// 公开分享页聚合（底座②：发布分享落地页 /w/:id 的服务端读模型）
// 职责：一次性取齐分享页所需的全部数据（作品/发布信息/视觉资产/生成模式诚实标签）。
// 访问语义（与 getOwnedOrVisibleContent 同源 + 发布态防御闸）：
//   - public / unlisted：任何访客（unlisted = 知道链接即可看，不进探索列表）
//   - private：仅作者；他人与「不存在」同语义（防枚举探测）
//   - 未发布（status !== PUBLISHED）：陌生人一律 not_found（防御性二道闸——
//     visibility 本应由发布动作写入，此处不信任该不变量以防未来路径破坏它）
//   - 作者本人：任何状态可看（isPreview = true，前端展示「仅你可见」横幅）
import { db } from '@/lib/db'
import { NotFoundError } from '@/core/errors'
import { contentService } from '@/core/content/content-service'
import { contentRepo } from '@/core/repositories/content-repo'
import { assetService } from '@/core/assets/asset-service'
import { jobService } from '@/core/jobs/job-service'

/** findByIdWithDetail 的返回形状（含 owner/currentVersion/remixOf/_count） */
type ContentDetail = NonNullable<Awaited<ReturnType<typeof contentRepo.findByIdWithDetail>>>

export interface ShareView {
  content: ContentDetail
  publication: {
    title: string
    description: string | null
    visibility: string
    publishedAt: Date
  } | null
  /** 作者本人访问（未发布时也可见，前端出预览横幅） */
  isOwner: boolean
  /** 未发布（仅作者可见的预览态） */
  isPreview: boolean
  videoUrl: string | null
  posterUrl: string | null
  durationMs: number | null
  generationMode: { mode: string; nativeShots: number; totalShots: number } | null
}

export async function getShareView(contentId: string, viewerId: string | null): Promise<ShareView> {
  const { content, isOwner } = await contentService.getOwnedOrVisibleContent(contentId, viewerId)
  if (!isOwner && content.status !== 'PUBLISHED') {
    throw new NotFoundError('作品', contentId)
  }
  const publication = await db.publication.findUnique({ where: { contentId } })
  const entry = { id: content.id, currentVersionId: content.currentVersionId }
  const [visuals, modes] = await Promise.all([
    assetService.visualsForContents([entry]),
    jobService.generationModesForContents([entry]),
  ])
  const v = visuals.get(content.id)
  const m = modes.get(content.id) ?? null
  return {
    content,
    publication: publication
      ? {
          title: publication.title,
          description: publication.description,
          visibility: publication.visibility,
          publishedAt: publication.publishedAt,
        }
      : null,
    isOwner,
    isPreview: content.status !== 'PUBLISHED',
    videoUrl: v?.finalAssetId ? `/api/assets/${v.finalAssetId}` : null,
    posterUrl: v?.posterAssetId ? `/api/assets/${v.posterAssetId}` : null,
    durationMs: v?.durationMs ?? null,
    generationMode: m,
  }
}
