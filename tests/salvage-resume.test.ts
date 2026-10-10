// 跨 Job 断点续跑（salvage）+ 供给枯竭退避（gate-e2e 实证驱动的两项修复）
// 锁定语义：
//   1. Job 永久失败（重试耗尽）后 regenerate（恢复语义 payload.resumeFromFailed=true）→
//      新 Job 从失败 Job 进度打捞：已完成镜头零重烧（图像/视频/门结论原样复用），只补缺口
//   2. REVIEW/READY「换一批」语义（不带标记）不打捞——用户主动要求整片重画
//   3. 门挂了的图（gate.pass=false）不被打捞复用——重走质量门
//   4. 供给枯竭型失败（全部候选 Provider 失败 / 429）的 Job 退避 ×8（分钟级窗口 vs 15-45s）
// 铁律：fake provider 注入，绝不触网。
import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '@/lib/db'
import { registerProvider, clearRegistry, resetRegistry } from '@/ai/router/registry'
import type {
  ImageShotProvider,
  VideoShotProvider,
  VisionReviewProvider,
  AudioTTSProvider,
} from '@/ai/router/types'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { versionService } from '@/core/content/version-service'
import { jobService } from '@/core/jobs/job-service'
import { executeStoryboardJob } from '../workers/pipeline-executor'
import { ShotSnapshotSchema, type ShotSnapshot, type VersionStructure } from '@/core/content/schemas'

// ---------- fake providers（调用计数 = 供给消耗证据） ----------

const counters = { image: 0, vision: 0, video: 0, tts: 0 }

let REAL_MP4 = Buffer.alloc(0)
beforeAll(() => {
  mkdirSync(join(process.env.IMAGINEOS_STORAGE_DIR ?? '/tmp'), { recursive: true })
  const tmp = join(process.env.IMAGINEOS_STORAGE_DIR ?? '/tmp', 'salvage-fixture.mp4')
  execSync(`ffmpeg -y -f lavfi -i color=c=0x202020:s=64x64:d=1 -pix_fmt yuv420p -movflags +faststart "${tmp}"`, {
    stdio: 'ignore',
  })
  REAL_MP4 = readFileSync(tmp)
}, 120_000)

const fakeImage: ImageShotProvider = {
  id: 'fake-image',
  capability: 'image.shot',
  model: 'fake-image-model',
  async execute(payload) {
    counters.image++
    const idx = /pedal/i.test(payload.prompt) ? 1 : 0
    // 字节含代次计数：重画 → 字节不同 → 资产哈希不同（真实世界语义；
    // 恒定字节会撞资产去重 [ash,kind] 唯一约束回读同记录，掩盖「重画了」的事实）
    return { base64: Buffer.from(`img-${idx + 1}-g${counters.image}`).toString('base64'), mime: 'image/png' }
  },
}

const passVerdict = {
  pass: true,
  scores: { character: 9, scene: 9, style: 9, technical: 9 },
  watermark: false,
  issues: [],
  summary: '好镜头',
}

const fakeVision: VisionReviewProvider = {
  id: 'fake-vision',
  capability: 'vision.review',
  model: 'fake-vision-model',
  async execute() {
    counters.vision++
    return { text: JSON.stringify(passVerdict) }
  },
}

let videoFailMode: { failShots: Set<number> } = { failShots: new Set<number>() }

const fakeVideo: VideoShotProvider = {
  id: 'fake-video',
  capability: 'video.shot',
  model: 'fake-video-model',
  async execute(payload) {
    counters.video++
    const b64 = (payload.imageUrl ?? '').split('base64,')[1] ?? ''
    const decoded = Buffer.from(b64, 'base64').toString('utf-8')
    const m = decoded.match(/img-(\d+)/)
    const shotIndex = m ? Number(m[1]) - 1 : -1
    if (videoFailMode.failShots.has(shotIndex)) {
      throw new Error('HTTP 429：{"error":{"message":"rate limit exceeded"}}')
    }
    return { base64: REAL_MP4.toString('base64'), mime: 'video/mp4', repro: { taskId: `task-${shotIndex}` } }
  },
}

const fakeTts: AudioTTSProvider = {
  id: 'fake-tts',
  capability: 'audio.tts',
  model: 'fake-tts-model',
  async execute() {
    counters.tts++
    return { base64: 'x'.repeat(600), mime: 'audio/wav' }
  },
}

