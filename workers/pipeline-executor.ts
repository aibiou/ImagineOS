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

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { router, hasVideoShotProvider } from '@/ai/router/registry'
import { createPacedVideoScheduler } from '@/ai/router/video-pacer'
import type { ImageSize, ProviderCallContext, VideoShotResult } from '@/ai/router/types'
import { generateStoryDraft, generateStoryboard } from '@/ai/planning/story'
import { generateDirections } from '@/ai/planning/directions'
import { planRevision } from '@/ai/revision/locator'
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
import {
  EXEMPLAR_THRESHOLD,
  compositeScore,
  gateFactsFor,
  imageGateEnabled,
  pickBestAttempt,
  shouldRegenerate,
  variantImagePrompt,
  videoGateEnabled,
  MAX_VIDEO_REGENS,
  type GateAttempt,
} from '@/core/quality/shot-gate'
import { reviewImage, reviewVideo } from '@/ai/quality/vision-review'
import { exemplarService } from '@/core/quality/exemplar-service'
import { composeVideo, cleanupWorkDir, extractMidFrame } from '@/media/ffmpeg'
import { storageRoot } from '@/infra/storage'
import { db } from '@/lib/db'

interface JobPayload {
  contentId: string
  versionId: string | null
  actorId: string | null
  /** 跨 Job 断点续跑（供给受限世界的恢复语义）：regenerate 从 GENERATING 失败态入队时置 true——
   *  执行器将从同版本最近一次失败/超时的 storyboard Job 进度中打捞已完成镜头（只补缺口，不重烧）。
   *  REVIEW/READY 的「换一批」 regenerate 不携带此标记（语义 = 全新批次，用户主动要求重画）。 */
  resumeFromFailed?: boolean
  /** 修订定位（025 战线二，计算型 Job）：用户反馈原文——结果存 outputJson，不推进状态机 */
  feedback?: string
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
    resumeFromFailed: parsed.resumeFromFailed === true,
    feedback: typeof parsed.feedback === 'string' ? parsed.feedback : undefined,
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

/** native 视频调用：节奏化串行（设计见 docs/design/quality-reproduction.md §3.2）。
 *  提交间隔下限（默认 61s，IMAGINEOS_VIDEO_SUBMIT_GAP_MS 可调）与 agnes 免费档 RPM=1 对齐——
 *  429 从常态变意外（router 内冷却重试继续夺救）；互斥与 FIFO 语义同旧 serializeVideoCall。 */
const pacedVideoCall = createPacedVideoScheduler()

/** 镜头资产条目（含质量门摘要——前端进度/预览的诚实徽章数据源） */
interface ShotAssetEntry {
  shotIndex: number
  imageAssetId: string
  videoAssetId?: string
  ttsAssetId?: string
  gate?: { pass: boolean; skipped: boolean; score: number | null; attempts: number; issues: string[] }
  videoGate?: { pass: boolean; skipped: boolean; score: number | null }
}

/** 断点续跑：读取本 Job 已持久化的进度载荷（fail→requeue 后 outputJson 保留） */
async function loadPriorEntries(jobId: string): Promise<Map<number, ShotAssetEntry>> {
  const out = new Map<number, ShotAssetEntry>()
  const job = await jobService.getJob(jobId)
  if (!job?.outputJson) return out
  try {
    const parsed = JSON.parse(job.outputJson) as { shotAssets?: ShotAssetEntry[] }
    if (Array.isArray(parsed.shotAssets)) {
      for (const e of parsed.shotAssets) {
        if (e && typeof e.shotIndex === 'number' && typeof e.imageAssetId === 'string') {
          out.set(e.shotIndex, e)
        }
      }
    }
  } catch { /* 脏载荷容错：当无进度 */ }
  return out
}

/** 跨 Job 打捞（设计 §3.3 延伸）：失败后「重新生成」的新 Job 从同版本最近失败/超时的
 *  storyboard Job 进度里恢复已完成镜头——供给受限世界里，用户点「重新生成」的代价
 *  从「整片重烧」降为「只补缺口」（已成功的 native 视频供给不重烧）。
 *  逐镜头有效性由 imageTasks 的 A/B 分支照常校验（gate.pass + 资产健在）——
 *  门挂了的图（如水印镜）不会被复用，会重走质量门。 */
async function salvagePriorEntriesFromFailedJob(
  contentId: string,
  versionId: string | null,
): Promise<{ entries: Map<number, ShotAssetEntry>; salvagedFromJobId: string | null }> {
  const failedJob = await db.generationJob.findFirst({
    where: {
      contentId,
      versionId,
      type: 'video.storyboard',
      status: { in: ['failed', 'timeout'] },
    },
    orderBy: { completedAt: 'desc' },
  })
  const out = new Map<number, ShotAssetEntry>()
  if (!failedJob?.outputJson) return { entries: out, salvagedFromJobId: null }
  try {
    const parsed = JSON.parse(failedJob.outputJson) as { shotAssets?: ShotAssetEntry[] }
    if (Array.isArray(parsed.shotAssets)) {
      for (const e of parsed.shotAssets) {
        if (e && typeof e.shotIndex === 'number' && typeof e.imageAssetId === 'string') {
          out.set(e.shotIndex, e)
        }
      }
    }
  } catch { /* 脏载荷容错：当无进度 */ }
  return { entries: out, salvagedFromJobId: failedJob.id }
}

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

