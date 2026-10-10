// storyboard 断点续跑 + 全 native 诚实管线集成测试（quality-repro-023，设计 §3）
// 锁定语义（取缔 Ken Burns 回落的验收核心）：
//   1. native 视频失败 → Job 可重试失败（不再静默回落 composition）；进度里已完成的镜头资产保留
//   2. 重跑 = 断点续跑：已完成镜头（图+视频）零重烧；只有图的视频补视频（图像配额不重烧）
//   3. 质量门 in-loop：每镜 image.gate Provenance 事件 + shotAssets 带 gate 摘要；高分镜头入范例库
//   4. 视频严格缺陷（水印）→ 预算内重试 → 仍败 → 诚实失败（绝不回落）
//   5. 全部补齐后 mode = native（2/2 videoAssetId）——computeGenerationMode 零回落证据
// 铁律：fake provider 注入（image/vision/video/tts 四链全 fake），绝不触网。
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
  ProviderCallContext,
} from '@/ai/router/types'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { versionService } from '@/core/content/version-service'
import { jobService, computeGenerationMode } from '@/core/jobs/job-service'
import { executeStoryboardJob } from '../workers/pipeline-executor'
import { VersionStructureSchema, ShotSnapshotSchema, type ShotSnapshot, type VersionStructure } from '@/core/content/schemas'

// ---------- fake providers（调用计数 = 供给消耗证据） ----------

const counters = { image: 0, vision: 0, video: 0, tts: 0 }

/** 真实最小 mp4（1s 黑帧）——抽帧门需要合法视频字节（ffmpeg 真实跑） */
let REAL_MP4 = Buffer.alloc(0)
beforeAll(() => {
  mkdirSync(join(process.env.IMAGINEOS_STORAGE_DIR ?? '/tmp'), { recursive: true })
  const tmp = join(process.env.IMAGINEOS_STORAGE_DIR ?? '/tmp', 'gate-fixture.mp4')
  execSync(
    `ffmpeg -y -f lavfi -i color=c=0x202020:s=64x64:d=1 -pix_fmt yuv420p -movflags +faststart "${tmp}"`,
    { stdio: 'ignore' },
  )
  REAL_MP4 = readFileSync(tmp)
}, 120_000)

const fakeImage: ImageShotProvider = {
  id: 'fake-image',
  capability: 'image.shot',
  model: 'fake-image-model',
  async execute(payload) {
    counters.image++
    // 镜头号由 prompt 内容确定（并发下调用顺序不可靠；prompt 含镜头独有内容）
    const idx = /pedal/i.test(payload.prompt) ? 1 : 0
    return { base64: Buffer.from(`img-${idx + 1}`).toString('base64'), mime: 'image/png' }
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

/** 视频供给：failShots 集合内的镜头持续失败（模拟 503 供给中断；非限速错误走指数退避后耗尽） */
let videoFailMode: { failShots: Set<number> } = { failShots: new Set<number>() }

const fakeVideo: VideoShotProvider = {
  id: 'fake-video',
  capability: 'video.shot',
  model: 'fake-video-model',
  async execute(payload) {
    counters.video++
    // 镜头号从首帧内容推断：解码 data URL 的 base64 → "img-N" → N-1 = shotIndex（重试/并发/续跑读回均稳定）
    const b64 = (payload.imageUrl ?? '').split('base64,')[1] ?? ''
    const decoded = Buffer.from(b64, 'base64').toString('utf-8')
    const m = decoded.match(/img-(\d+)/)
    const shotIndex = m ? Number(m[1]) - 1 : -1
    if (videoFailMode.failShots.has(shotIndex)) {
      throw new Error('HTTP 503：服务暂不可用（测试注入的持续供给失败）')
    }
    return { base64: REAL_MP4.toString('base64'), mime: 'video/mp4', repro: { taskId: `task-${shotIndex}` } }
  },
}

/** 水印版 fake vision（视频门用：按图像内容区分……简化为统一返回 pass，见下文水印专项用例） */
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
  VersionStructureSchema.parse({
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
        { index: 0, summary: '巷口学车（同场景第二镜）', timeOfDay: '黄昏', locationAnchor: 'narrow old alley', shots: [shot({ index: 1, visualDescription: '儿子踩上踏板', imagePrompt: 'The son steps on the pedal' })] },
      ],
    },
  })

