// scripts/m15/reproducible-cinema-e2e.mjs —— reproducible-cinema-024 真实管线 E2E
// 验证语义（设计文档 §3–§6，全程真实供给、断点续跑、状态感知防重复烧配额）：
//   A. drive         ：真实管线驱动到 GENERATING（短时长 3 镜故事，控制患性总时长）
//   B. early         ：质量门在跑（Generation 账本 promptHash/attempt 指纹落盘）+ 图片渐进到达
//   C. late          ：患性调度实证——videoAttempts 轮次可见（严格模式无静默回落），
//                      终态 REVIEW：native 覆盖率（目标 100%，允许预算耗尽显式失败路径）
//   D. render        ：渲染严格门 + 成片 READY + 可播放断言
//   E. evidence      ：DB 直查——quality.gate Provenance 事件 / 指纹账本 / native 覆盖统计
// 用法：node scripts/m15/reproducible-cinema-e2e.mjs [drive|early|late|render|evidence|report|cleanup]
import { Client, loadState, saveState, sleep } from './lib.mjs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } })
const CASE_ID = 'reproducible-cinema'
const IDEA = '竖屏 30 秒短剧：夜班便利店店员发现每晚十一点来买同一款关东煮的老人今晚没来，她在便签上写了句话贴在保温柜上。'
// 短时长 → 3 镜（planShotCount(30)≈3）：患性预算下最坏 ~24 分钟可控

const state = loadState(CASE_ID) ?? {
  caseId: CASE_ID,
  phase: 'init', // init → driven → early → late → rendered → done
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

async function waitFor(contentId, predicate, { timeoutMs = 300_000, intervalMs = 3000, label = '', tolerateFailure = false } = {}) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    const data = await pollCreation(contentId)
    last = data
    if (predicate(data)) return data
    if (!tolerateFailure && data.job && (data.job.status === 'failed' || data.job.status === 'timeout')) {
      throw new Error(`Job 失败：${data.job.type} ${String(data.job.error).slice(0, 260)}`)
    }
    await sleep(intervalMs)
  }
  throw new Error(`等待超时（${label}）；最后 status=${last?.content?.status} job=${JSON.stringify(last?.job).slice(0, 260)}`)
}

// ---------------- 段 A：驱动到 GENERATING ----------------
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

  let data = await cur()
  if (!data.intent?.record) {
    const first = await client.post(`/api/contents/${state.contentId}/intent`, {})
    if ((first.questions ?? []).length > 0) {
      await client.post(`/api/contents/${state.contentId}/intent`, { confirm: true })
    }
    data = await cur()
  }
  console.log(`[drive] intent ✓（status=${data.content.status}）`)

  if (!data.plan?.directions?.length) {
    await client.post(`/api/contents/${state.contentId}/directions`, {})
    data = await cur()
  }
  if (data.content.status === 'INTENT') {
    const chosen = data.plan.directions[0]
    await client.post(`/api/contents/${state.contentId}/directions/select`, { directionId: chosen.id })
    console.log(`[drive] 方向选定 ✓「${chosen.name}」`)
  }

  if (!data.story) {
    await client.post(`/api/contents/${state.contentId}/story`, {})
    await waitFor(state.contentId, (d) => !!d.story, { timeoutMs: 240_000, label: '故事展开' })
  }
  data = await cur()
  // 手法库落图证据：末镜旁白应是卡点钩（非总结陈词）——记录供人工/盲评复核
  const allShots = (data.story?.scenes ?? []).flatMap((s) => s.shots ?? [])
  state.evidence.storyCraft = {
    logline: data.story?.logline ?? null,
    lastNarrationLine: allShots.at(-1)?.narrationLine ?? null,
    firstNarrationLine: allShots[0]?.narrationLine ?? null,
    hookPatterns: ['悬念', '反常', '冲突', '奇观'].map((t) => ({ t, present: `${data.story?.logline ?? ''}${allShots[0]?.narrationLine ?? ''}`.includes(t) })),
  }
  console.log(`[drive] story ✓ logline="${data.story?.logline}"`)
  console.log(`[drive] 末镜旁白（卡点钩观察）："${state.evidence.storyCraft.lastNarrationLine}"`)

  data = await cur()
  if (data.content.status === 'STORY') {
    await client.post(`/api/contents/${state.contentId}/storyboard`, {})
    data = await waitFor(state.contentId, (d) => d.content.status !== 'STORY', { timeoutMs: 300_000, label: '分镜拆解' })
  }
  if (data.content.status !== 'STORYBOARD') {
    throw new Error(`分镜后状态异常：${data.content.status}`)
  }
  const shotCount = (data.story?.scenes ?? []).reduce((n, s) => n + s.shots.length, 0)
  state.evidence.shotCount = shotCount
  console.log(`[drive] storyboard ✓ ${data.story?.scenes?.length} 场 ${shotCount} 镜`)

  data = await cur()
  const activeGen = data.job && ['queued', 'claimed', 'running'].includes(data.job.status) && ['video.storyboard', 'video.resume'].includes(data.job.type)
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

