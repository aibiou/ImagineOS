// 范例库服务回归测试（quality-repro-023，设计 docs/design/quality-reproduction.md §4.2）
// 锁定语义：
//   1. 阈值准入：综合分 ≥ threshold 才入库
//   2. 幂等覆盖：同 content+shotIndex 仅更高分覆盖（保最佳）
//   3. promptHash 与 Generation 同口径（sha256 前 16 位——跨表精确匹配的复现地基）
//   4. 参考帧解析：读回资产文件 base64（质量门比对用）；资产丢失容错 → null
// 铁律：测试库/测试存储隔离（global-setup），文件真实落盘再读回。
import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { assetService } from '@/core/assets/asset-service'
import { exemplarService, promptHashOf } from '@/core/quality/exemplar-service'

// 1×1 红 PNG（最小合法图像字节）
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function seedContent(title: string) {
  const { user } = await userRepo.createSessionUser(db)
  const c = await contentService.startCreation({ ownerId: user.id, text: title })
  return { user, content: c }
}

async function saveImage(contentId: string, ownerId: string) {
  return assetService.save({
    contentId,
    ownerId,
    kind: 'generated',
    data: RED_PNG,
    declaredMime: 'image/png',
  })
}

beforeEach(async () => {
  await db.shotExemplar.deleteMany()
  await db.generation.deleteMany()
  await db.generationJob.deleteMany()
})

describe('recordIfQualified（阈值准入 + 幂等保最佳）', () => {
  it('低于阈值不入库；达到阈值入库且 promptJson/promptHash 完整', async () => {
    const { user, content } = await seedContent('范例库阈值')
    const asset = await saveImage(content.id, user.id)
    const input = {
      contentId: content.id,
      versionId: null,
      shotIndex: 0,
      assetId: asset.id,
      imagePrompt: 'A father at dusk, navy shirt',
      contextSnapshot: { facts: { sceneAnchor: 'old alley' } },
      score: 7.9,
      verdictSummary: '还不错',
    }
    expect(await exemplarService.recordIfQualified(input, 8.0)).toBe(false)
    expect(await db.shotExemplar.count()).toBe(0)
    expect(await exemplarService.recordIfQualified({ ...input, score: 8.2 }, 8.0)).toBe(true)
    const row = await db.shotExemplar.findUnique({
      where: { contentId_shotIndex: { contentId: content.id, shotIndex: 0 } },
    })
    expect(row).not.toBeNull()
    expect(row!.assetId).toBe(asset.id)
    expect(row!.promptHash).toBe(promptHashOf(input.imagePrompt))
    const promptJson = JSON.parse(row!.promptJson) as { imagePrompt: string; context: { facts: { sceneAnchor: string } } }
    expect(promptJson.imagePrompt).toBe(input.imagePrompt)
    expect(promptJson.context.facts.sceneAnchor).toBe('old alley')
  })

  it('同 content+shotIndex：低分不覆盖高分；更高分覆盖（幂等保最佳）', async () => {
    const { user, content } = await seedContent('范例库幂等')
    const asset = await saveImage(content.id, user.id)
    const base = {
      contentId: content.id,
      versionId: null,
      shotIndex: 2,
      assetId: asset.id,
      imagePrompt: 'p',
      contextSnapshot: {},
      verdictSummary: 's',
    }
    await exemplarService.recordIfQualified({ ...base, score: 9.0 }, 8.0)
    expect(await exemplarService.recordIfQualified({ ...base, score: 8.5 }, 8.0)).toBe(false) // 低分不覆盖
    expect(await exemplarService.recordIfQualified({ ...base, score: 9.5 }, 8.0)).toBe(true) // 更高分覆盖
    const rows = await db.shotExemplar.findMany({ where: { contentId: content.id } })
    expect(rows).toHaveLength(1)
    expect((JSON.parse(rows[0]!.scoreJson) as { score: number }).score).toBe(9.5)
  })

  it('promptHash 口径与 sha256 前 16 位一致（与 Generation.inputJson.promptHash 跨表可匹配）', () => {
    const prompt = 'A quiet cinematic moment'
    expect(promptHashOf(prompt)).toBe(createHash('sha256').update(prompt).digest('hex').slice(0, 16))
    expect(promptHashOf(prompt)).toHaveLength(16)
    expect(promptHashOf('x')).not.toBe(promptHashOf('y'))
  })
})

describe('latestReferenceFor（质量门参考帧）', () => {
  it('读回最近入库镜头的资产文件 base64（真实落盘→读回）', async () => {
    const { user, content } = await seedContent('参考帧解析')
    const asset = await saveImage(content.id, user.id)
    await exemplarService.recordIfQualified(
      {
        contentId: content.id,
        versionId: null,
        shotIndex: 1,
        assetId: asset.id,
        imagePrompt: 'p',
        contextSnapshot: {},
        score: 8.8,
        verdictSummary: '优',
      },
      8.0,
    )
    const ref = await exemplarService.latestReferenceFor(content.id)
    expect(ref).not.toBeNull()
    expect(ref!.base64).toBe(RED_PNG.toString('base64'))
    expect(ref!.mime).toBe('image/png')
    expect(ref!.shotIndex).toBe(1)
    expect(ref!.score).toBe(8.8)
  })

  it('无范例 → null；资产行丢失 → 容错跳过（不抛错，门降级无参考）', async () => {
    const { user, content } = await seedContent('参考帧容错')
    expect(await exemplarService.latestReferenceFor(content.id)).toBeNull()
    // 直接伪造 assetId 指向不存在的资产
    await db.shotExemplar.create({
      data: {
        contentId: content.id,
        shotIndex: 0,
        assetId: 'nonexistent-asset',
        promptHash: 'x',
        promptJson: '{}',
        scoreJson: '{"score":9}',
      },
    })
    expect(await exemplarService.latestReferenceFor(content.id)).toBeNull()
  })
})

describe('statsFor（库存概览）', () => {
  it('count + best 分数汇总', async () => {
    const { user, content } = await seedContent('库存概览')
    const asset = await saveImage(content.id, user.id)
    for (const [shotIndex, score] of [[0, 8.1], [1, 9.3], [2, 8.7]] as const) {
      await exemplarService.recordIfQualified(
        { contentId: content.id, versionId: null, shotIndex, assetId: asset.id, imagePrompt: 'p', contextSnapshot: {}, score, verdictSummary: 's' },
        8.0,
      )
    }
    const stats = await exemplarService.statsFor(content.id)
    expect(stats.count).toBe(3)
    expect(stats.best).toBe(9.3)
  })
})
