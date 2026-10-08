// Asset 服务（§50 / T7.1.1）
// 生成产物（图像/音频/视频/封面）的唯一入口：hash → 去重 → 存储 → Asset 行。
// 不变量：Asset 唯一 [hash, kind]（重试幂等，T6.1.2）
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { diskStorage } from '@/infra/storage'

export type AssetKind = 'original' | 'generated' | 'derived' | 'preview' | 'thumbnail' | 'final'

export interface SavedAsset {
  id: string
  kind: AssetKind
  mime: string
  hash: string
  storageLocation: string
  durationMs: number | null
  width: number | null
  height: number | null
  sizeBytes: number | null
  /** 本次调用是否复用了既有资产（幂等命中） */
  reused: boolean
}

/** 魔数嗅探（SDK 返回的 mime 不可全信） */
export function sniffMime(buf: Buffer): string {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii')
    if (brand.startsWith('M4A') || brand === 'MP4 ' || brand.startsWith('mp4')) return 'video/mp4'
    return 'video/mp4'
  }
  // 音频
  if (buf.length >= 3 && buf.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg'
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) return 'audio/mpeg'
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav'
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg'
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'fLaC') return 'audio/flac'
  if (buf.length >= 4 && buf.subarray(0, 1).toString('ascii') === '\x1a' && buf.subarray(1, 4).toString('ascii') === 'EDF3') return 'audio/opus'
  return 'application/octet-stream'
}

export function extFor(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'video/mp4': return 'mp4'
    case 'audio/mpeg': return 'mp3'
    case 'audio/wav': return 'wav'
    case 'audio/ogg': return 'ogg'
    case 'audio/opus': return 'opus'
    case 'audio/flac': return 'flac'
    default: return 'bin'
  }
}