// ---------- 种子数据 ----------

const shot = (over: Partial<ShotSnapshot> = {}): ShotSnapshot =>
  ShotSnapshotSchema.parse({
    index: 0,
    visualDescription: '黄昏老巷口，父亲扶着自行车后座',
    imagePrompt: 'A father steadying the back of an old bicycle at dusk in a narrow alley',
    cameraMotion: 'zoom_in',
    durationMs: 5000,
    charactersInShot: ['父亲'],
    narrationLine: '扶稳了，别看脚底下。',
    ...over,
  })

const structure = (): VersionStructure =>
  ({
    concept: { name: '旧路上的风', oneLiner: '一辆旧自行车的视角重走父子路', visualDirection: '黄昏暖调、胶片颗粒' },
    characters: [
      {
        name: '父亲',
        description: '沉默的退伍工人',
        wardrobe: '洗旧的藏蓝衬衫',
        visualAnchor: 'A lean Chinese father in his 40s, faded navy shirt',
      },
    ],
    story: {
      logline: '松手那一下。',
      lookBook: 'golden dusk, film grain',
      characters: [],
      scenes: [
        { index: 0, summary: '巷口学车', timeOfDay: '黄昏', locationAnchor: 'narrow old alley', shots: [shot()] },
        { index: 0, summary: '巷口学车（第二镜）', timeOfDay: '黄昏', locationAnchor: 'narrow old alley', shots: [shot({ index: 1, visualDescription: '儿子踩上踏板', imagePrompt: 'The son steps on the pedal' })] },
      ],
    },
  }) as unknown as VersionStructure

async function seedGeneratingContent(title: string) {
  const { user } = await userRepo.createSessionUser(db)
  const c = await contentService.startCreation({ ownerId: user.id, text: title })
  for (const to of ['INTENT', 'PLANNING', 'STORY', 'STORYBOARD', 'GENERATING'] as const) {
    await contentService.advanceStatus(c.id, to, user.id)
  }
  const version = await versionService.createVersion(c.id, user.id, { method: 'initial', changelog: '测试配方', structure: structure() })
  return { user, content: c, version }
}

async function runJobOnce(
  jobId: string,
  contentId: string,
  versionId: string,
  actorId: string,
  opts?: { resumeFromFailed?: boolean },
) {
  await db.generationJob.update({ where: { id: jobId }, data: { status: 'running' } })
  try {
    await executeStoryboardJob(jobId, { contentId, versionId, actorId, resumeFromFailed: opts?.resumeFromFailed === true })
    return 'done' as const
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await jobService.fail(jobId, message)
    return 'failed' as const
  }
}

const readOutput = async (jobId: string) => {
  const job = await db.generationJob.findUnique({ where: { id: jobId } })
  return job?.outputJson ? (JSON.parse(job.outputJson) as Record<string, unknown>) : {}
}

beforeEach(async () => {
  counters.image = 0
  counters.vision = 0
  counters.video = 0
  counters.tts = 0
  videoFailMode = { failShots: new Set() }
  clearRegistry()
  registerProvider(fakeImage)
  registerProvider(fakeVision)
  registerProvider(fakeVideo)
  registerProvider(fakeTts)
  process.env.IMAGINEOS_VIDEO_SUBMIT_GAP_MS = '1'
  process.env.IMAGINEOS_RATE_COOLDOWN_MS = '1'
  process.env.IMAGINEOS_IMAGE_GATE = '1'
  process.env.IMAGINEOS_VIDEO_GATE = '1'
  await db.generationJob.deleteMany()
  await db.shotExemplar.deleteMany()
  await db.generation.deleteMany()
  await db.provenance.deleteMany()
})

afterEach(() => {
  resetRegistry()
  delete process.env.IMAGINEOS_VIDEO_SUBMIT_GAP_MS
  delete process.env.IMAGINEOS_RATE_COOLDOWN_MS
  delete process.env.IMAGINEOS_IMAGE_GATE
  delete process.env.IMAGINEOS_VIDEO_GATE
})

