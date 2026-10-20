// scripts/m15/progress-visibility-e2e.mjs —— 生成阶段「过程可见」E2E（2026-10-09 用户反馈
// 「正在生成 AI 视频镜头（4/6）…实则图片不能及时观看视频效果，没有过程」）
//
// 验证语义（三层证据之前两层：真实流量 API 断言；浏览器层由 ui-verify-progress.sh 承担）：
//   A. drive        ：真实管线驱动到 GENERATING（story/storyboard 为异步 Job，轮询接续）
//   B. early-evidence：图片秒级到达——首个 assets.shots 条目带 imageUrl + videoExpected 标记
//                      （此段退出后生成仍在服务端继续，中间可做浏览器中态验证）
//   C. late-evidence ：AI 视频后到补齐 videoUrl（或诚实回落 videoFallback）；narration 阶段
//                      audioUrl 渐进出现；终态 REVIEW 时完成路径同样透出 videoUrl/标记
//
// 断点续跑：state 落盘 scripts/m15/state/progress-visibility.json，重跑跳过已完成段。
// 用法：node scripts/m15/progress-visibility-e2e.mjs [drive|early-evidence|late-evidence|report|cleanup]
import { Client, loadState, saveState, sleep } from './lib.mjs'

const CASE_ID = 'progress-visibility'
const IDEA = '竖屏拍一个深夜洗衣店的故事：值夜班的女孩把一件无人认领的旧外套晾在暖气旁，天亮前她轻轻叠好放进失物招领箱。'

const state = loadState(CASE_ID) ?? {
  caseId: CASE_ID,
  phase: 'init', // init → driven → earlyEvidence → lateEvidence → done
  contentId: null,
  cookies: null,
  evidence: {},
}
const client = new Client(CASE_ID)
client.restore(state.cookies)
const persist = () => {
  state.cookies = client.dump()
  saveState(CASE_ID, state)
}

const now = () => new Date().toISOString()

async function pollCreation(contentId) {
  return client.get(`/api/contents/${contentId}/creation`)
}

/** 等待条件成立（对 creation 聚合轮询）；超时抛错 */
async function waitFor(contentId, predicate, { timeoutMs = 300_000, intervalMs = 3000, label = '' } = {}) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    const data = await pollCreation(contentId)
    last = data
    if (predicate(data)) return data
    if (data.job && (data.job.status === 'failed' || data.job.status === 'timeout')) {
      throw new Error(`Job 失败：${data.job.type} ${String(data.job.error).slice(0, 200)}`)
    }
    await sleep(intervalMs)
  }
  throw new Error(`等待超时（${label}）；最后 status=${last?.content?.status} job=${JSON.stringify(last?.job).slice(0, 240)}`)
}

// ---------------- 段 A：驱动到 GENERATING（状态感知断点：每步先查 DB 权威状态，已完成跳过） ----------------
async function drive() {
  if (state.phase !== 'init') return console.log('[drive] 已完成，跳过')
  if (!state.contentId) {
    const res = await client.post('/api/imagine/start', { text: IDEA })
    state.contentId = res.contentId
    state.evidence.ideaAckAt = now()
    persist()
  }
  console.log(`[drive] contentId=${state.contentId}`)
  const cur = async () => pollCreation(state.contentId)

  // intent：无 record 时才调用（幂等防重）
  let data = await cur()
  if (!data.intent?.record) {
    const first = await client.post(`/api/contents/${state.contentId}/intent`, {})
    if ((first.questions ?? []).length > 0) {
      await client.post(`/api/contents/${state.contentId}/intent`, { confirm: true })
    }
    data = await cur()
  }
  console.log(`[drive] intent ✓（status=${data.content.status}）`)

  // directions：已有方向则跳过（不重复烧 LLM 配额）
  if (!data.plan?.directions?.length) {
    const dirs = await client.post(`/api/contents/${state.contentId}/directions`, {})
    data = await cur()
    state.evidence.directionCount = (dirs.directions ?? []).length
  }
  // select：未选方向（status 还在 INTENT）才选
  if (data.content.status === 'INTENT') {
    const chosen = data.plan.directions[0]
    await client.post(`/api/contents/${state.contentId}/directions/select`, { directionId: chosen.id })
    console.log(`[drive] 方向选定 ✓「${chosen.name}」`)
  } else {
    console.log('[drive] 方向已选定（断点跳过）')
  }

  // story：故事在场则跳过（story.draft Job 幂等：路由 activeJob 复用）
  if (!data.story) {
    await client.post(`/api/contents/${state.contentId}/story`, {})
    await waitFor(state.contentId, (d) => !!d.story, { timeoutMs: 240_000, label: '故事展开' })
  }
  console.log('[drive] story ✓（异步 Job 轮询接续）')

  // storyboard：状态已到 STORYBOARD/之后则跳过；否则入队并轮询
  data = await cur()
  if (data.content.status === 'STORY') {
    await client.post(`/api/contents/${state.contentId}/storyboard`, {})
    data = await waitFor(state.contentId, (d) => d.content.status !== 'STORY', { timeoutMs: 300_000, label: '分镜拆解' })
  }
  if (data.content.status !== 'STORYBOARD') {
    throw new Error(`分镜后状态异常：${data.content.status}（可能失败，查看 lastError）`)
  }
  const shotCount = (data.story?.scenes ?? []).reduce((n, s) => n + s.shots.length, 0)
  state.evidence.shotCount = shotCount
  console.log(`[drive] storyboard ✓ ${data.story?.scenes?.length} 场 ${shotCount} 镜`)

  // generate：无活跃 storyboard 生成 Job 且状态仍 STORYBOARD 才入队
  data = await cur()
  const activeGen = data.job && ['queued', 'claimed', 'running'].includes(data.job.status) && data.job.type === 'video.storyboard'
  if (!activeGen && data.content.status === 'STORYBOARD') {
    const gen = await client.post(`/api/contents/${state.contentId}/generate`, {})
    state.evidence.generateJobId = gen.jobId
    console.log(`[drive] generate 入队 ✓ jobId=${gen.jobId}`)
  } else {
    console.log(`[drive] 生成已在进行（断点跳过）job=${data.job?.type}/${data.job?.status}`)
  }
  state.evidence.generateAcceptedAt ??= now()
  state.phase = 'driven'
  persist()
}

