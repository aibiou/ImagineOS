// 生成管线执行器（workers 层 —— 组合式视频管线的编排核心，ADR-0001）
// 四个 Job 类型：
//   story.draft    ：故事展开 LLM（PLANNING→STORY）——规划层异步化（2026-10-09 UX 反馈）
//   storyboard.plan：分镜拆解 LLM（STORY→STORYBOARD）——同上
//   video.storyboard：逐镜头图像生成 + 旁白 TTS（GENERATING 阶段）→ 完成后 GENERATING→REVIEW
//   video.render   ：FFmpeg 合成（RENDERING 阶段）→ 产出 MP4+封面 → RENDERING→READY
// 铁律：
//   - 失败绝不丢用户工作：Job failed 时状态机原地不动（§51 失败可恢复）
//   - 每步进度写 Job.outputJson（前端轮询可见，UX 原则五）
//   - 资产 hash 去重（重试幂等，T6.1.2）
//   - 绝不靠长 HTTP 请求维持生成（§53）——规划层 LLM 同样入队，前端轮询接续（刷新不丢、不重复烧配额）

import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { router, hasVideoShotProvider } from '@/ai/router/registry'
import { createCallSerializer } from '@/ai/router/call-serializer'
import type { ImageSize, ProviderCallContext } from '@/ai/router/types'
import { generateStoryDraft, generateStoryboard } from '@/ai/planning/story'
import { intentService } from '@/core/intent/intent-service'
import { planService } from '@/core/planning/plan-service'
import { jobService, NonRetryableJobError } from '@/core/jobs/job-service'
import { contentRepo } from '@/core/repositories/content-repo'
import { provenanceRepo } from '@/core/repositories/provenance-repo'
import { versionRepo } from '@/core/repositories/version-repo'
import { contentService } from '@/core/content/content-service'
import { assetService } from '@/core/assets/asset-service'
import { parseStructure, type ShotSnapshot, type VersionStructure } from '@/core/content/schemas'
import { imagePromptFor, videoPromptFor } from '@/core/content/shot-prompt'
import { aspectRatioOf, imageSizeForAspect, renderDimensionsForAspect, videoSizeForAspect } from '@/core/content/aspect'
import { motionModeFor, storyboardModeDecision } from '@/core/content/storyboard-mode'
import { composeVideo, cleanupWorkDir } from '@/media/ffmpeg'
import { storageRoot } from '@/infra/storage'
import { db } from '@/lib/db'

interface JobPayload {
  contentId: string
  versionId: string | null
  actorId: string | null
}

function parseJobPayload(inputJson: string): JobPayload {
  let parsed: Partial<JobPayload>
  try {
    parsed = JSON.parse(inputJson || '{}') as Partial<JobPayload>
  } catch {
    throw new NonRetryableJobError('Job 参数损坏（payload 非法 JSON）')
  }
  return {
    contentId: parsed.contentId ?? '',
    versionId: parsed.versionId ?? null,
    actorId: parsed.actorId ?? null,
  }
}

async function loadContext(payload: JobPayload) {
  const content = await contentRepo.findById(db, payload.contentId)
  if (!content) throw new NonRetryableJobError(`作品不存在：${payload.contentId}`)
  const versionId = payload.versionId ?? content.currentVersionId
  const version = versionId ? await versionRepo.findById(db, versionId) : null
  if (!version) throw new NonRetryableJobError('作品没有可生成的版本（配方缺失）')
  let structure: VersionStructure
  try {
    structure = parseStructure(version.structureJson)
  } catch {
    throw new NonRetryableJobError('配方数据损坏（无法解析版本结构），请在分镜步骤重新生成')
  }
  return { content, version, structure }
}

function allShots(structure: VersionStructure): ShotSnapshot[] {
  return (structure.story?.scenes ?? []).flatMap((s) => s.shots)
}

/** 画幅映射：配方密封的 aspectRatio（缺省 9:16 竖屏向后兼容）→ 图像生成尺寸（多画幅支持） */
function imageSizeFor(structure: VersionStructure): ImageSize {
  return imageSizeForAspect(aspectRatioOf(structure))
}

/** 运动环境开关（ADR-0001 Rev.3：产品默认 native-first；双开关均为运维/评估逃生阀） */
const MOTION_ENV = {
  forceNative: process.env.IMAGINEOS_FORCE_NATIVE === '1',
  forceComposition: process.env.IMAGINEOS_FORCE_COMPOSITION === '1',
}