describe('跨 Job 断点续跑（失败后重新生成 = 只补缺口）', () => {
  it('Job 永久失败 → regenerate（恢复语义）打捞已完成镜头：镜1 整镜零重烧、镜2 只补视频', async () => {
    const { user, content, version } = await seedGeneratingContent('跨Job打捞走查')

    // ---- Job A：镜 1 全成、镜 2 视频 429 耗尽 → 永久失败（重试预算烧完） ----
    videoFailMode.failShots = new Set([1])
    const jobA = await jobService.enqueue({ contentId: content.id, versionId: version.id, type: 'video.storyboard' })
    const first = await runJobOnce(jobA.id, content.id, version.id, user.id)
    expect(first).toBe('failed')
    // 模拟重试预算耗尽的终态（outputJson 保留——fail 不清进度）
    await db.generationJob.update({
      where: { id: jobA.id },
      data: { status: 'failed', retryCount: 3, completedAt: new Date() },
    })

    const outA = await readOutput(jobA.id)
    const assetsA = outA.shotAssets as Array<{ shotIndex: number; imageAssetId: string; videoAssetId?: string }>
    expect(assetsA).toHaveLength(2)
    expect(assetsA[0]!.videoAssetId).toBeTruthy() // 镜 1 已完整（最稀缺的 native 视频资产）
    expect(assetsA[1]!.videoAssetId).toBeUndefined() // 镜 2 断在视频
    const imageAfterA = counters.image
    const videoAfterA = counters.video

    // ---- Job B：regenerate 恢复入口（payload.resumeFromFailed=true） ----
    videoFailMode.failShots = new Set() // 供给恢复（退避后窗口重开）
    const jobB = await jobService.enqueue({
      contentId: content.id,
      versionId: version.id,
      type: 'video.storyboard',
      payload: { contentId: content.id, versionId: version.id, actorId: user.id, resumeFromFailed: true },
    })
    const second = await runJobOnce(jobB.id, content.id, version.id, user.id, { resumeFromFailed: true })
    expect(second).toBe('done')

    // 打捞核心断言：图像零重烧（两镜全复用 Job A 的已质检图）、镜 1 视频零重烧、只补镜 2 视频
    expect(counters.image).toBe(imageAfterA)
    expect(counters.video).toBe(videoAfterA + 1)
    expect(counters.vision).toBe(4) // 门只在 Job A 首次生成时跑；打捞复用不再评审

    const outB = await readOutput(jobB.id)
    const assetsB = outB.shotAssets as Array<{ shotIndex: number; imageAssetId: string; videoAssetId?: string }>
    expect(assetsB).toHaveLength(2)
    expect(assetsB.every((e) => e.videoAssetId)).toBe(true) // 2/2 native 补齐
    expect(assetsB[0]!.imageAssetId).toBe(assetsA[0]!.imageAssetId) // 镜 1 资产跨 Job 原样复用
    expect(assetsB[0]!.videoAssetId).toBe(assetsA[0]!.videoAssetId)
    expect(assetsB[1]!.imageAssetId).toBe(assetsA[1]!.imageAssetId) // 镜 2 图像复用（gate.pass）

    // 审计：resume.salvage 事件在案（打捞来源可追溯）
    const events = await db.provenance.findMany({ where: { contentId: content.id } })
    const salvage = events.find((e) => e.model === 'storyboard.resume')
    expect(salvage).toBeTruthy()
    const salvagePayload = JSON.parse(salvage!.payloadJson ?? '{}')
    expect(salvagePayload.stage).toBe('resume.salvage')
    expect(salvagePayload.salvagedFromJobId).toBe(jobA.id)
    expect(salvagePayload.salvagedShots).toBe(2)
  })

  it('「换一批」语义（不带 resumeFromFailed）不打捞：整片重画', async () => {
    const { user, content, version } = await seedGeneratingContent('换一批走查')

    // ---- Job A：全成后模拟失败终态（进度里有完整镜头） ----
    const jobA = await jobService.enqueue({ contentId: content.id, versionId: version.id, type: 'video.storyboard' })
    const first = await runJobOnce(jobA.id, content.id, version.id, user.id)
    expect(first).toBe('done')
    await db.generationJob.update({ where: { id: jobA.id }, data: { status: 'failed', completedAt: new Date() } })
    const imageAfterA = counters.image
    expect(imageAfterA).toBe(2)

    // ---- Job B：REVIEW/READY 的 regenerate（换一批）——不带标记 ----
    const jobB = await jobService.enqueue({
      contentId: content.id,
      versionId: version.id,
      type: 'video.storyboard',
      payload: { contentId: content.id, versionId: version.id, actorId: user.id },
    })
    const second = await runJobOnce(jobB.id, content.id, version.id, user.id) // 无标记
    expect(second).toBe('done')
    expect(counters.image).toBe(4) // 整片重画（2+2）——用户主动要求换一批，语义不被打捞稀释

    const events = await db.provenance.findMany({ where: { contentId: content.id } })
    expect(events.filter((e) => e.model === 'storyboard.resume')).toHaveLength(0) // 无打捞事件
  })

  it('门挂了的图（gate.pass=false）不打捞复用——重走质量门', async () => {
    const { user, content, version } = await seedGeneratingContent('门失败打捞走查')

    // ---- Job A：全成后终态失败，但把镜 2 的 gate 篡改为 fail（模拟带病资产） ----
    const jobA = await jobService.enqueue({ contentId: content.id, versionId: version.id, type: 'video.storyboard' })
    const first = await runJobOnce(jobA.id, content.id, version.id, user.id)
    expect(first).toBe('done')
    const outA = await readOutput(jobA.id)
    const assets = outA.shotAssets as Array<{ shotIndex: number; imageAssetId: string; videoAssetId?: string; gate?: { pass: boolean } }>
    assets[1]!.gate!.pass = false // 镜 2 带病（如水印镜，诚实 FAIL）
    await db.generationJob.update({
      where: { id: jobA.id },
      data: { status: 'failed', completedAt: new Date(), outputJson: JSON.stringify({ ...outA, shotAssets: assets }) },
    })
    const imageAfterA = counters.image

    // ---- Job B：恢复语义打捞——镜 1 复用、镜 2 重画（门挂了不带走病资产） ----
    const jobB = await jobService.enqueue({
      contentId: content.id,
      versionId: version.id,
      type: 'video.storyboard',
      payload: { contentId: content.id, versionId: version.id, actorId: user.id, resumeFromFailed: true },
    })
    const second = await runJobOnce(jobB.id, content.id, version.id, user.id, { resumeFromFailed: true })
    expect(second).toBe('done')
    expect(counters.image).toBe(imageAfterA + 1) // 只有镜 2 重画

    const outB = await readOutput(jobB.id)
    const assetsB = outB.shotAssets as Array<{ shotIndex: number; imageAssetId: string; videoAssetId?: string; gate?: { pass: boolean } }>
    expect(assetsB[0]!.imageAssetId).toBe(assets[0]!.imageAssetId) // 镜 1 健康资产复用
    expect(assetsB[1]!.imageAssetId).not.toBe(assets[1]!.imageAssetId) // 镜 2 重画
    expect(assetsB[1]!.gate!.pass).toBe(true) // 重画后重新过门
  })
})