// ---------------- 段 B：图片渐进到达（early evidence） ----------------
async function earlyEvidence() {
  if (state.phase === 'earlyEvidence' || state.phase === 'lateEvidence' || state.phase === 'done') {
    return console.log('[early-evidence] 已完成，跳过')
  }
  if (state.phase !== 'driven') throw new Error('先跑 drive 段')
  const data = await waitFor(
    state.contentId,
    (d) => Array.isArray(d.assets?.shots) && d.assets.shots.some((s) => s.imageUrl),
    { timeoutMs: 180_000, label: '首个镜头图片到达' },
  )
  const shots = data.assets.shots
  state.evidence.firstImage = {
    at: now(),
    elapsedSinceGenerate: `${((Date.now() - Date.parse(state.evidence.generateAcceptedAt)) / 1000).toFixed(0)}s`,
    arrivedCount: shots.filter((s) => s.imageUrl).length,
    total: state.evidence.shotCount,
    entries: shots.map((s) => ({
      shotIndex: s.shotIndex,
      hasImage: !!s.imageUrl,
      videoExpected: s.videoExpected ?? null,
      videoFallback: s.videoFallback ?? null,
      hasVideo: !!s.videoUrl,
    })),
    jobLabel: data.job?.label ?? null,
    jobStage: data.job?.stage ?? null,
  }
  // 关键断言：①图片已可在活跃覆盖里看到 ②native 镜带 videoExpected（前端能渲染「视频生成中」）
  const nativeEntry = shots.find((s) => s.videoExpected === true)
  if (!nativeEntry) throw new Error('活跃覆盖未携带 videoExpected 标记（前端无法渲染单镜状态）')
  console.log(`[early-evidence] 首图到达 ✓（${state.evidence.firstImage.elapsedSinceGenerate} 内 ${state.evidence.firstImage.arrivedCount}/${state.evidence.shotCount}）`)
  console.log(`[early-evidence] videoExpected 标记 ✓（shot${nativeEntry.shotIndex}）；jobLabel="${state.evidence.firstImage.jobLabel}"`)
  state.phase = 'earlyEvidence'
  persist()
}

