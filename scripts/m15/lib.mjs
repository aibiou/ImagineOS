// scripts/m15/lib.mjs —— M1.5 Expression Quality Gate 驱动库
// 走真实 HTTP API（与 UI 用户完全同路径，无一处 mock）：
//   imagine/start → intent → directions → select → story → storyboard → generate(轮询) → render(轮询) → publish
// 断点续跑：每案例状态落盘 scripts/m15/state/<caseId>.json，重跑时跳过已完成阶段。
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.M15_BASE ?? 'http://localhost:3000'
const HERE = dirname(fileURLToPath(import.meta.url))
export const STATE_DIR = join(HERE, 'state')
mkdirSync(STATE_DIR, { recursive: true })

const HTTP_TIMEOUT_MS = 300_000 // LLM 同步路由（intent/directions/story/storyboard/revision）可能 30–120s

// ---------------- HTTP 客户端（cookie 会话 = 真实匿名用户） ----------------

export class Client {
  constructor(label) {
    this.label = label
    this.cookies = new Map()
  }

  /** 导出会话（跨进程断点续跑：作者身份随 state 落盘） */
  dump() {
    return Object.fromEntries(this.cookies)
  }

  /** 恢复会话（state.cookies → cookie jar） */
  restore(saved) {
    if (saved && typeof saved === 'object') {
      for (const [k, v] of Object.entries(saved)) this.cookies.set(k, v)
    }
  }

  cookieHeader() {
    if (this.cookies.size === 0) return undefined
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  absorbCookies(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';')
      const eq = pair.indexOf('=')
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }

  async req(method, path, body) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(this.cookieHeader() ? { cookie: this.cookieHeader() } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      this.absorbCookies(res)
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* 非 JSON */ }
      if (!res.ok) {
        const msg = json?.message ?? text.slice(0, 200)
        const err = new Error(`HTTP ${res.status} ${method} ${path}: ${msg}`)
        err.status = res.status
        err.body = json
        throw err
      }
      return json
    } finally {
      clearTimeout(timer)
    }
  }

  post(path, body = {}) { return this.req('POST', path, body) }
  get(path) { return this.req('GET', path, undefined) }
}

// ---------------- 状态落盘 / 断点续跑 ----------------

export function loadState(caseId) {
  const file = join(STATE_DIR, `${caseId}.json`)
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

export function saveState(caseId, state) {
  writeFileSync(join(STATE_DIR, `${caseId}.json`), JSON.stringify(state, null, 2))
}

export function blankState(caseId, meta) {
  return {
    caseId,
    phase: 'init', // init→started→intent→directions→selected→story→storyboard→generating→review→rendering→ready→published
    contentId: null,
    meta,
    timeline: {}, // 各阶段完成时间戳（ISO）
    elapsed: {},  // 各阶段耗时（ms）
    record: {},   // 采集数据（intent/directions/story/storyboard/assets）
  }
}

function stamp(state, phase, sinceKey) {
  const now = Date.now()
  state.timeline[phase] = new Date(now).toISOString()
  if (sinceKey && state._t?.[sinceKey]) state.elapsed[phase] = now - state._t[sinceKey]
  state._t = state._t ?? {}
  state._t[phase] = now
  state.phase = phase
}

// ---------------- 轮询 ----------------

/** 等待 content.status 达到 target；job 失败提前抛错（但目标已达优先——
 *  creation API 的 job 字段在无活跃 Job 时会返回历史失败 Job（失败横幅数据源），
 *  跨 Job 打捞恢复后内容可能已达目标，历史失败不是当下的致命信号） */
export async function waitForStatus(client, contentId, target, { timeoutMs = 600_000, intervalMs = 3000, onTick } = {}) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    const data = await client.get(`/api/contents/${contentId}/creation`)
    last = data
    if (onTick) onTick(data)
    if (data.content.status === target) return data
    if (data.job && (data.job.status === 'failed' || data.job.status === 'timeout')) {
      throw new Error(`Job 失败：${data.job.type} ${JSON.stringify(data.job).slice(0, 400)}`)
    }
    await sleep(intervalMs)
  }
  throw new Error(`等待 ${target} 超时（>${timeoutMs}ms）；最后状态：${last?.content?.status} job=${JSON.stringify(last?.job).slice(0, 300)}`)
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// ---------------- 结构工具 ----------------