  // 经验复利（025 战线三）：跨项目高分范例的 prompt 写法注入分镜教学——高分沉淀反哺新项目
  const exemplarPrompts = await exemplarService.topPromptsForTeaching(3).catch(() => [])
  const storyboard = await generateStoryboard(record, concept, workingStory, {
    contentId: content.id,
    versionId: content.currentVersionId,
    purpose: 'storyboard.generate',
    actorId: payload.actorId,
  }, { exemplarPrompts })
  await planService.saveStoryboard(content.id, storyboard, payload.actorId ?? 'system')

  const shotCount = storyboard.scenes.reduce((n, s) => n + s.shots.length, 0)
  await jobService.complete(jobId, {
    stage: 'done',
    scenes: storyboard.scenes.length,
    shots: shotCount,
    label: `分镜已就绪：${storyboard.scenes.length} 个场景 · ${shotCount} 个镜头。`,
  })
}

// ---------------- Job: intent.directions（025 战线二：选方向同步等待清零） ----------------

export async function executeDirectionsJob(jobId: string, payload: JobPayload): Promise<void> {
  const content = await requireContentInStatus({ ...payload, jobId }, 'INTENT')
  if (!content) return
  const record = await intentService.requireRecord(content.id)

  await jobService.reportProgress(jobId, { stage: 'ideating', label: '正在为你构思几个创作方向…' })

  const directions = await generateDirections(record, {
    contentId: content.id,
    versionId: content.currentVersionId,
    purpose: 'directions.generate',
    actorId: payload.actorId,
  })
  await planService.saveDirections(content.id, directions, payload.actorId ?? 'system')

  await jobService.complete(jobId, {
    stage: 'done',
    count: directions.length,
    label: `已备好 ${directions.length} 个创作方向，挑一个你心动的。`,
  })
}

// ---------------- Job: revision.plan（025 战线二：计算型 Job 首例） ----------------
// 不推进状态机（REVIEW 原地）；plan+structure+feedback 存 outputJson，前端按 jobId 轮询取用。
// 被 supersede（用户改反馈重提）的 Job：complete 条件写已拦，LLM 结果自然作废。