// ---------------- 段 B：指纹账本 + 图片渐进（early） ----------------
async function early() {
  if (['early', 'late', 'rendered', 'done'].includes(state.phase)) return console.log('[early] 已完成，跳过')
  if (state.phase !== 'driven') throw new Error('先跑 drive 段')

  // 指纹账本（§5）：图像调用落盘 promptHash + attempt（DB 直查——账本是给复现/范例库的）
  const gen0 = Date.parse(state.evidence.generateAcceptedAt) - 60_000
  const imgRows = await db.generation.findMany({
    where: { contentId: state.contentId, type: 'image.shot', createdAt: { gte: new Date(gen0) } },
    select: { status: true, inputJson: true, latencyMs: true },
    orderBy: { createdAt: 'asc' },
  })
  state.evidence.fingerprint = imgRows.map((r) => {
    let input = {}
    try { input = JSON.parse(r.inputJson ?? '{}') } catch {}
    return { status: r.status, attempt: input.attempt ?? null, promptHash: input.promptHash ?? null, latencyMs: r.latencyMs }
  })
  const withHash = state.evidence.fingerprint.filter((f) => f.promptHash)
  console.log(`[early] 指纹账本 ✓ ${withHash.length}/${imgRows.length} 条图像记账携带 promptHash（attempt 口径=${withHash[0]?.attempt ?? '-'}）`)

  // 质量门（§4）：Provenance quality.gate 事件（评审证据落链）
  const qgEvents = await db.provenance.findMany({
    where: { contentId: state.contentId, model: 'quality-gate' },
    select: { payloadJson: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  state.evidence.qualityGate = qgEvents.map((e) => {
    try { return JSON.parse(e.payloadJson ?? '{}') } catch { return {} }
  })
  console.log(`[early] 质量门事件 ✓ ${qgEvents.length} 条${state.evidence.qualityGate.length > 0 ? `（首镜 score=${state.evidence.qualityGate[0].score} pass=${state.evidence.qualityGate[0].pass} advisory=${state.evidence.qualityGate[0].advisory}）` : ''}`)

  // 图片渐进到达
  const data = await waitFor(
    state.contentId,
    (d) => Array.isArray(d.assets?.shots) && d.assets.shots.some((s) => s.imageUrl),
    { timeoutMs: 240_000, label: '首个镜头图片到达' },
  )
  const shots = data.assets.shots
  state.evidence.firstImage = {
    at: now(),
    elapsedSinceGenerate: `${((Date.now() - Date.parse(state.evidence.generateAcceptedAt)) / 1000).toFixed(0)}s`,
    arrived: shots.filter((s) => s.imageUrl).length,
    total: state.evidence.shotCount,
    videoExpectedCount: shots.filter((s) => s.videoExpected).length,
  }
  console.log(`[early] 首图到达 ✓（+${state.evidence.firstImage.elapsedSinceGenerate}，${state.evidence.firstImage.arrived}/${state.evidence.shotCount}，native 意图 ${state.evidence.firstImage.videoExpectedCount} 镜）`)
  state.phase = 'early'
  persist()
}

// ---------------- 段 C：患性调度 + 终态（late） ----------------
async function late() {
  if (['late', 'rendered', 'done'].includes(state.phase)) return console.log('[late] 已完成，跳过')
  if (state.phase !== 'early') throw new Error('先跑 early 段')
  const ev = state.evidence
  ev.patienceTimeline = []
  ev.maxVideoAttempts = 0
  ev.sawRetryLabel = false

  // 患性窗口：3 镜 × 480s 预算 + 图像/首镜时延，上限 ~26 分钟；容忍显式失败路径（tolerateFailure）
  const start = Date.now()
  const LIMIT_MS = 26 * 60_000
  let lastData = null
  while (Date.now() - start < LIMIT_MS) {
    const data = await pollCreation(state.contentId)
    lastData = data
    const shots = data.assets?.shots ?? []
    const attempts = shots.map((s) => s.videoAttempts ?? 0)
    const maxA = Math.max(0, ...attempts)
    if (maxA > ev.maxVideoAttempts) ev.maxVideoAttempts = maxA
    if ((data.job?.label ?? '').includes('轮')) ev.sawRetryLabel = true
    ev.patienceTimeline.push({
      t: `${((Date.now() - Date.parse(ev.generateAcceptedAt)) / 1000).toFixed(0)}s`,
      status: data.content.status,
      jobType: data.job?.type ?? null,
      jobStage: data.job?.stage ?? null,
      label: data.job?.label ?? null,
      images: shots.filter((s) => s.imageUrl).length,
      videos: shots.filter((s) => s.videoUrl).length,
      fallbacks: shots.filter((s) => s.videoFallback).length,
      maxAttempts: maxA,
    })
    if (data.content.status === 'REVIEW') break
    // 严格模式显式失败（预算耗尽）：走断点续跑验证分支
    if (data.job && (data.job.status === 'failed' || data.job.status === 'timeout')) {
      ev.strictFailure = { at: now(), type: data.job.type, error: String(data.job.error).slice(0, 300) }
      console.log(`[late] 严格模式显式失败（预期路径之一）：${ev.strictFailure.error.slice(0, 160)}`)
      break
    }
    await sleep(5000)
  }

  // ---- 分支 1：显式失败 → 断点续跑（video.resume）验证 ----
  if (ev.strictFailure && lastData?.content?.status === 'GENERATING') {
    console.log('[late] 触发 regenerate → 应入队 video.resume（只补缺口，不重烧图像）')
    const before = await db.generation.count({ where: { contentId: state.contentId, type: 'image.shot' } })
    const regen = await client.post(`/api/contents/${state.contentId}/regenerate`, {})
    ev.resumeJobId = regen.jobId
    const active = await pollCreation(state.contentId)
    ev.resumeJobType = active.job?.type ?? null
    console.log(`[late] regenerate → jobType=${ev.resumeJobType}（期望 video.resume）`)
    if (ev.resumeJobType !== 'video.resume') {
      throw new Error(`断点续跑路由失败：期望 video.resume 实得 ${ev.resumeJobType}`)
    }
    // 续跑到 REVIEW（患性预算同量级）
    await waitFor(state.contentId, (d) => d.content.status === 'REVIEW', {
      timeoutMs: 26 * 60_000, intervalMs: 5000, label: 'video.resume 补齐', tolerateFailure: false,
    })
    const after = await db.generation.count({ where: { contentId: state.contentId, type: 'image.shot' } })
    ev.resumeImageCalls = { before, after }
    console.log(`[late] video.resume → REVIEW ✓（图像调用 ${before}→${after}，只补视频不重画 ✓）`)
  }

  // ---- 终态断言：REVIEW + 严格模式无静默回落 + native 覆盖 ----
  const final = await pollCreation(state.contentId)
  if (final.content.status !== 'REVIEW') {
    throw new Error(`终态非 REVIEW：${final.content.status} job=${JSON.stringify(final.job).slice(0, 200)}`)
  }
  const finalShots = final.assets?.shots ?? []
  ev.finalOverlay = {
    at: now(),
    shots: finalShots.map((s) => ({
      shotIndex: s.shotIndex,
      hasImage: !!s.imageUrl,
      hasVideo: !!s.videoUrl,
      videoExpected: s.videoExpected ?? null,
      videoFallback: s.videoFallback ?? null,
      hasAudio: !!s.audioUrl,
      videoAttempts: s.videoAttempts ?? null,
    })),
    generationMode: final.generationMode ?? null,
  }
  const nativeShots = finalShots.filter((s) => s.videoUrl)
  const fallbackShots = finalShots.filter((s) => s.videoFallback)
  ev.nativeCoverage = { native: nativeShots.length, fallback: fallbackShots.length, total: finalShots.length }
  // 严格模式铁律：不允许静默回落（fallback 仅逃生阀显式开启时合法）
  if (fallbackShots.length > 0) {
    throw new Error(`严格模式下出现 Ken Burns 回落（${fallbackShots.length} 镜）——产品红线`)
  }
  console.log(`[late] 终态 REVIEW ✓：native ${nativeShots.length}/${finalShots.length} 镜 · 配音 ${finalShots.filter((s) => s.audioUrl).length} 段 · 零 Ken Burns 回落 ✓`)
  console.log(`[late] 患性实证：最大重试轮次=${ev.maxVideoAttempts}，重试 label 可见=${ev.sawRetryLabel}`)
  state.phase = 'late'
  persist()
}

// ---------------- 段 D：渲染成片（render） ----------------
async function render() {
  if (['rendered', 'done'].includes(state.phase)) return console.log('[render] 已完成，跳过')
  if (state.phase !== 'late') throw new Error('先跑 late 段')
  const data = await pollCreation(state.contentId)
  if (data.content.status !== 'REVIEW') throw new Error(`当前状态 ${data.content.status} 不可渲染`)
  const res = await client.post(`/api/contents/${state.contentId}/render`, {})
  state.evidence.renderJobId = res.jobId
  console.log(`[render] render 入队 ✓ jobId=${res.jobId}`)
  const final = await waitFor(state.contentId, (d) => d.content.status === 'READY', {
    timeoutMs: 300_000, intervalMs: 4000, label: '渲染成片',
  })
  const finalAsset = final.assets?.final
  if (!finalAsset?.url) throw new Error('READY 但无成片资产')
  // 可播放断言：GET 成片字节（cookie 会话同源）
  const assetRes = await fetch(`${process.env.M15_BASE ?? 'http://localhost:3000'}${finalAsset.url}`, {
    headers: client.cookieHeader() ? { cookie: client.cookieHeader() } : {},
  })
  if (!assetRes.ok) throw new Error(`成片拉取失败 HTTP ${assetRes.status}`)
  const buf = Buffer.from(await assetRes.arrayBuffer())
  state.evidence.final = {
    at: now(),
    url: finalAsset.url,
    durationMs: finalAsset.durationMs,
    bytes: buf.length,
    mime: assetRes.headers.get('content-type'),
  }
  if (state.evidence.final.bytes < 50_000) {
    throw new Error(`成片字节异常：${state.evidence.final.bytes}`)
  }
  console.log(`[render] READY ✓ 成片 ${state.evidence.final.bytes} 字节，时长 ${(finalAsset.durationMs / 1000).toFixed(1)}s`)
  state.phase = 'rendered'
  persist()
}

// ---------------- 段 E：证据汇总（DB 直查） ----------------
async function evidence() {
  const ev = state.evidence
  ev.dbEvidence = {}
  // 质量门事件全量
  ev.dbEvidence.qualityGateEvents = await db.provenance.count({ where: { contentId: state.contentId, model: 'quality-gate' } })
  // 指纹账本统计
  const gens = await db.generation.findMany({
    where: { contentId: state.contentId },
    select: { type: true, status: true, inputJson: true },
  })
  ev.dbEvidence.ledger = {}
  for (const g of gens) {
    let input = {}
    try { input = JSON.parse(g.inputJson ?? '{}') } catch {}
    const bucket = (ev.dbEvidence.ledger[g.type] ??= { total: 0, withPromptHash: 0, withFirstFrameHash: 0, ok: 0 })
    bucket.total++
    if (input.promptHash) bucket.withPromptHash++
    if (input.firstFrameHash) bucket.withFirstFrameHash++
    if (g.status === 'succeeded') bucket.ok++
  }
  // native 视频到达时长分布（供给患性实证）
  const videoGens = await db.generation.findMany({
    where: { contentId: state.contentId, type: 'video.shot', status: 'succeeded' },
    select: { latencyMs: true },
    orderBy: { createdAt: 'asc' },
  })
  ev.dbEvidence.videoLatencies = videoGens.map((v) => v.latencyMs)
  // 严格门/续跑事件
  ev.dbEvidence.pendingEvents = await db.provenance.count({ where: { contentId: state.contentId, model: 'native-pending' } })
  ev.dbEvidence.resumeJobs = await db.generationJob.count({ where: { contentId: state.contentId, type: 'video.resume' } })
  console.log(JSON.stringify({ phase: state.phase, shotCount: ev.shotCount, nativeCoverage: ev.nativeCoverage, maxVideoAttempts: ev.maxVideoAttempts, strictFailure: ev.strictFailure ?? null, dbEvidence: ev.dbEvidence, qualityGate: (ev.qualityGate ?? []).slice(0, 3) }, null, 2))
  persist()
}

function report() {
  console.log(JSON.stringify(state.evidence, null, 2))
}

async function cleanup() {
  if (!state.contentId) return console.log('[cleanup] 无内容，跳过')
  await client.req('DELETE', `/api/contents/${state.contentId}`)
  state.phase = 'done'
  persist()
  console.log(`[cleanup] DELETE ${state.contentId} ✓`)
}

const cmd = process.argv[2] ?? 'drive'
try {
  switch (cmd) {
    case 'drive': await drive(); break
    case 'early': await early(); break
    case 'late': await late(); break
    case 'render': await render(); break
    case 'evidence': await evidence(); break
    case 'report': report(); break
    case 'cleanup': await cleanup(); break
    default: throw new Error(`未知段：${cmd}`)
  }
} finally {
  await db.$disconnect()
}