export function flattenShots(structure) {
  return (structure?.story?.scenes ?? []).flatMap((s) => s.shots ?? [])
}

export function summarizeStructure(structure) {
  const shots = flattenShots(structure)
  return {
    logline: structure?.story?.logline ?? null,
    style: structure?.style ?? null,
    scenes: structure?.story?.scenes?.length ?? 0,
    shotCount: shots.length,
    shots: shots.map((sh, i) => ({
      i,
      durationMs: sh.durationMs ?? null,
      cameraMotion: sh.cameraMotion ?? null,
      emotion: sh.emotion ?? null,
      image: (sh.imagePrompt ?? sh.visualDescription ?? '').slice(0, 90),
      narration: (sh.narrationLine ?? '').slice(0, 60),
    })),
  }
}

const SHOT_DIFF_FIELDS = ['imagePrompt', 'visualDescription', 'narrationLine', 'durationMs', 'cameraMotion', 'emotion']

/** 结构 diff：定位修改发生在哪些镜头、哪些字段（修订局部性验证） */
export function diffStructures(a, b) {
  const before = flattenShots(a)
  const after = flattenShots(b)
  const n = Math.max(before.length, after.length)
  const changedShots = []
  let changedCount = 0
  for (let i = 0; i < n; i++) {
    const s1 = before[i] ?? {}
    const s2 = after[i] ?? {}
    const fields = {}
    for (const f of SHOT_DIFF_FIELDS) {
      if ((s1[f] ?? null) !== (s2[f] ?? null)) fields[f] = { before: trunc(s1[f]), after: trunc(s2[f]) }
    }
    if (Object.keys(fields).length > 0) { changedShots.push({ shotIndex: i, fields }); changedCount++ }
  }
  return {
    shotCount: { before: before.length, after: after.length },
    styleChanged: (a?.style ?? null) !== (b?.style ?? null),
    loglineChanged: (a?.story?.logline ?? null) !== (b?.story?.logline ?? null),
    narrationStyleChanged: (a?.story?.narrationStyle ?? null) !== (b?.story?.narrationStyle ?? null),
    changedShotCount: changedCount,
    unchangedShotCount: Math.min(before.length, after.length) - changedCount,
    changedShots,
  }
}

function trunc(v) {
  if (v === null || v === undefined) return v
  const s = String(v)
  return s.length > 110 ? s.slice(0, 110) + '…' : s
}

// ---------------- 创作全链驱动 ----------------

function pickDirection(directions, preferKeywords) {
  if (!preferKeywords || directions.length === 0) return directions[0]
  for (const kw of preferKeywords) {
    const hit = directions.find((d) => `${d.name} ${d.oneLiner ?? ''} ${d.emotion ?? ''}`.includes(kw))
    if (hit) return hit
  }
  return directions[0]
}

const STATUS_RANK = ['IDEA', 'INTENT', 'PLANNING', 'STORY', 'STORYBOARD', 'GENERATING', 'REVIEW', 'RENDERING', 'READY', 'PUBLISHED']
const rankOf = (s) => STATUS_RANK.indexOf(s)

async function contentStatus(client, contentId) {
  const data = await client.get(`/api/contents/${contentId}/creation`)
  return data.content.status
}

/** 方向就绪等待（025 战线二：POST /directions 入队即返，方向由轮询接续——
 *  与 story/storyboard 同范式：服务端 Job 独立推进，客户端只轮询） */
