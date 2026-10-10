// ShotExemplar 范例库服务（经验复利层，设计见 docs/design/quality-reproduction.md §4.2）
// 入库：质量门终选综合分 ≥ EXEMPLAR_THRESHOLD 的镜头自动沉淀（同 content+shotIndex 取最高分覆盖）；
// 消费：质量门参考帧（同片最近高分镜头——跨镜人物/影调一致性比对）。
// 复现地基：promptHash 与 Generation.inputJson 同口径 → 「好镜头怎么写出来的」可精确回放。
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

import { db } from '@/lib/db'
import { assetService } from '@/core/assets/asset-service'

export interface ExemplarRecordInput {
  contentId: string
  versionId: string | null
  shotIndex: number
  assetId: string
  imagePrompt: string
  /** 锚点/lookBook 快照（复现上下文） */
  contextSnapshot: Record<string, unknown>
  score: number
  verdictSummary: string
}

export interface ReferenceFrame {
  base64: string
  mime: string
  shotIndex: number
  score: number
}

/** 与 Generation.inputJson.promptHash 同口径（sha256 前 16 位）——跨表精确匹配 */
export function promptHashOf(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16)
}

export const exemplarService = {
  /** 高分镜头沉淀（幂等：同 content+shotIndex 仅在分数更高时覆盖） */
  async recordIfQualified(input: ExemplarRecordInput, threshold: number): Promise<boolean> {
    if (input.score < threshold) return false
    const promptJson = JSON.stringify({
      imagePrompt: input.imagePrompt,
      context: input.contextSnapshot,
    })
    const scoreJson = JSON.stringify({ score: input.score, summary: input.verdictSummary, threshold })
    const existing = await db.shotExemplar.findUnique({
      where: { contentId_shotIndex: { contentId: input.contentId, shotIndex: input.shotIndex } },
    })
    if (existing) {
      const prevScore = (() => {
        try {
          return (JSON.parse(existing.scoreJson) as { score?: number }).score ?? -1
        } catch {
          return -1
        }
      })()
      if (input.score <= prevScore) return false
      await db.shotExemplar.update({
        where: { id: existing.id },
        data: {
          versionId: input.versionId,
          assetId: input.assetId,
          promptHash: promptHashOf(input.imagePrompt),
          promptJson,
          scoreJson,
        },
      })
      return true
    }
    await db.shotExemplar.create({
      data: {
        contentId: input.contentId,
        versionId: input.versionId,
        shotIndex: input.shotIndex,
        assetId: input.assetId,
        promptHash: promptHashOf(input.imagePrompt),
        promptJson,
        scoreJson,
      },
    })
    return true
  },

  /** 质量门参考帧：同片最近沉淀的高分镜头图（资产丢失容错 → null） */
  async latestReferenceFor(contentId: string): Promise<ReferenceFrame | null> {
    const rows = await db.shotExemplar.findMany({
      where: { contentId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })
    for (const row of rows) {
      const asset = await assetService.getById(row.assetId)
      if (!asset) continue // 资产被回收：容错跳过
      try {
        const buf = await readFile(assetService.resolveLocalPath(asset.storageLocation))
        let score = 0
        try {
          score = (JSON.parse(row.scoreJson) as { score?: number }).score ?? 0
        } catch { /* 坏 JSON 按零分处理 */ }
        return { base64: buf.toString('base64'), mime: asset.mime || 'image/png', shotIndex: row.shotIndex, score }
      } catch {
        continue // 文件不可读：容错跳过
      }
    }
    return null
  },

  /** 库存概览（评估/调试） */
  async statsFor(contentId: string): Promise<{ count: number; best: number | null }> {
    const rows = await db.shotExemplar.findMany({ where: { contentId }, select: { scoreJson: true } })
    let best: number | null = null
    for (const r of rows) {
      try {
        const s = (JSON.parse(r.scoreJson) as { score?: number }).score
        if (typeof s === 'number' && (best === null || s > best)) best = s
      } catch { /* 忽略坏行 */ }
    }
    return { count: rows.length, best }
  },
}