/** native 视频调用串行化（模块级：全进程一个队列）。
 *  根因（2026-10-08 E2E 实证）：IMAGE_CONCURRENCY=2 使两镜视频并发提交，而 zai key
 *  视频并发=1——后提交者 429，600ms 退避 3 连烧穿即回落合成（5 镜 4 亡）。串行化后
 *  全镜视频提交排队（提交+轮询+下载全周期互斥）；图像/TTS 并发不变。
 *  图像/视频提示词统一由 shot-prompt 纯函数模块组装（含人物视觉锚点注入）——
 *  执行层确定性增强，不回写密封配方。 */
const serializeVideoCall = createCallSerializer()

/** 安全推进（Job 驱动；若 UI 侧已推进到目标态则跳过） */
async function safeAdvance(contentId: string, to: string, actorId: string | null, note: string) {
  try {
    await contentService.advanceStatus(contentId, to, actorId ?? 'system', { actorType: 'system', note })
  } catch (e) {
    const content = await contentRepo.findById(db, contentId)
    if (content?.status === to) return // 已在目标态（并发推进），幂等跳过
    console.warn(`[pipeline] 状态推进 ${to} 失败（继续执行 Job，不阻塞产物）：${e instanceof Error ? e.message : e}`)
  }
}

// ---------------- Job: story.draft / storyboard.plan（规划层 LLM 异步化） ----------------

/** 前置校验（与同步路由同一套语义）：状态不匹配时幂等完成而非报错——
 *  覆盖租约过期重入队后，另一副本已完成推进的并发场景（双写防护）。 */
async function requireContentInStatus(payload: JobPayload & { jobId: string }, expected: string) {
  const content = await contentRepo.findById(db, payload.contentId)
  if (!content) throw new NonRetryableJobError(`作品不存在：${payload.contentId}`)
  if (content.status !== expected) {
    await jobService.complete(payload.jobId, { stage: 'skipped', reason: `状态已是 ${content.status}（另一任务已推进）` })
    return null
  }
  return content
}

export async function executeStoryDraftJob(jobId: string, payload: JobPayload): Promise<void> {
  const content = await requireContentInStatus({ ...payload, jobId }, 'PLANNING')
  if (!content) return
  const record = await intentService.requireRecord(content.id)
  const concept = await planService.requireConcept(content.id)

  await jobService.reportProgress(jobId, { stage: 'writing', label: '正在展开你的故事…' })

  const story = await generateStoryDraft(record, concept, {
    contentId: content.id,
    versionId: content.currentVersionId,
    purpose: 'story.generate',
    actorId: payload.actorId,
  })
  await planService.saveStoryDraft(content.id, story, payload.actorId ?? 'system')

  await jobService.complete(jobId, {
    stage: 'done',
    scenes: story.scenes.length,
    label: `故事已展开：${story.logline}`,
  })
}

export async function executeStoryboardPlanJob(jobId: string, payload: JobPayload): Promise<void> {
  const content = await requireContentInStatus({ ...payload, jobId }, 'STORY')
  if (!content) return
  const record = await intentService.requireRecord(content.id)
  const concept = await planService.requireConcept(content.id)
  const workingStory = await planService.getWorkingStory(content.id)
  if (!workingStory) throw new NonRetryableJobError('故事还没写（先展开故事）')

  await jobService.reportProgress(jobId, { stage: 'planning', label: '正在拆分镜头…' })

  const storyboard = await generateStoryboard(record, concept, workingStory, {
    contentId: content.id,
    versionId: content.currentVersionId,
    purpose: 'storyboard.generate',
    actorId: payload.actorId,
  })
  await planService.saveStoryboard(content.id, storyboard, payload.actorId ?? 'system')

  const shotCount = storyboard.scenes.reduce((n, s) => n + s.shots.length, 0)
  await jobService.complete(jobId, {
    stage: 'done',
    scenes: storyboard.scenes.length,
    shots: shotCount,
    label: `分镜已就绪：${storyboard.scenes.length} 个场景 · ${shotCount} 个镜头。`,
  })
}

// ---------------- Job: video.storyboard ----------------