export async function waitForDirections(client, contentId, { timeoutMs = 180_000, intervalMs = 2500 } = {}) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    last = await client.get(`/api/contents/${contentId}/creation`)
    const directions = last?.plan?.directions ?? []
    if (Array.isArray(directions) && directions.length > 0) return last
    const job = last?.job
    if (job && (job.status === 'failed' || job.status === 'timeout') && job.type === 'intent.directions') {
      throw new Error(`方向构思失败：${job.error ?? '未知原因'}`)
    }
    await sleep(intervalMs)
  }
  throw new Error(`方向构思超时（${Math.round(timeoutMs / 1000)}s）`)
}

/**
 * 单步执行（带断点续跑容错）：API 422 且作品状态已超过该步前提状态 → 视为已完成，跳过。
 * 场景：进程中断时某步已落库但 state 未能写盘。
 */
async function step(state, client, caseId, phase, nextPhase, prereqStatus, fn) {
  if (state.phase !== phase) return
  const persist = () => saveState(caseId, publicState(state))
  try {
    await fn()
  } catch (e) {
    if (e.status === 422) {
      const st = await contentStatus(client, state.contentId)
      if (rankOf(st) > rankOf(prereqStatus)) {
        console.log(`  [${caseId}] ${phase} 已完成（状态 ${st}），断点续跑跳过`)
      } else {
        throw e
      }
    } else {
      throw e
    }
  }
  stamp(state, nextPhase, phase)
  persist()
}

/**
 * 驱动一个创作案例至发布。断点续跑：state.phase 已达的阶段直接跳过；
 * 状态超前时 422 容错自动跳过。
 */