async function seedGeneratingContent(title: string) {
  const { user } = await userRepo.createSessionUser(db)
  const c = await contentService.startCreation({ ownerId: user.id, text: title })
  for (const to of ['INTENT', 'PLANNING', 'STORY', 'STORYBOARD', 'GENERATING'] as const) {
    await contentService.advanceStatus(c.id, to, user.id)
  }
  const version = await versionService.createVersion(c.id, user.id, { method: 'initial', changelog: '测试配方', structure: structure() })
  return { user, content: c, version }
}

async function runJobOnce(jobId: string, contentId: string, versionId: string, actorId: string) {
  await db.generationJob.update({ where: { id: jobId }, data: { status: 'running' } })
  try {
    await executeStoryboardJob(jobId, { contentId, versionId, actorId })
    return 'done' as const
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await jobService.fail(jobId, message) // worker 语义：可重试失败 → 回队
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
  process.env.IMAGINEOS_VIDEO_SUBMIT_GAP_MS = '1' // 测试不真等 61s（pacer 动态读 env）
  process.env.IMAGINEOS_RATE_COOLDOWN_MS = '1' // 429 冷却也不真等 60s（registry 动态读 env）
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

describe('storyboard 全 native 诚实管线（无 Ken Burns 回落）', () => {
  it('一次全通：2/2 native、每镜 quality-gate 事件、gate 摘要入 shotAssets、高分入范例库', async () => {
    const { user, content, version } = await seedGeneratingContent('全通走查')
    const job = await jobService.enqueue({ contentId: content.id, versionId: version.id, type: 'video.storyboard' })
    const outcome = await runJobOnce(job.id, content.id, version.id, user.id)
    expect(outcome).toBe('done')

    const out = await readOutput(job.id)
    const shotAssets = out.shotAssets as Array<{ shotIndex: number; imageAssetId: string; videoAssetId?: string; gate?: { pass: boolean; score: number } }>
    expect(shotAssets).toHaveLength(2)
    expect(shotAssets.every((e) => e.videoAssetId)).toBe(true) // 2/2 native
    expect(computeGenerationMode(JSON.stringify({ shotAssets }))?.mode).toBe('native') // 零回落证据
    for (const e of shotAssets) {
      expect(e.gate?.pass).toBe(true)
      expect(e.gate?.score).toBeGreaterThan(8) // fake verdict = 全 9 分
    }
    expect(counters.image).toBe(2) // 每镜一次图像（首过即合格）
    expect(counters.video).toBe(2)
    expect(counters.vision).toBe(4) // 2 图像门 + 2 视频门

    // Provenance：mode.decision + 逐镜 image.gate
    const events = await db.provenance.findMany({ where: { contentId: content.id }, orderBy: { createdAt: 'asc' } })
    const gateEvents = events.filter((e) => e.model === 'quality-gate')
    expect(gateEvents).toHaveLength(2)
    expect(events.some((e) => e.model === 'mode-decision')).toBe(true)

    // 范例库：两镜全 9 分 → 2 条
    expect(await db.shotExemplar.count({ where: { contentId: content.id } })).toBe(2)

    // Generation 记账：vision.review 类型在案（质量门进环的直接证据）
    const visionRows = await db.generation.findMany({ where: { contentId: content.id, type: 'vision.review' } })
    expect(visionRows.length).toBeGreaterThanOrEqual(4)
  })

  it('镜头 2 视频供给失败 → Job 可重试失败（无回落事件）→ 续跑只补镜头 2 视频（图像零重烧）', async () => {
    const { user, content, version } = await seedGeneratingContent('断点续跑走查')
    videoFailMode.failShots = new Set([1]) // 镜 2（index 1）供给失败
    const job = await jobService.enqueue({ contentId: content.id, versionId: version.id, type: 'video.storyboard' })

    // ---- 第一轮：镜 1 全成、镜 2 视频败 → Job 失败回队（诚实失败，不回落） ----
    const first = await runJobOnce(job.id, content.id, version.id, user.id)
    expect(first).toBe('failed')
    const failedJob = await db.generationJob.findUnique({ where: { id: job.id } })
    expect(failedJob?.status).toBe('queued') // 可重试回队（退避窗口内）
    expect(failedJob?.error).toContain('镜头 2 原生视频生成失败')
    expect(failedJob?.error).toContain('从缺口续跑')

    const out1 = await readOutput(job.id)
    const assets1 = out1.shotAssets as Array<{ shotIndex: number; imageAssetId: string; videoAssetId?: string }>
    expect(assets1).toHaveLength(2) // 两镜画面都已可见（渐进可见不因失败闪断）
    expect(assets1[0]!.videoAssetId).toBeTruthy() // 镜 1 已完整
    expect(assets1[1]!.videoAssetId).toBeUndefined() // 镜 2 缺视频（断点）
    const imageCallsAfterFirst = counters.image // = 2
    const videoCallsAfterFirst = counters.video // = 1 成 + 3 次退避重试耗尽 = 4
    expect(imageCallsAfterFirst).toBe(2)
    expect(videoCallsAfterFirst).toBe(4)

    // 零回落证据：不出现任何 native-fallback / composition 标记
    const events = await db.provenance.findMany({ where: { contentId: content.id } })
    expect(events.filter((e) => e.model === 'native-fallback')).toHaveLength(0)

    // ---- 第二轮（worker 重入队语义：退避窗口手动过期后重跑） ----
    await db.generationJob.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000), retryCount: 1, status: 'queued' },
    })
    videoFailMode.failShots = new Set() // 供给恢复
    const second = await runJobOnce(job.id, content.id, version.id, user.id)
    expect(second).toBe('done')

    // 断点续跑核心断言：
    expect(counters.image).toBe(2) // 图像零重烧（镜 1 整镜跳过 + 镜 2 复用已质检图）
    expect(counters.video).toBe(videoCallsAfterFirst + 1) // 只补镜 2 的视频（1 次成功调用）
    expect(counters.vision).toBe(4) // 门只在首次生成时跑（复用镜头不再评审）

    const out2 = await readOutput(job.id)
    const assets2 = out2.shotAssets as Array<{ shotIndex: number; imageAssetId: string; videoAssetId?: string }>
    expect(assets2).toHaveLength(2)
    expect(assets2.every((e) => e.videoAssetId)).toBe(true) // 补齐 → 2/2 native
    expect(assets2[0]!.imageAssetId).toBe(assets1[0]!.imageAssetId) // 镜 1 资产原样复用
    expect(assets2[1]!.imageAssetId).toBe(assets1[1]!.imageAssetId) // 镜 2 图像也复用（不重烧）
    expect(computeGenerationMode(JSON.stringify({ shotAssets: assets2 }))?.mode).toBe('native')

    // TTS 只在第二轮跑（第一轮在视频阶段就抛出）——配音 2 次
    expect(counters.tts).toBe(2)
  })

  it('视频门严格缺陷（水印）重试耗尽 → 诚实失败（pass=false 不静默放行）', async () => {
    const { user, content, version } = await seedGeneratingContent('视频门走查')
    // 水印版 vision：图像门 pass；视频门 fail（watermark=true）——按 purpose 区分
    const watermarkVision: VisionReviewProvider = {
      id: 'fake-vision',
      capability: 'vision.review',
      model: 'fake-vision-model',
      async execute(_payload, ctx) {
        counters.vision++
        if (ctx.purpose === 'gate.video') {
          return {
            text: JSON.stringify({
              pass: false,
              scores: { character: 9, scene: 9, style: 9, technical: 2 },
              watermark: true,
              issues: ['右下角检测到水印'],
              summary: '有水印',
            }),
          }
        }
        return { text: JSON.stringify(passVerdict) }
      },
    }
    registerProvider(watermarkVision) // 覆盖同 id

    const job = await jobService.enqueue({ contentId: content.id, versionId: version.id, type: 'video.storyboard' })
    const outcome = await runJobOnce(job.id, content.id, version.id, user.id)
    expect(outcome).toBe('failed')
    const failedJob = await db.generationJob.findUnique({ where: { id: job.id } })
    expect(failedJob?.error).toContain('未通过质检')
    expect(failedJob?.error).toContain('水印')
    // 重试预算：双镜并行各 1 次首生成 + 1 次严格缺陷重试（MAX_VIDEO_REGENS=1）= 4 次视频调用
    expect(counters.video).toBe(4)
    // 零回落：没有 videoAssetId 落库（宁缺毋滥，绝不带水印成片）
    const out = await readOutput(job.id)
    const assets = out.shotAssets as Array<{ videoAssetId?: string }>
    expect(assets.every((e) => !e.videoAssetId)).toBe(true)
  })
})