export async function executeStoryboardJob(jobId: string, payload: JobPayload): Promise<void> {
  const { content, version, structure } = await loadContext(payload)
  const ctx: ProviderCallContext = {
    contentId: content.id,
    versionId: version.id,
    purpose: 'shot.image',
    actorId: payload.actorId,
  }
  const shots = allShots(structure)
  if (shots.length === 0) throw new NonRetryableJobError('配方中没有镜头（先完成分镜）')
  const size = imageSizeFor(structure)
  const videoSize = videoSizeForAspect(aspectRatioOf(structure))

  // ---- 路由决策日志（审计 R3）：意图口径；实际产物以 computeGenerationMode（shotAssets）为准，
  // 两者差异 = 回落证据（native-fallback 事件逐镜头补充原因）
  const modeDecision = storyboardModeDecision(shots, MOTION_ENV.forceNative, MOTION_ENV.forceComposition)
  await provenanceRepo.append(db, {
    contentId: content.id,
    versionId: version.id,
    eventType: 'ai_generated',
    actorType: 'system',
    provider: 'pipeline',
    model: 'mode-decision',
    payload: { stage: 'mode.decision', ...modeDecision, videoProviderAvailable: hasVideoShotProvider() },
  })

  const shotAssets: Array<{ shotIndex: number; imageAssetId: string; videoAssetId?: string; ttsAssetId?: string }> = []

  // ---- 图像 + 可选原生视频（逐镜头；并发 2 提速，进度按完成数上报） ----
  // 渐进可见（UX 原则五，2026-10-07 用户反馈「怎么黑盒的」）：镜头图片在保存后立即入进度载荷
  // （shotAssets 快照），前端轮询即刻渲染——图片秒级到达，native 视频（60–250s/镜）后到补齐；
  // 进度计数 current 口径 = 该镜全部完成（图+视频），进度条不虚高。
  const IMAGE_CONCURRENCY = 2
  let imageDone = 0
  const imagesStageLabel = (done: number, total: number): string =>
    modeDecision.mode === 'composition'
      ? `正在绘制镜头画面（${done}/${total}）…`
      : `正在生成 AI 视频镜头（${done}/${total}）…`
  const imageTasks = shots.map((shot, i) => async () => {
    const { result } = await router.image(
      { prompt: imagePromptFor(shot, structure), size },
      { ...ctx, purpose: 'shot.image' },
    )
    const imageAsset = await assetService.save({
      contentId: content.id,
      ownerId: content.ownerId,
      kind: 'generated',
      data: Buffer.from(result.base64, 'base64'),
      declaredMime: result.mime,
    })
    const entry: { shotIndex: number; imageAssetId: string; videoAssetId?: string; ttsAssetId?: string } = {
      shotIndex: i,
      imageAssetId: imageAsset.id,
    }

    // native 路径（ADR-0001 Rev.3 产品默认）：首帧图生视频；失败逐镜回落组合式（不丢用户工作）
    if (motionModeFor(shot, MOTION_ENV) === 'native' && hasVideoShotProvider()) {
      // 图片先入进度（首帧已可渲染，视频生成期间不再是黑盒）
      shotAssets.push(entry)
      await jobService.reportProgress(jobId, {
        stage: 'images',
        current: imageDone,
        total: shots.length,
        label: imagesStageLabel(imageDone, shots.length),
        shotAssets: shotAssets.slice(),
      })
      try {
        const { result: videoResult } = await serializeVideoCall(() =>
          router.video(
            {
              prompt: videoPromptFor(shot, structure),
              imageUrl: `data:${result.mime};base64,${result.base64}`,
              size: videoSize,
              speedFirst: true,
            },
            { ...ctx, purpose: 'shot.video' },
          ),
        )
        const videoAsset = await assetService.save({
          contentId: content.id,
          ownerId: content.ownerId,
          kind: 'generated',
          data: Buffer.from(videoResult.base64, 'base64'),
          declaredMime: videoResult.mime,
        })
        entry.videoAssetId = videoAsset.id
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.warn(`[pipeline] 镜头 ${i + 1} 原生视频生成失败，回落组合式（Ken Burns）：${message}`)
        await provenanceRepo.append(db, {
          contentId: content.id,
          versionId: version.id,
          eventType: 'ai_generated',
          actorType: 'ai',
          provider: 'pipeline',
          model: 'native-fallback',
          payload: { stage: 'video.shot.fallback', shotIndex: i, error: message.slice(0, 300) },
        })
      }
    } else {
      shotAssets.push(entry)
    }

    imageDone++
    await jobService.reportProgress(jobId, {
      stage: 'images',
      current: imageDone,
      total: shots.length,
      label: imagesStageLabel(imageDone, shots.length),
      shotAssets: shotAssets.slice(),
    })
  })
  for (let start = 0; start < imageTasks.length; start += IMAGE_CONCURRENCY) {
    await Promise.all(imageTasks.slice(start, start + IMAGE_CONCURRENCY).map((t) => t()))
  }

  // ---- TTS 旁白（并发 3） ----
  let ttsDone = 0
  const ttsTasks = shots
    .map((shot, i) => ({ shot, i }))
    .filter(({ shot }) => shot.narrationLine?.trim())
    .map(({ shot, i }) => async () => {
      const { result } = await router.tts(
        { text: shot.narrationLine! },
        { ...ctx, purpose: 'narration.tts' },
    )
    const ttsAsset = await assetService.save({
      contentId: content.id,
      ownerId: content.ownerId,
      kind: 'generated',
      data: Buffer.from(result.base64, 'base64'),
      declaredMime: result.mime,
    })
    const entry = shotAssets.find((s) => s.shotIndex === i)
    if (entry) entry.ttsAssetId = ttsAsset.id
    ttsDone++
    await jobService.reportProgress(jobId, {
      stage: 'narration',
      current: ttsDone,
      total: shots.length,
      label: `正在为镜头配音（${ttsDone}/${shots.length}）…`,
    })
  })
  const TTS_CONCURRENCY = 3
  for (let start = 0; start < ttsTasks.length; start += TTS_CONCURRENCY) {
    await Promise.all(ttsTasks.slice(start, start + TTS_CONCURRENCY).map((t) => t()))
  }

  // ---- 完成：GENERATING→REVIEW ----
  await jobService.reportProgress(jobId, { stage: 'storyboard_done', label: '画面与配音已就绪，去预览分镜' })
  await safeAdvance(content.id, 'REVIEW', payload.actorId, 'storyboard job 完成')
  await provenanceRepo.append(db, {
    contentId: content.id,
    versionId: version.id,
    eventType: 'ai_generated',
    actorType: 'ai',
    provider: 'pipeline',
    model: 'composite-storyboard',
    payload: { stage: 'storyboard.done', shots: shots.length },
  })
  await jobService.complete(jobId, {
    stage: 'done',
    shots: shots.length,
    shotAssets,
  })
}