export async function driveCase(client, caseId, { text, description, preferKeywords, answers, stopBeforePublish }) {
  const state = loadState(caseId) ?? blankState(caseId, { text })
  const persist = () => {
    state.cookies = client.dump() // 会话随 state 落盘：断点续跑保持作者身份
    saveState(caseId, publicState(state))
  }

  // 断点续跑：恢复会话（作者身份）+ 重置当前阶段起点（中断等待不计入耗时）
  client.restore(state.cookies)
  if (state._t && state.phase) state._t[state.phase] = Date.now()

  // 1) start
  if (state.phase === 'init' || state.phase === 'started') {
    if (!state.contentId) {
      const res = await client.post('/api/imagine/start', { text })
      state.contentId = res.contentId
      state.title = res.title
    }
    state._t = state._t ?? {}
    stamp(state, 'started', null)
    persist()
  }

  // 2) intent（可能先返回访谈问题 → 记录后 confirm 跳过，模拟"交给我来定"）
  await step(state, client, caseId, 'started', 'intent', 'IDEA', async () => {
    const first = await client.post(`/api/contents/${state.contentId}/intent`, answers ? { answers } : {})
    state.record.intentQuestions = first.questions ?? []
    state.record.intentRecord = first.record ?? null
    state.record.intentDegraded = first.degraded ?? false
    if ((first.questions ?? []).length > 0) {
      const second = await client.post(`/api/contents/${state.contentId}/intent`, { confirm: true })
      state.record.intentRecord = second.record ?? state.record.intentRecord
    }
  })

  // 3) directions（025 战线二：入队即返 → 轮询方向出现——不再同步等 LLM）
  await step(state, client, caseId, 'intent', 'directions', 'INTENT', async () => {
    const res = await client.post(`/api/contents/${state.contentId}/directions`, {})
    state.record.directionsJobId = res.jobId ?? null
    state.record.directionsAlreadyRunning = res.alreadyRunning ?? null
    const data = await waitForDirections(client, state.contentId, { timeoutMs: 180_000 })
    state.record.directions = (data?.plan?.directions ?? []).map((d) => ({
      id: d.id, name: d.name, oneLiner: d.oneLiner, emotion: d.emotion, visualDirection: d.visualDirection,
    }))
  })

  // 4) select
  await step(state, client, caseId, 'directions', 'selected', 'INTENT', async () => {
    const chosen = pickDirection(state.record.directions ?? [], preferKeywords)
    const res = await client.post(`/api/contents/${state.contentId}/directions/select`, { directionId: chosen.id })
    state.record.concept = res.concept ?? null
    state.record.selectedDirectionId = chosen.id
  })

  // 5) story（规划层 Job 化：入队即返回 → 轮询等 STORY；与 ux-plan-async-022 服务端形态对齐）
  await step(state, client, caseId, 'selected', 'story', 'PLANNING', async () => {
    const res = await client.post(`/api/contents/${state.contentId}/story`, {})
    state.record.storyJobId = res.jobId ?? null
  })
  if (state.phase === 'story') {
    await waitForStatus(client, state.contentId, 'STORY', { timeoutMs: 420_000 })
    const data = await client.get(`/api/contents/${state.contentId}/creation`)
    state.record.storyLogline = data.story?.logline ?? null
    state.record.storyArc = data.story?.arc ?? null
    persist()
  }

  // 6) storyboard（同上：入队即返回 → 轮询等 STORYBOARD）
  await step(state, client, caseId, 'story', 'storyboard', 'STORY', async () => {
    const res = await client.post(`/api/contents/${state.contentId}/storyboard`, {})
    state.record.storyboardJobId = res.jobId ?? null
  })
  if (state.phase === 'storyboard') {
    const data = await waitForStatus(client, state.contentId, 'STORYBOARD', { timeoutMs: 600_000 })
    state.record.storyboard = data.story ? summarizeStructure({ story: data.story }) : null
    persist()
  }

  // 7) generate → REVIEW
  await step(state, client, caseId, 'storyboard', 'generating', 'STORYBOARD', async () => {
    const res = await client.post(`/api/contents/${state.contentId}/generate`, {})
    state.record.generateJobId = res.jobId
    state.record.generateVersion = { versionId: res.versionId, versionNumber: res.versionNumber, reused: res.reusedVersion }
  })

  if (state.phase === 'generating') {
    // 失败恢复入口（M1.5 缺陷修复②的脚本侧闭环）：
    // 僵死态判定 = GENERATING + (无 Job | Job 已 failed/timeout)。creation API 会把最近失败
    // Job 暴露在 job 字段（失败横幅 UI 数据源），所以「无活跃 Job」要看 status 而非字段存在性。
    // regenerate API 已接受 GENERATING 态（assertNoActiveJob 只挡活跃 Job）——同 Version 换新 Job
    // （服务端跨 Job 打捞：payload.resumeFromFailed=true，只补缺口不重烧）。
    const probe = await client.get(`/api/contents/${state.contentId}/creation`)
    const jobDead = !probe.job || probe.job.status === 'failed' || probe.job.status === 'timeout'
    const stalled = jobDead && probe.content?.status === 'GENERATING'
    if (stalled) {
      console.log(`  [${caseId}] 检测到僵死态（GENERATING 且 Job ${probe.job ? probe.job.status : '缺失'}），走 regenerate 重入`)
      const reg = await client.post(`/api/contents/${state.contentId}/regenerate`, {})
      state.record.generateJobId = reg.jobId
      state.record.recoveredFromFailedJob = { at: new Date().toISOString(), via: 'stalled-generating regenerate' }
      persist()
    }
    const data = await waitForStatus(client, state.contentId, 'REVIEW', { timeoutMs: 900_000 })
    state.record.shotAssets = (data.assets?.shots ?? []).map((s) => ({ imageUrl: s.imageUrl, audioUrl: s.audioUrl }))
    stamp(state, 'review', 'generating')
    persist()
  }

  // 8) render → READY
  await step(state, client, caseId, 'review', 'rendering', 'REVIEW', async () => {
    const res = await client.post(`/api/contents/${state.contentId}/render`, {})
    state.record.renderJobId = res.jobId
  })

  if (state.phase === 'rendering') {
    const data = await waitForStatus(client, state.contentId, 'READY', { timeoutMs: 420_000 })
    state.record.final = data.assets?.final ?? null
    state.record.poster = data.assets?.poster ?? null
    stamp(state, 'ready', 'rendering')
    persist()
  }

  // 9) publish（stopBeforePublish：停在 READY——修订链场景必需，
  //    因为 applyRevision 只接受 REVIEW/READY/STORYBOARD，PUBLISHED 需先下线而 Alpha 无下线 API）
  if (stopBeforePublish && state.phase === 'ready') {
    console.log(`  [${caseId}] stopBeforePublish：停在 READY（phase=ready，不发布）`)
    return publicState(state)
  }
  await step(state, client, caseId, 'ready', 'published', 'READY', async () => {
    await client.post(`/api/contents/${state.contentId}/publish`, {
      visibility: 'public',
      description: description ?? state.record.storyLogline ?? undefined,
    })
  })

  return publicState(state)
}