export async function executeRevisionPlanJob(jobId: string, payload: JobPayload): Promise<void> {
  const feedback = payload.feedback?.trim()
  if (!feedback || feedback.length < 2) throw new NonRetryableJobError('修订反馈缺失或太短')
  const version = payload.versionId ? await versionRepo.findById(db, payload.versionId) : null
  if (!version?.structureJson) throw new NonRetryableJobError('配方不存在（先完成一次生成，再修改）')
  const structure = parseStructure(version.structureJson)

  await jobService.reportProgress(jobId, { stage: 'locating', label: '正在思考怎么改…' })

  const outcome = await planRevision(feedback, structure, {
    contentId: payload.contentId,
    versionId: version.id,
    purpose: 'revision.locate',
    actorId: payload.actorId,
  })
  await jobService.complete(jobId, {
    stage: 'done',
    plan: outcome.plan,
    structure: outcome.structure,
    feedback,
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

  // ---- 断点续跑（设计 §3.3）：失败重入队/用户重试后，从本 Job 已持久化进度恢复——
  // 只补缺口（无视频补视频、无图补图），绝不整片重烧供给配额。
  // 跨 Job 打捞：新 Job（regenerate 恢复入口）自身无进度时，从同版本最近失败 Job 恢复。
  const ownPriorEntries = await loadPriorEntries(jobId)
  let priorEntries = ownPriorEntries
  let salvagedFromJobId: string | null = null
  if (ownPriorEntries.size === 0 && payload.resumeFromFailed) {
    const salvaged = await salvagePriorEntriesFromFailedJob(content.id, version.id)
    if (salvaged.entries.size > 0) {
      priorEntries = salvaged.entries
      salvagedFromJobId = salvaged.salvagedFromJobId
      await provenanceRepo.append(db, {
        contentId: content.id,
        versionId: version.id,
        eventType: 'ai_generated',
        actorType: 'system',
        provider: 'pipeline',
        model: 'storyboard.resume',
        payload: {
          stage: 'resume.salvage',
          salvagedShots: salvaged.entries.size,
          salvagedFromJobId: salvaged.salvagedFromJobId,
          note: '重新生成从未完成镜头续跑（已完成镜头零重烧）',
        },
      }).catch(() => {})
    }
  }
  const entriesByIndex = new Map<number, ShotAssetEntry>()
  for (const [idx, e] of priorEntries) entriesByIndex.set(idx, { ...e })
  const resumedCount = priorEntries.size
  const entriesSnapshot = (): ShotAssetEntry[] =>
    [...entriesByIndex.values()].sort((a, b) => a.shotIndex - b.shotIndex)

  // ---- 图像（质量门循环）+ 可选原生视频（节奏化 + 无回落） ----
  // 渐进可见（UX 原则五，2026-10-07 用户反馈「怎么黑盒的」）：镜头图片在保存后立即入进度载荷
  // （shotAssets 快照），前端轮询即刻渲染——图片秒级到达，native 视频（60–250s/镜，RPM=1 排队下更长）
  // 后到补齐；进度计数 current 口径 = 该镜全部完成（图+视频），进度条不虚高。
  const IMAGE_CONCURRENCY = 2
  let imageDone = 0
  const imagesStageLabel = (done: number, total: number): string =>
    modeDecision.mode === 'composition'
      ? `正在绘制镜头画面（${done}/${total}）…`
      : `正在生成 AI 视频镜头（${done}/${total}）…`
  const gateWorkDir = join(storageRoot(), '..', 'tmp', `gate-${jobId}`)
  await mkdir(gateWorkDir, { recursive: true })

  /** 图像 + 质量门（预算内变体重抽择优 = 有界 best-of-N）；参考帧 = 同片高分范例 */
  async function generateGatedImage(
    shot: ShotSnapshot,
    i: number,
  ): Promise<{ entry: ShotAssetEntry; imageBase64: string; imageMime: string }> {
    const basePrompt = imagePromptFor(shot, structure)
    const facts = gateFactsFor(shot, structure)
    const reference = imageGateEnabled() ? await exemplarService.latestReferenceFor(content.id).catch(() => null) : null
    const attempts: GateAttempt[] = []
    let prompt = basePrompt
    for (let attempt = 1; ; attempt++) {
      const { result } = await router.image({ prompt, size }, { ...ctx, purpose: 'shot.image' })
      const verdict = imageGateEnabled() ? await reviewImage(result.base64, result.mime, facts, reference, ctx) : null
      attempts.push({ imageBase64: result.base64, mime: result.mime, verdict })
      if (!imageGateEnabled()) break // 门关闭：单次直过（评估对照模式）
      if (!shouldRegenerate(attempts)) break
      const lastIssues = attempts[attempts.length - 1]!.verdict?.issues ?? []
      prompt = variantImagePrompt(basePrompt, lastIssues, attempt, facts.shotSize)
    }
    const { best, skipped } = pickBestAttempt(attempts)
    const bestVerdict = best.verdict
    const score = bestVerdict != null ? compositeScore(bestVerdict) : null
    const gateInfo = {
      pass: skipped || !imageGateEnabled() ? true : (bestVerdict?.pass ?? true),
      skipped: skipped || !imageGateEnabled(),
      score,
      attempts: attempts.length,
      issues: bestVerdict?.issues ?? [],
    }
    const imageAsset = await assetService.save({
      contentId: content.id,
      ownerId: content.ownerId,
      kind: 'generated',
      data: Buffer.from(best.imageBase64, 'base64'),
      declaredMime: best.mime,
    })
    // 范例沉淀（经验复利层）：高分镜头「怎么写出来的」完整可回放
    if (imageGateEnabled() && bestVerdict && score != null && score >= EXEMPLAR_THRESHOLD) {
      await exemplarService
        .recordIfQualified(
          {
            contentId: content.id,
            versionId: version.id,
            shotIndex: i,
            assetId: imageAsset.id,
            imagePrompt: basePrompt,
            contextSnapshot: { facts },
            score,
            verdictSummary: bestVerdict.summary,
          },
          EXEMPLAR_THRESHOLD,
        )
        .catch(() => {})
    }
    await provenanceRepo.append(db, {
      contentId: content.id,
      versionId: version.id,
      eventType: 'ai_generated',
      actorType: 'ai',
      provider: 'pipeline',
      model: 'quality-gate',
      payload: { stage: 'image.gate', shotIndex: i, ...gateInfo, referenceUsed: reference != null },
    }).catch(() => {})
    return {
      entry: { shotIndex: i, imageAssetId: imageAsset.id, gate: gateInfo },
      imageBase64: best.imageBase64,
      imageMime: best.mime,
    }
  }

  /** 原生视频：节奏化提交（RPM=1 对齐）+ 抽帧快审（严格缺陷预算内重试）。
   *  失败直接上抛——诚实失败 + 断点续跑（Ken Burns 回落已取缔，设计 §3.1）。 */
  async function generateNativeVideo(
    shot: ShotSnapshot,
    i: number,
    imageBase64: string,
    imageMime: string,
  ): Promise<{ videoAssetId: string; videoGate?: ShotAssetEntry['videoGate'] }> {
    const facts = gateFactsFor(shot, structure)
    const prompt = videoPromptFor(shot, structure)
    const imageUrl = `data:${imageMime};base64,${imageBase64}`
    let lastVerdict: Awaited<ReturnType<typeof reviewVideo>> = null
    let lastResult: VideoShotResult | null = null
    for (let attempt = 1; attempt <= 1 + MAX_VIDEO_REGENS; attempt++) {
      const { result } = await pacedVideoCall(() =>
        router.video({ prompt, imageUrl, size: videoSize, speedFirst: true }, { ...ctx, purpose: 'shot.video' }),
      )
      lastResult = result
      if (!videoGateEnabled()) break
      // 抽中点帧 → 快审（首帧 vs 中点帧：水印/损坏/人物突变）
      let verdict: Awaited<ReturnType<typeof reviewVideo>> = null
      try {
        const videoPath = join(gateWorkDir, `shot-${i}-attempt${attempt}.mp4`)
        const framePath = join(gateWorkDir, `shot-${i}-attempt${attempt}-mid.jpg`)
        await writeFile(videoPath, Buffer.from(result.base64, 'base64'))
        await extractMidFrame(videoPath, framePath)
        const midBase64 = (await readFile(framePath)).toString('base64')
        verdict = await reviewVideo(imageBase64, midBase64, facts, ctx)
        // 注意：不在此处清目录——后续镜头还要写抽帧文件；整个 gateWorkDir 在 Job 完成段统一清理
      } catch {
        verdict = null // 抽帧/评审失败：放行（诚实标注 skipped）
      }
      lastVerdict = verdict
      if (verdict == null) break // 评审不可用：不拦截（可用性优先）
      const strict = verdict.watermark || compositeScore(verdict) < 4
      if (!strict) break // 软性问题只记录不拦截
      if (attempt > MAX_VIDEO_REGENS) {
        throw new Error(
          `镜头 ${i + 1} 原生视频未通过质检（${verdict.watermark ? '检测到水印' : '画面严重缺陷'}：${verdict.issues.slice(0, 2).join('；')}）`,
        )
      }
      console.warn(`[pipeline] 镜头 ${i + 1} 视频严格缺陷，重试（${attempt}/${MAX_VIDEO_REGENS}）：${verdict.issues.join('；')}`)
    }
    const result = lastResult!
    const videoAsset = await assetService.save({
      contentId: content.id,
      ownerId: content.ownerId,
      kind: 'generated',
      data: Buffer.from(result.base64, 'base64'),
      declaredMime: result.mime,
    })
    const videoGate = lastVerdict
      ? { pass: lastVerdict.pass, skipped: false, score: compositeScore(lastVerdict) }
      : videoGateEnabled()
        ? { pass: true, skipped: true, score: null }
        : undefined
    return { videoAssetId: videoAsset.id, videoGate }
  }

  const imageTasks = shots.map((shot, i) => async () => {
    const motionMode = motionModeFor(shot, MOTION_ENV)
    const prior = priorEntries.get(i)

    // A. 整镜已完成（composition：图；native：图+视频）且资产健在 → 复用跳过（resume 核心）
    if (prior?.gate?.pass && prior.imageAssetId && (motionMode === 'composition' || prior.videoAssetId)) {
      const imageAsset = await assetService.getById(prior.imageAssetId).catch(() => null)
      const videoAsset =
        motionMode === 'composition' || !prior.videoAssetId
          ? true
          : Boolean(await assetService.getById(prior.videoAssetId).catch(() => null))
      if (imageAsset && videoAsset) {
        entriesByIndex.set(i, { ...prior })
        imageDone++
        await jobService.reportProgress(jobId, {
          stage: 'images',
          current: imageDone,
          total: shots.length,
          label: imagesStageLabel(imageDone, shots.length),
          shotAssets: entriesSnapshot(),
        })
        return
      }
    }

    // B. 图像：native 断在视频的场景复用已质检图（省图像配额），否则走质量门循环
    // imageReused 标记：视频复用的前提——图像重画后旧视频首帧已失配，必须连同重生成（首帧一致性铁律）
    let entry: ShotAssetEntry
    let imageBase64: string
    let imageMime: string
    let imageReused = false
    const priorImageOk = prior?.gate?.pass && prior.imageAssetId != null
    const priorImageAsset = priorImageOk ? await assetService.getById(prior!.imageAssetId).catch(() => null) : null
    if (priorImageAsset) {
      entry = { ...prior! }
      try {
        const buf = await readFile(assetService.resolveLocalPath(priorImageAsset.storageLocation))
        imageBase64 = buf.toString('base64')
        imageMime = priorImageAsset.mime || 'image/png'
        imageReused = true
      } catch {
        const fresh = await generateGatedImage(shot, i)
        entry = fresh.entry
        imageBase64 = fresh.imageBase64
        imageMime = fresh.imageMime
      }
    } else {
      const fresh = await generateGatedImage(shot, i)
      entry = fresh.entry
      imageBase64 = fresh.imageBase64
      imageMime = fresh.imageMime
    }
    entriesByIndex.set(i, entry)

    // 图片先入进度（首帧已可渲染，视频生成期间不再是黑盒）
    await jobService.reportProgress(jobId, {
      stage: 'images',
      current: imageDone,
      total: shots.length,
      label: imagesStageLabel(imageDone, shots.length),
      shotAssets: entriesSnapshot(),
    })

    // C. native 视频：图像也被复用时才复用旧视频（首帧一致性——图像重画则视频连带重生成）；
    //    否则节奏化生成。失败上抛 → Job 可重试失败 → resume 只补本镜
    //    （Ken Burns 回落已取缔：宁可诚实失败，绝不静默降级成幻灯片）
    if (motionMode === 'native' && hasVideoShotProvider()) {
      if (imageReused && prior?.videoAssetId && (await assetService.getById(prior.videoAssetId).catch(() => null))) {
        entry.videoAssetId = prior.videoAssetId
        entry.videoGate = prior.videoGate
      } else {
        const doneCount = entriesSnapshot().filter((e) => {
          const m = e.shotIndex < shots.length ? motionModeFor(shots[e.shotIndex]!, MOTION_ENV) : 'composition'
          return m === 'composition' || e.videoAssetId != null
        }).length
        try {
          const { videoAssetId, videoGate } = await generateNativeVideo(shot, i, imageBase64, imageMime)
          entry.videoAssetId = videoAssetId
          entry.videoGate = videoGate
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          if (process.env.IMAGINEOS_DEBUG_GATE) {
            console.error('[gate-debug] 视频失败原始错误：', e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : e)
          }
          throw new Error(
            `镜头 ${i + 1} 原生视频生成失败：${message}（画面已完成 ${doneCount}/${shots.length} 镜，稍后自动重试并从缺口续跑，已完成镜头不会重烧）`,
          )
        }
      }
    }

    imageDone++
    await jobService.reportProgress(jobId, {
      stage: 'images',
      current: imageDone,
      total: shots.length,
      label: imagesStageLabel(imageDone, shots.length),
      shotAssets: entriesSnapshot(),
    })
  })
  // 并发批次用 allSettled（非 all）：任一镜头失败时，同批在途镜头跑完落库后再抢救快照、统一抛错——
  // 绝不留漂浮任务（其晚到的进度写入会因 Job 已 fail 被忽略 → 续跑丢已完成工作、浪费供给配额）
  for (let start = 0; start < imageTasks.length; start += IMAGE_CONCURRENCY) {
    const settled = await Promise.allSettled(imageTasks.slice(start, start + IMAGE_CONCURRENCY).map((t) => t()))
    const firstError = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
    if (firstError) {
      await jobService
        .reportProgress(jobId, {
          stage: 'images',
          current: imageDone,
          total: shots.length,
          label: imagesStageLabel(imageDone, shots.length),
          shotAssets: entriesSnapshot(),
        })
        .catch(() => {})
      throw firstError.reason
    }
  }

  // ---- TTS 旁白（并发 3；断点续跑：已配好音的镜头复用，不重烧配额） ----
  let ttsDone = 0
  const ttsTasks = shots
    .map((shot, i) => ({ shot, i }))
    .filter(({ shot }) => shot.narrationLine?.trim())
    .map(({ shot, i }) => async () => {
      const entry = entriesByIndex.get(i)
      if (entry?.ttsAssetId && (await assetService.getById(entry.ttsAssetId).catch(() => null))) {
        ttsDone++
        return
      }
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
  await rm(gateWorkDir, { recursive: true, force: true }).catch(() => {})
  await jobService.reportProgress(jobId, { stage: 'storyboard_done', label: '画面与配音已就绪，去预览分镜' })
  await safeAdvance(content.id, 'REVIEW', payload.actorId, 'storyboard job 完成')
  await provenanceRepo.append(db, {
    contentId: content.id,
    versionId: version.id,
    eventType: 'ai_generated',
    actorType: 'ai',
    provider: 'pipeline',
    model: 'composite-storyboard',
    payload: { stage: 'storyboard.done', shots: shots.length, resumedFrom: resumedCount },
  })
  await jobService.complete(jobId, {
    stage: 'done',
    shots: shots.length,
    shotAssets: entriesSnapshot(),
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
  if (type === 'intent.directions') return executeDirectionsJob(jobId, payload)
  if (type === 'revision.plan') return executeRevisionPlanJob(jobId, payload)
  if (type === 'video.storyboard') return executeStoryboardJob(jobId, payload)
  if (type === 'video.render') return executeRenderJob(jobId, payload)
  throw new NonRetryableJobError(`未知 Job 类型：${type}`)
}