export const assetService = {
  /**
   * 保存生成产物（幂等：同 hash+kind 复用）
   * @param declaredMime 调用方声称的 mime（与嗅探结果冲突时以嗅探为准）
   */
  async save(input: {
    contentId: string
    ownerId: string
    kind: AssetKind
    data: Buffer
    declaredMime?: string
    durationMs?: number | null
    width?: number | null
    height?: number | null
  }): Promise<SavedAsset> {
    const hash = createHash('sha256').update(input.data).digest('hex')
    const sniffed = sniffMime(input.data)
    const mime = sniffed !== 'application/octet-stream' ? sniffed : (input.declaredMime ?? sniffed)
    const ext = extFor(mime)
    const key = `${hash}.${ext}`

    // 幂等命中
    const existing = await db.asset.findFirst({ where: { hash, kind: input.kind } })
    if (existing) {
      return {
        id: existing.id,
        kind: input.kind,
        mime: existing.mime,
        hash,
        storageLocation: existing.storageLocation,
        durationMs: existing.durationMs,
        width: existing.width,
        height: existing.height,
        sizeBytes: existing.sizeBytes,
        reused: true,
      }
    }

    await diskStorage.put(key, input.data)
    const row = await db.asset.create({
      data: {
        contentId: input.contentId,
        ownerId: input.ownerId,
        kind: input.kind,
        mime,
        hash,
        storageLocation: key,
        durationMs: input.durationMs ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        sizeBytes: input.data.length,
      },
    })
    return {
      id: row.id,
      kind: input.kind,
      mime,
      hash,
      storageLocation: key,
      durationMs: row.durationMs,
      width: row.width,
      height: row.height,
      sizeBytes: row.sizeBytes,
      reused: false,
    }
  },

  async getById(id: string) {
    return db.asset.findUnique({ where: { id } })
  },

  /** 资产可见性判定（API 伺服层专用；公开作品资产人人可见，私有仅作者） */
  async checkVisibility(assetId: string, viewerId: string | null): Promise<'public' | 'forbidden' | 'missing'> {
    const asset = await db.asset.findUnique({ where: { id: assetId } })
    if (!asset) return 'missing'
    const content = await db.content.findUnique({
      where: { id: asset.contentId },
      select: { ownerId: true, visibility: true },
    })
    if (!content) return 'missing'
    if (content.visibility === 'private' && viewerId !== content.ownerId) return 'forbidden'
    return 'public'
  },

  async getByIds(ids: string[]) {
    if (ids.length === 0) return []
    return db.asset.findMany({ where: { id: { in: ids } } })
  },

  /** 读取对象字节（伺服路由用） */
  async readBytes(storageLocation: string): Promise<Buffer> {
    return diskStorage.get(storageLocation)
  },

  /** 本地绝对路径（合成器直取） */
  resolveLocalPath(storageLocation: string): string {
    return diskStorage.resolvePath(storageLocation)
  },

  /**
   * 引用计数安全清理：无任何 Asset 行再引用该存储 key 时才物理删除文件。
   * 背景：存储为内容寻址（key = hash.ext）且 Asset 按 (hash, kind) 全局去重——
   * 删作品级联掉 Asset 行后，文件可能仍被其他作品引用，凭空删除会弄坏别人的画面。
   */
  async removeIfOrphaned(storageLocation: string): Promise<boolean> {
    const still = await db.asset.findFirst({ where: { storageLocation }, select: { id: true } })
    if (still) return false
    await diskStorage.remove(storageLocation)
    return true
  },

  /** 最近一次最终视频/封面（explore 卡片视觉源；按创建时间倒序第一件） */
  async latestFinalForContent(contentId: string): Promise<{ final: string | null; poster: string | null }> {
    const finals = await db.asset.findMany({
      where: { contentId, kind: 'final' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })
    const posters = await db.asset.findMany({
      where: { contentId, kind: 'thumbnail' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })
    return { final: finals[0]?.id ?? null, poster: posters[0]?.id ?? null }
  },

  /**
   * 批量解析作品的当前视觉资产（列表页视觉化卡片的数据源）。
   * 权威映射：content × 当前版本 × 最近成功的 video.render Job → final/poster。
   */
  async visualsForContents(
    list: Array<{ id: string; currentVersionId: string | null }>,
  ): Promise<Map<string, { finalAssetId: string | null; posterAssetId: string | null; durationMs: number | null }>> {
    const out = new Map<string, { finalAssetId: string | null; posterAssetId: string | null; durationMs: number | null }>()
    if (list.length === 0) return out
    const ids = list.map((c) => c.id)
    const jobs = await db.generationJob.findMany({
      where: { contentId: { in: ids }, type: 'video.render', status: 'succeeded' },
      orderBy: { completedAt: 'desc' },
    })
    const byContent = new Map<string, Array<{ versionId: string | null; outputJson: string | null }>>()
    for (const job of jobs) {
      const arr = byContent.get(job.contentId) ?? []
      arr.push({ versionId: job.versionId, outputJson: job.outputJson })
      byContent.set(job.contentId, arr)
    }
    for (const content of list) {
      const candidates = byContent.get(content.id) ?? []
      // 优先当前版本的产物；无则最近一次（历史版本也可作视觉占位）
      const chosen =
        candidates.find((j) => j.versionId && j.versionId === content.currentVersionId) ?? candidates[0]
      if (!chosen?.outputJson) {
        out.set(content.id, { finalAssetId: null, posterAssetId: null, durationMs: null })
        continue
      }
      try {
        const parsed = JSON.parse(chosen.outputJson) as {
          finalAssetId?: string
          posterAssetId?: string
          durationMs?: number
        }
        out.set(content.id, {
          finalAssetId: parsed.finalAssetId ?? null,
          posterAssetId: parsed.posterAssetId ?? null,
          durationMs: parsed.durationMs ?? null,
        })
      } catch {
        out.set(content.id, { finalAssetId: null, posterAssetId: null, durationMs: null })
      }
    }
    return out
  },
}
