// 生成模式（GenerationMode）回归测试，2026-10-07
// 背景：真实用户作品为 composition（AI 图像 + Ken Burns 运镜合成），但用户以为产物是
// AI 视频模型生成的视频。三态必须对用户可见：composition / native / hybrid。
// 计算口径：最近成功 storyboard Job 的 shotAssets 中带 videoAssetId 的镜头数。
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { computeGenerationMode, jobService } from '@/core/jobs/job-service'
import { generationModeLabel } from '@/app/_language'

async function seedContent() {
  const { user } = await userRepo.createSessionUser(db)
  const c = await contentService.startCreation({ ownerId: user.id, text: '生成模式口径走查' })
  return { user, contentId: c.id }
}

describe('computeGenerationMode（纯函数：storyboard outputJson → 生成模式）', () => {
  it('零 videoAssetId → composition（真实用户作品的形态）', () => {
    const out = JSON.stringify({
      stage: 'done',
      shots: 5,
      shotAssets: [
        { shotIndex: 0, imageAssetId: 'a1', ttsAssetId: 't1' },
        { shotIndex: 1, imageAssetId: 'a2', ttsAssetId: 't2' },
        { shotIndex: 2, imageAssetId: 'a3' },
        { shotIndex: 3, imageAssetId: 'a4' },
        { shotIndex: 4, imageAssetId: 'a5' },
      ],
    })
    expect(computeGenerationMode(out)).toEqual({ mode: 'composition', nativeShots: 0, totalShots: 5 })
  })

  it('全部镜头带 videoAssetId → native', () => {
    const out = JSON.stringify({
      shotAssets: [
        { shotIndex: 0, imageAssetId: 'a1', videoAssetId: 'v1' },
        { shotIndex: 1, imageAssetId: 'a2', videoAssetId: 'v2' },
      ],
    })
    expect(computeGenerationMode(out)).toEqual({ mode: 'native', nativeShots: 2, totalShots: 2 })
  })

  it('部分镜头带 videoAssetId → hybrid（native 失败回落的诚实形态）', () => {
    const out = JSON.stringify({
      shotAssets: [
        { shotIndex: 0, imageAssetId: 'a1', videoAssetId: 'v1' },
        { shotIndex: 1, imageAssetId: 'a2' }, // 回落
        { shotIndex: 2, imageAssetId: 'a3' },
        { shotIndex: 3, imageAssetId: 'a4' },
      ],
    })
    expect(computeGenerationMode(out)).toEqual({ mode: 'hybrid', nativeShots: 1, totalShots: 4 })
  })

  it('脏容错：null / 坏 JSON / 空镜头 → null（不猜模式）', () => {
    expect(computeGenerationMode(null)).toBeNull()
    expect(computeGenerationMode(undefined)).toBeNull()
    expect(computeGenerationMode('not-json{')).toBeNull()
    expect(computeGenerationMode(JSON.stringify({ shotAssets: [] }))).toBeNull()
    expect(computeGenerationMode(JSON.stringify({ stage: 'images' }))).toBeNull()
  })
})

describe('generationModeForContent / generationModesForContents（DB 集成）', () => {
  it('最近成功 storyboard 决定模式；批量优先当前版本；无记录 → null', async () => {
    const { user, contentId } = await seedContent()
    const mk = async (shotAssets: Array<Record<string, unknown>>, versionId: string, older = false) => {
      await db.generationJob.create({
        data: {
          contentId,
          versionId,
          type: 'video.storyboard',
          status: 'succeeded',
          inputJson: '{}',
          outputJson: JSON.stringify({ shotAssets }),
          completedAt: older ? new Date('2026-10-01T00:00:00Z') : new Date('2026-10-07T00:00:00Z'),
        },
      })
    }
    try {
      // 无任何成功 Job → null
      expect(await jobService.generationModeForContent(contentId)).toBeNull()

      // ver-1（旧，composition）与 ver-2（新，hybrid）并存
      await mk([{ shotIndex: 0, imageAssetId: 'a' }, { shotIndex: 1, imageAssetId: 'b' }], 'ver-1', true)
      await mk(
        [
          { shotIndex: 0, imageAssetId: 'a', videoAssetId: 'v' },
          { shotIndex: 1, imageAssetId: 'b' },
        ],
        'ver-2',
      )

      // 单作口径：completedAt 降序 → 最新（ver-2，hybrid）
      const single = await jobService.generationModeForContent(contentId)
      expect(single).toEqual({ mode: 'hybrid', nativeShots: 1, totalShots: 2 })

      // 批量口径：优先当前版本（ver-2 → hybrid）
      const batch = await jobService.generationModesForContents([{ id: contentId, currentVersionId: 'ver-2' }])
      expect(batch.get(contentId)).toEqual({ mode: 'hybrid', nativeShots: 1, totalShots: 2 })

      // 批量口径：当前版本是 ver-1（历史版本也是真实生成记录）
      const batch2 = await jobService.generationModesForContents([{ id: contentId, currentVersionId: 'ver-1' }])
      expect(batch2.get(contentId)).toEqual({ mode: 'composition', nativeShots: 0, totalShots: 2 })

      // 批量口径：currentVersionId 无匹配 → 回退最近一次（ver-2）
      const batch3 = await jobService.generationModesForContents([{ id: contentId, currentVersionId: 'ver-none' }])
      expect(batch3.get(contentId)?.mode).toBe('hybrid')

      // 空列表 → 空映射
      expect((await jobService.generationModesForContents([])).size).toBe(0)
    } finally {
      await db.generationJob.deleteMany({ where: { contentId } })
      await db.content.deleteMany({ where: { id: contentId } })
      await db.user.deleteMany({ where: { id: user.id } })
    }
  })
})

describe('generationModeLabel（用户语言：诚实披露）', () => {
  it('三态标签均为用户语言且含合成/原生区分', () => {
    expect(generationModeLabel('composition')).toBe('AI 图像 + 运镜合成')
    expect(generationModeLabel('native')).toBe('AI 视频生成')
    expect(generationModeLabel('hybrid', 1, 4)).toBe('AI 视频 1/4 镜 · 其余图像合成')
    expect(generationModeLabel('hybrid')).toBe('AI 视频 + 图像合成混合')
    expect(generationModeLabel(null)).toBeNull()
    expect(generationModeLabel(undefined)).toBeNull()
  })
})