// ---------------- 段 C：视频后到 + 音频渐进 + 终态完整透出（late evidence） ----------------
async function lateEvidence() {
  if (state.phase === 'lateEvidence' || state.phase === 'done') return console.log('[late-evidence] 已完成，跳过')
  if (state.phase !== 'earlyEvidence') throw new Error('先跑 early-evidence 段')
  const ev = state.evidence
  ev.videoTimeline = []
  ev.audioFirstSeen = null

  // 轮询直到：出现首个 videoUrl（native 成功）或 videoFallback（诚实回落）或 narration 音频出现
  const start = Date.now()
  let sawNarrationAudio = false
  let sawVideoOrFallback = false
  while (Date.now() - start < 420_000) {
    const data = await pollCreation(state.contentId)
    const shots = data.assets?.shots ?? []
    const withVideo = shots.filter((s) => s.videoUrl)
    const withFallback = shots.filter((s) => s.videoFallback)
    const withAudio = shots.filter((s) => s.audioUrl)
    if (withVideo.length > 0 && !ev.firstVideo) {
      ev.firstVideo = {
        at: now(),
        elapsedSinceGenerate: `${((Date.now() - Date.parse(ev.generateAcceptedAt)) / 1000).toFixed(0)}s`,
        shotIndexes: withVideo.map((s) => s.shotIndex),
        urlShape: withVideo[0].videoUrl.startsWith('/api/assets/') ? 'asset-url' : 'BAD',
      }
      sawVideoOrFallback = true
      console.log(`[late-evidence] AI 视频到达 ✓ shots=${ev.firstVideo.shotIndexes}（+${ev.firstVideo.elapsedSinceGenerate}）`)
    }
    if (withFallback.length > 0 && !ev.firstFallback) {
      ev.firstFallback = { at: now(), shotIndexes: withFallback.map((s) => s.shotIndex) }
      sawVideoOrFallback = true
      console.log(`[late-evidence] 回落标记到达 ✓ shots=${ev.firstFallback.shotIndexes}（诚实可见）`)
    }
    if (withAudio.length > 0 && !ev.audioFirstSeen) {
      ev.audioFirstSeen = {
        at: now(),
        jobStage: data.job?.stage ?? null,
        count: withAudio.length,
      }
      sawNarrationAudio = true
      console.log(`[late-evidence] 音频渐进到达 ✓ stage=${ev.audioFirstSeen.jobStage} count=${withAudio.length}`)
    }
    ev.videoTimeline.push({
      t: `${((Date.now() - Date.parse(ev.generateAcceptedAt)) / 1000).toFixed(0)}s`,
      status: data.content.status,
      jobStage: data.job?.stage ?? null,
      images: shots.filter((s) => s.imageUrl).length,
      videos: withVideo.length,
      fallbacks: withFallback.length,
      audios: withAudio.length,
    })
    if (data.content.status === 'REVIEW') {
      ev.reachedReviewAt = now()
      console.log('[late-evidence] REVIEW ✓')
      break
    }
    if (data.job && (data.job.status === 'failed' || data.job.status === 'timeout')) {
      throw new Error(`生成 Job 失败：${String(data.job.error).slice(0, 200)}`)
    }
    await sleep(3000)
  }

  // 终态断言：REVIEW 时完成路径透出 videoUrl/标记
  const final = await pollCreation(state.contentId)
  if (final.content.status !== 'REVIEW') throw new Error(`终态非 REVIEW：${final.content.status}`)
  const finalShots = final.assets?.shots ?? []
  ev.finalOverlay = {
    at: now(),
    status: final.content.status,
    shots: finalShots.map((s) => ({
      shotIndex: s.shotIndex,
      hasImage: !!s.imageUrl,
      hasVideo: !!s.videoUrl,
      videoExpected: s.videoExpected ?? null,
      videoFallback: s.videoFallback ?? null,
      hasAudio: !!s.audioUrl,
    })),
    generationMode: final.generationMode ?? null,
    activeJobType: final.job?.type ?? null,
  }
  // 完成路径必须不再丢视频（修复点：此前 videoAssetId 从未透出）
  const nativeOk = finalShots.filter((s) => s.videoUrl)
  if (final.generationMode?.nativeShots > 0 && nativeOk.length === 0) {
    throw new Error('native 镜存在但完成路径无 videoUrl（videoAssetId 透出缺失）')
  }
  console.log(`[late-evidence] 完成路径透出 ✓：${nativeOk.length} 段 AI 视频 / ${finalShots.filter((s) => s.videoFallback).length} 镜回落 / ${finalShots.filter((s) => s.audioUrl).length} 段配音`)
  console.log(`[late-evidence] 视频可见性=${sawVideoOrFallback}；音频渐进=${sawNarrationAudio}；模式=${JSON.stringify(final.generationMode)}`)
  state.phase = 'lateEvidence'
  persist()
}

// ---------------- 段 D：报告 ----------------
function report() {
  console.log(JSON.stringify(state.evidence, null, 2))
}

// ---------------- 段 E：清场 ----------------
async function cleanup() {
  if (!state.contentId) return console.log('[cleanup] 无内容，跳过')
  await client.req('DELETE', `/api/contents/${state.contentId}`)
  state.phase = 'done'
  persist()
  console.log(`[cleanup] DELETE ${state.contentId} ✓`)
}

const cmd = process.argv[2] ?? 'drive'
switch (cmd) {
  case 'drive': await drive(); break
  case 'early-evidence': await earlyEvidence(); break
  case 'late-evidence': await lateEvidence(); break
  case 'report': report(); break
  case 'cleanup': await cleanup(); break
  default: throw new Error(`未知段：${cmd}`)
}