describe('供给枯竭退避（job-service.fail）', () => {
  it('全部候选 Provider 失败 → 退避 ×8（120s 起，分钟级窗口）；普通错误维持 15s 基数', async () => {
    const { user, content, version } = await seedGeneratingContent('退避走查')

    const jobA = await jobService.enqueue({ contentId: content.id, versionId: version.id, type: 'video.storyboard' })
    const before = Date.now()
    await jobService.fail(jobA.id, '镜头 1 原生视频生成失败：[ModelRouter] 能力 video.shot 的全部候选 Provider 失败：HTTP 429 rate limit')
    const failedA = await db.generationJob.findUnique({ where: { id: jobA.id } })
    expect(failedA?.status).toBe('queued')
    const backoffA = failedA!.leaseExpiresAt!.getTime() - before
    expect(backoffA).toBeGreaterThanOrEqual(110_000) // 15s × 1 × 8 = 120s（容忍测量误差）
    expect(backoffA).toBeLessThan(140_000)

    const jobB = await jobService.enqueue({ contentId: content.id, versionId: version.id, type: 'video.storyboard' })
    await jobService.fail(jobB.id, '普通瞬时失败（网络抖动）')
    const failedB = await db.generationJob.findUnique({ where: { id: jobB.id } })
    const backoffB = failedB!.leaseExpiresAt!.getTime() - before
    expect(backoffB).toBeLessThan(60_000) // 15s 基数不变

    // 用户身份清理一致性（seed 辅助断言）
    expect(user.id).toBeTruthy()
    expect(version.id).toBeTruthy()
  })
})