/** 剥离内部字段后返回可序列化状态（保留 _t 时间戳供跨进程断点续跑计算耗时） */
function publicState(state) {
  return { ...state }
}

// ---------------- 修订步进（Gate 3 / Gate 4） ----------------

/**
 * 一步修订：plan（定位）→ apply（新版本+重跑）→ 等生成 → render → READY
 * 返回 { plan, structureBefore, structureAfter, diff }
 */
export async function applyRevisionStep(client, caseId, feedback, note) {
  const state = loadState(caseId) ?? blankState(caseId, {})
  state.revisions = state.revisions ?? []
  state._t = state._t ?? {}

  const t0 = Date.now()
  const planRes = await client.post(`/api/contents/${state.contentId}/revision/plan`, { feedback })
  const plan = planRes.plan
  const structureAfter = planRes.structure

  // 取当前版本密封结构（DB 权威源；apply 前快照）
  const db = await openDb()
  const content = await db.content.findUnique({ where: { id: state.contentId }, select: { currentVersionId: true } })
  const currentVersion = content?.currentVersionId
    ? await db.contentVersion.findUnique({ where: { id: content.currentVersionId }, select: { structureJson: true } })
    : null
  const structureBefore = currentVersion?.structureJson ? JSON.parse(currentVersion.structureJson) : {}
  await db.$disconnect()

  const applyRes = await client.post(`/api/contents/${state.contentId}/revision/apply`, {
    structure: structureAfter,
    changelog: note ?? feedback,
  })

  await waitForStatus(client, state.contentId, 'REVIEW', { timeoutMs: 900_000 })
  await client.post(`/api/contents/${state.contentId}/render`, {})
  const doneData = await waitForStatus(client, state.contentId, 'READY', { timeoutMs: 420_000 })

  const elapsedMs = Date.now() - t0
  const entry = {
    feedback,
    plan,
    version: { versionId: applyRes.versionId, versionNumber: applyRes.versionNumber },
    changelog: note ?? feedback,
    elapsedMs,
    final: doneData.assets?.final ?? null,
    structureSummary: summarizeStructure(structureAfter),
    diff: diffStructures(structureBefore, structureAfter),
  }
  state.revisions.push(entry)
  state.contentId = state.contentId // 不变
  saveState(caseId, publicState(state))
  return entry
}

/** 从 creation 聚合响应提取当前版本密封结构 */
export function extractCurrentStructure(creationData) {
  const story = creationData?.story
  const version = creationData?.version
  // creation API 的 story 是工作副本（与密封配方同源于当前结构）；重构为 VersionStructure 形态
  return { story, style: story?.style ?? null }
}

// ---------------- 数据库直查（指标采集，绕过 UI） ----------------

/** 供 .mjs 脚本复用的 Prisma 查询（延迟 import，避免未装依赖时报错） */
export async function openDb() {
  const { PrismaClient } = await import('@prisma/client')
  const db = new PrismaClient()
  return db
}