// ---------------- Job: video.render ----------------

export async function executeRenderJob(jobId: string, payload: JobPayload): Promise<void> {
  const { content, version, structure } = await loadContext(payload)
  const storyboardJob = await jobService.latestSucceededJob(content.id, version.id, 'video.storyboard')
  if (!storyboardJob?.outputJson) throw new Error('找不到已完成的分镜生成记录（先完成画面生成）')

  const sbOutput = JSON.parse(storyboardJob.outputJson) as {
    shotAssets?: Array<{ shotIndex: number; imageAssetId: string; videoAssetId?: string; ttsAssetId?: string }>
  }
  const shotAssets = sbOutput.shotAssets ?? []
  const shots = allShots(structure)
  if (shotAssets.length === 0 || shots.length === 0) throw new Error('镜头资产缺失')

  await jobService.reportProgress(jobId, { stage: 'composing', label: '正在合成你的视频（运镜、转场、配乐、字幕）…', progress: 0.1 })

  // ---- 组装合成输入 ----
  const workDir = join(storageRoot(), '..', 'tmp', `job-${jobId}`)
  await mkdir(workDir, { recursive: true })

  // 资产路径解析
  const resolved: Array<{
    imagePath: string
    videoPath?: string
    durationMs: number
    cameraMotion: string
    narrationPath?: string
    narrationLine?: string
  }> = []
  for (const { entry, shot } of shotAssets
    .slice()
    .sort((a, b) => a.shotIndex - b.shotIndex)
    .map((entry) => ({ entry, shot: shots[entry.shotIndex] ?? shots[0]! }))) {
    const imageAsset = await assetService.getById(entry.imageAssetId)
    if (!imageAsset) throw new Error(`镜头 ${entry.shotIndex + 1} 的图像资产不存在`)
    let videoPath: string | undefined
    if (entry.videoAssetId) {
      const videoAsset = await assetService.getById(entry.videoAssetId)
      if (videoAsset) videoPath = assetService.resolveLocalPath(videoAsset.storageLocation)
    }
    let narrationPath: string | undefined
    if (entry.ttsAssetId) {
      const ttsAsset = await assetService.getById(entry.ttsAssetId)
      if (ttsAsset) narrationPath = assetService.resolveLocalPath(ttsAsset.storageLocation)
    }
    resolved.push({
      imagePath: assetService.resolveLocalPath(imageAsset.storageLocation),
      videoPath,
      durationMs: shot.durationMs ?? 6000,
      cameraMotion: shot.cameraMotion ?? 'zoom_in',
      narrationPath,
      narrationLine: shot.narrationLine ?? undefined,
    })
  }

  const videoPath = join(workDir, 'out-final.mp4')
  const posterPath = join(workDir, 'out-poster.jpg')
  // 画幅感知渲染尺寸（配方 aspectRatio；缺省 9:16 向后兼容）——图像/视频/字幕/资产宽高同源
  const { width: renderW, height: renderH } = renderDimensionsForAspect(aspectRatioOf(structure))

  await jobService.reportProgress(jobId, { stage: 'composing', label: '正在合成你的视频…', progress: 0.3 })

  const composeResult = await composeVideo({
    shots: resolved.map((s) => ({
      imagePath: s.imagePath,
      videoPath: s.videoPath,
      durationMs: s.durationMs,
      cameraMotion: (['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static'] as const).includes(s.cameraMotion as never)
        ? (s.cameraMotion as 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'static')
        : 'zoom_in',
      narrationPath: s.narrationPath,
      narrationLine: s.narrationLine,
    })),
    width: renderW,
    height: renderH,
    fps: 25,
    transitionMs: 600,
    narrationLeadMs: 350,
    narrationTailMs: 500,
    subtitles: {
      lines: [],
      fontPath: '/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf',
    },
    outPath: videoPath,
    posterPath,
    workDir,
  })

  await jobService.reportProgress(jobId, { stage: 'saving', label: '正在保存成片…', progress: 0.8 })

  // ---- 资产入库（final + thumbnail） ----
  const { readFile } = await import('node:fs/promises')
  const videoBuf = await readFile(videoPath)
  const posterBuf = await readFile(posterPath)
  const finalAsset = await assetService.save({
    contentId: content.id,
    ownerId: content.ownerId,
    kind: 'final',
    data: videoBuf,
    declaredMime: 'video/mp4',
    durationMs: composeResult.durationMs,
    width: renderW,
    height: renderH,
  })
  const posterAsset = await assetService.save({
    contentId: content.id,
    ownerId: content.ownerId,
    kind: 'thumbnail',
    data: posterBuf,
    declaredMime: 'image/jpeg',
  })

  // ---- 完成：RENDERING→READY ----
  await safeAdvance(content.id, 'READY', payload.actorId, 'render job 完成')
  await provenanceRepo.append(db, {
    contentId: content.id,
    versionId: version.id,
    eventType: 'ai_generated',
    actorType: 'ai',
    provider: 'pipeline',
    model: 'composite-render',
    payload: { stage: 'render.done', durationMs: composeResult.durationMs, finalAssetId: finalAsset.id, aspectRatio: aspectRatioOf(structure), resolution: `${renderW}x${renderH}` },
  })
  await jobService.complete(jobId, {
    stage: 'done',
    finalAssetId: finalAsset.id,
    posterAssetId: posterAsset.id,
    durationMs: composeResult.durationMs,
  })

  // 清理（含临时产物；失败现场保留供诊断）
  await cleanupWorkDir(workDir)
}

// ---------------- 分发 ----------------

export async function executeJob(jobId: string, type: string, inputJson: string): Promise<void> {
  const payload = parseJobPayload(inputJson)
  if (!payload.contentId) throw new NonRetryableJobError('Job 缺少 contentId')
  if (type === 'story.draft') return executeStoryDraftJob(jobId, payload)
  if (type === 'storyboard.plan') return executeStoryboardPlanJob(jobId, payload)
  if (type === 'video.storyboard') return executeStoryboardJob(jobId, payload)
  if (type === 'video.render') return executeRenderJob(jobId, payload)
  throw new NonRetryableJobError(`未知 Job 类型：${type}`)
}
