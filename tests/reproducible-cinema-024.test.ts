// reproducible-cinema-024 收编版回归测试
// 历史：本文件原测一套平行实现（src/core/generation/* + src/ai/vision/*），该实现已被生产模块族
// 取代并删除（质量门 → core/quality/shot-gate、供给节奏 → ai/router/video-pacer、断点续跑 →
// storyboard-resume、评审接线 → ai/quality/vision-review，各有专属测试）。
// 本文件保留两条仍需独立锁定的能力：
//   §6 短剧手法库注入编剧与分镜层（craft-library → STORY_SYSTEM / STORYBOARD_SYSTEM）
//   §5 Generation 指纹账本（registry 落盘 attempt / promptHash / firstFrameHash——复现对账键）
// 铁律：fake provider，绝不触网。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { clearRegistry, registerProvider, router } from '@/ai/router/registry'
import type { ImageShotProvider, ProviderCallContext, VideoShotProvider } from '@/ai/router/types'
import { storyCraftFragment, storyboardCraftFragment } from '@/ai/planning/craft-library'
import { STORY_SYSTEM, STORYBOARD_SYSTEM } from '@/ai/planning/story'

beforeEach(async () => {
  await db.generationJob.deleteMany({ where: { status: { in: ['queued', 'claimed'] } } })
})

afterEach(() => {
  clearRegistry()
})

// ---------------- §6 短剧手法库注入 ----------------

describe('craft-library：钩子/卡点/节奏语法注入编剧与分镜层', () => {
  it('storyCraftFragment 含钩子四型与卡点三钩', () => {
    const frag = storyCraftFragment()
    for (const t of ['悬念型', '反常型', '冲突型', '奇观型', '悬念钩', '情绪钩', '反转钩']) {
      expect(frag).toContain(t)
    }
  })
  it('storyboardCraftFragment 含信息密度基准与末镜卡点要求', () => {
    const frag = storyboardCraftFragment()
    expect(frag).toContain('8–12 秒')
    expect(frag).toContain('卡点钩')
  })
  it('STORY_SYSTEM / STORYBOARD_SYSTEM 已注入对应片段（存在性锁定）', () => {
    expect(STORY_SYSTEM).toContain('悬念型')
    expect(STORY_SYSTEM).toContain('结尾卡点')
    expect(STORYBOARD_SYSTEM).toContain('8–12 秒')
    expect(STORYBOARD_SYSTEM).toContain('卡点钩')
  })
})

// ---------------- §5 指纹账本（registry 落盘） ----------------

describe('Generation 指纹账本：attempt + promptHash + firstFrameHash', () => {
  it('router.image 成功调用 → inputJson 携带 promptHash 与 attempt', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const c = await contentService.startCreation({ ownerId: user.id, text: '指纹账本走查' })
    clearRegistry()
    const fake: ImageShotProvider = {
      id: 'fake-image',
      capability: 'image.shot',
      model: 'fake-img-model',
      async execute() {
        return { base64: Buffer.from('fake-png').toString('base64'), mime: 'image/png' }
      },
    }
    registerProvider(fake)
    const ctx: ProviderCallContext = { contentId: c.id, versionId: null, purpose: 'test' }
    await router.image({ prompt: 'a lighthouse at dusk, cinematic', size: '768x1344' }, ctx)
    const rows = await db.generation.findMany({ where: { contentId: c.id, type: 'image.shot' } })
    expect(rows).toHaveLength(1)
    const input = JSON.parse(rows[0]!.inputJson ?? '{}')
    expect(input.attempt).toBe(1)
    expect(typeof input.promptHash).toBe('string')
    expect(input.promptHash).toHaveLength(16)
    expect(input.prompt).toContain('lighthouse')
  })

  it('video payload 的 data URI 首帧 → firstFrameHash 落盘（解码字节口径；失败路径同样记账）', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const c = await contentService.startCreation({ ownerId: user.id, text: '首帧指纹走查' })
    clearRegistry()
    // 确定性失败假 provider（非限速 → 指数退避，不命中冷却长等待）：指纹记账在每次尝试，与成败无关
    const fakeVideo: VideoShotProvider = {
      id: 'fake-video-fp',
      capability: 'video.shot',
      model: 'fake-vfp',
      async execute() {
        throw new Error('确定性失败（指纹记账路径）')
      },
    }
    registerProvider(fakeVideo)
    const ctx: ProviderCallContext = { contentId: c.id, versionId: null, purpose: 'test' }
    await router
      .video({ prompt: 'slow push in', imageUrl: 'data:image/png;base64,ZmFrZS1mcGFtZQ==' }, ctx)
      .catch(() => {})
    const rows = await db.generation.findMany({ where: { contentId: c.id, type: 'video.shot' }, orderBy: { createdAt: 'asc' } })
    expect(rows.length).toBeGreaterThanOrEqual(1)
    const input = JSON.parse(rows[0]!.inputJson ?? '{}')
    expect(input.attempt).toBeGreaterThanOrEqual(1)
    expect(typeof input.promptHash).toBe('string')
    // 首帧指纹 = sha256(base64 解码字节) 前 16 位（复现对账键，与 ShotExemplar.promptHash 同口径风格）
    expect(typeof input.firstFrameHash).toBe('string')
    expect(input.firstFrameHash).toHaveLength(16)
    // 解码字节口径实证：哈希值 ≠ 哈希 URI 原文（防回归到字符串哈希）
    const { createHash } = await import('node:crypto')
    const uriHash = createHash('sha256').update('data:image/png;base64,ZmFrZS1mcGFtZQ==').digest('hex').slice(0, 16)
    expect(input.firstFrameHash).not.toBe(uriHash)
    const bytesHash = createHash('sha256').update(Buffer.from('ZmFrZS1mcGFtZQ==', 'base64')).digest('hex').slice(0, 16)
    expect(input.firstFrameHash).toBe(bytesHash)
  })
})
