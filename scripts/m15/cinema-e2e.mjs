// 影视专业性升级 E2E 驱动（cinema-professional-logic）
// 链路：imagine/start → intent → directions → select → story → storyboard → generate → render → 证据落盘 → 清场
// 状态落 scripts/m15/state/cinema-e2e-state.json（断点续跑）；证据落 download/ui-e2e/。
// 验收点（业务升级 2026-10-08）：
//   A. Story 层真实产出：人物小传（desire/obstacle/arc/visualAnchor）+ 场景戏剧功能（dramaticFunction/valueShift）
//   B. Storyboard 层真实产出：景别 shotSize / 转场 transition / 在场人物 charactersInShot
//   C. 生成链真实跑通：ling/agnes 提供商接管 LLM/图像/视频（Generation 账本）
//   D. 成片字幕烧录（ASS 旁白行）+ 人物视觉锚点经 imagePromptFor 注入（单测已证，此处证链路无回归）
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'

const BASE = 'http://localhost:3000'
const STATE_FILE = 'scripts/m15/state/cinema-e2e-state.json'
const EVIDENCE_FILE = 'download/ui-e2e/cinema-e2e-evidence.json'

const EXPRESSION = '深夜快打烊的面馆，老板每次都会给晚归的加班女孩留最后一碗热汤面，今晚女孩没有来'

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
  : { contentId: null, cookie: '', step: 'start', startedAt: new Date().toISOString() }
if (!('cookie' in state)) state.cookie = ''
let cookie = state.cookie ?? ''

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) {
    cookie = setCookie.split(';')[0]
    state.cookie = cookie
  }
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json }
}

const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

mkdirSync('scripts/m15/state', { recursive: true })
mkdirSync('download/ui-e2e', { recursive: true })

// ---------- 断点恢复 ----------
if (state.contentId) {
  const probe = await api('GET', `/api/contents/${state.contentId}/creation`)
  if (probe.status !== 200) {
    log(`旧 contentId=${state.contentId} 不可达（${probe.status}），重新开始`)
    state.contentId = null
    state.step = 'start'
    saveState()
  } else {
    log(`恢复 contentId=${state.contentId}（status=${probe.json?.content?.status}，step=${state.step}）`)
  }
}

// ---------- 1. 开始创作 ----------
if (!state.contentId) {
  const res = await api('POST', '/api/imagine/start', { text: EXPRESSION })
  if (res.status !== 201) throw new Error(`imagine/start 失败：${res.status} ${JSON.stringify(res.json)}`)
  state.contentId = res.json.contentId
  state.step = 'intent'
  saveState()
  log(`作品已创建：${state.contentId}`)
}
const id = state.contentId

// ---------- 2. 意图编译（confirm 跳过访谈） ----------
if (state.step === 'intent') {
  const res = await api('POST', `/api/contents/${id}/intent`, { confirm: true })
  if (res.status !== 200) throw new Error(`intent 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
  state.step = 'directions'
  saveState()
  log(`意图就绪：topic=${res.json?.intent?.record?.fields?.topic ?? '?'} questions=${res.json?.questions?.length ?? 0}`)
}

// ---------- 3. 创作方向 ----------
let directions = null
if (state.step === 'directions') {
  const res = await api('POST', `/api/contents/${id}/directions`, {})
  if (res.status !== 200) throw new Error(`directions 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
  directions = res.json.directions
  const picked = directions[0]
  state.directionId = picked.id
  state.step = 'selected'
  saveState()
  log(`方向就绪：${directions.map((d) => d.name).join(' / ')} → 选「${picked.name}」`)
}
if (state.step === 'selected' && !state.selected) {
  const res = await api('POST', `/api/contents/${id}/directions/select`, { directionId: state.directionId })
  if (res.status !== 200) throw new Error(`select 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
  state.selected = true
  state.step = 'story'
  saveState()
  log('方向已冻结')
}

// ---------- 4. 展开故事（验收 A：人物小传 + 场景戏剧功能） ----------
let storyEvidence = state.storyEvidence ?? null
if (state.step === 'story') {
  const res = await api('POST', `/api/contents/${id}/story`, {})
  if (res.status !== 200) throw new Error(`story 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
  const story = res.json.story
  storyEvidence = {
    logline: story.logline,
    emotionArc: story.emotionArc,
    characters: (story.characters ?? []).map((c) => ({
      name: c.name,
      hasDesire: Boolean(c.desire), desire: c.desire,
      hasObstacle: Boolean(c.obstacle), obstacle: c.obstacle,
      hasArc: Boolean(c.arc), arc: c.arc,
      hasVisualAnchor: Boolean(c.visualAnchor), visualAnchor: c.visualAnchor,
    })),
    scenes: story.scenes.map((s) => ({
      index: s.index, summary: s.summary, location: s.location,
      dramaticFunction: s.dramaticFunction, valueShift: s.valueShift, timeOfDay: s.timeOfDay,
    })),
  }
  state.storyEvidence = storyEvidence
  state.step = 'storyboard'
  saveState()
  log(`故事就绪：logline=${story.logline}`)
  log(`  人物 ${storyEvidence.characters.length} 个：${storyEvidence.characters.map((c) => `${c.name}(欲望${c.hasDesire ? '✓' : '✗'}/锚点${c.hasVisualAnchor ? '✓' : '✗'})`).join('、')}`)
  log(`  场景 ${storyEvidence.scenes.length} 个：${storyEvidence.scenes.map((s) => `${s.dramaticFunction ?? '?'}(${s.valueShift ?? '?'})`).join(' → ')}`)
}

// ---------- 5. 分镜（验收 B：景别/转场/在场人物） ----------
let boardEvidence = state.boardEvidence ?? null
if (state.step === 'storyboard') {
  // 幂等：上次超时可能已完成 POST（状态已推进），直接读工作副本
  let story = null
  const probe = await api('GET', `/api/contents/${id}/creation`)
  if (probe.status === 200 && probe.json?.content?.status === 'STORYBOARD') {
    story = probe.json.story
    log('分镜已存在（上次运行完成），直接取证')
  }
  if (!story) {
    const res = await api('POST', `/api/contents/${id}/storyboard`, {})
    if (res.status !== 200) throw new Error(`storyboard 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
    story = res.json.story
  }
  const allShots = story.scenes.flatMap((s) => s.shots)
  boardEvidence = {
    shotCount: allShots.length,
    shots: allShots.map((sh) => ({
      index: sh.index,
      shotSize: sh.shotSize ?? null,
      transition: sh.transition ?? null,
      charactersInShot: sh.charactersInShot ?? [],
      cameraMotion: sh.cameraMotion,
      durationMs: sh.durationMs,
      narrationLine: sh.narrationLine,
      emotion: sh.emotion,
      imagePromptLen: (sh.imagePrompt ?? '').length,
    })),
    sizeProgression: allShots.map((sh) => sh.shotSize ?? '?'),
    firstNarration: allShots[0]?.narrationLine ?? null,
    lastNarration: allShots[allShots.length - 1]?.narrationLine ?? null,
  }
  state.boardEvidence = boardEvidence
  state.step = 'generate'
  saveState()
  log(`分镜就绪：${boardEvidence.shotCount} 镜；景别序列 ${boardEvidence.sizeProgression.join(' → ')}`)
  log(`  首镜旁白（钩子）：「${boardEvidence.firstNarration}」`)
  log(`  末镜旁白（余韵）：「${boardEvidence.lastNarration}」`)
}

// ---------- 6. AI 生成（验收 C：真实提供商） ----------
if (state.step === 'generate') {
  const res = await api('POST', `/api/contents/${id}/generate`, {})
  if (res.status !== 200) throw new Error(`generate 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
  state.step = 'generating'
  state.jobId = res.json.jobId
  saveState()
  log(`生成已入队（job=${state.jobId}）——开始轮询（native 视频逐镜串行，预计 5–15 分钟）`)
}

async function waitForStatus(target, timeoutMs, stageLabel) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const res = await api('GET', `/api/contents/${id}/creation`)
    if (res.status !== 200) throw new Error(`creation 轮询失败：${res.status}`)
    const status = res.json.content.status
    const job = res.json.job
    const label = job?.label ?? job?.stage ?? ''
    const line = `${status} | ${label}`
    if (line !== last) { log(`  ${line}`); last = line }
    if (status === target) return res.json
    if (res.json.lastError) throw new Error(`生成失败（${res.json.lastError.code}）：${res.json.lastError.message?.slice(0, 300)}`)
    await sleep(5000)
  }
  throw new Error(`${stageLabel} 超时（>${timeoutMs / 60000} 分钟）`)
}

if (state.step === 'generating') {
  const bundle = await waitForStatus('REVIEW', 22 * 60 * 1000, '生成')
  state.step = 'render'
  state.reviewBundle = {
    status: bundle.content.status,
    generationMode: bundle.generationMode,
    shotAssets: (bundle.assets?.shots ?? []).map((s) => ({ shotIndex: s.shotIndex, hasImage: Boolean(s.imageUrl), hasAudio: Boolean(s.audioUrl) })),
  }
  saveState()
  log(`生成完成：mode=${bundle.generationMode?.mode}（native ${bundle.generationMode?.nativeShots}/${bundle.generationMode?.totalShots}）`)
}

// ---------- 7. 渲染成片（验收 D：字幕烧录） ----------
if (state.step === 'render') {
  const res = await api('POST', `/api/contents/${id}/render`, {})
  if (res.status !== 200) throw new Error(`render 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
  state.step = 'rendering'
  state.renderJobId = res.json.jobId
  saveState()
  log('渲染已入队')
}
if (state.step === 'rendering') {
  const bundle = await waitForStatus('READY', 6 * 60 * 1000, '渲染')
  state.step = 'verify'
  state.finalAsset = { url: bundle.assets?.final?.url, durationMs: bundle.assets?.final?.durationMs }
  saveState()
  log(`成片就绪：${state.finalAsset.url}（${Math.round((state.finalAsset.durationMs ?? 0) / 1000)}s）`)
}

// ---------- 8. 证据汇总（DB 直读 Generation 账本 + 版本配方） ----------
if (state.step === 'verify') {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } })
  const gens = await prisma.generation.findMany({ where: { contentId: id }, orderBy: { createdAt: 'asc' } })
  const version = await prisma.contentVersion.findFirst({ where: { contentId: id }, orderBy: { versionNumber: 'desc' } })
  const structure = version?.structureJson ? JSON.parse(version.structureJson) : null

  const byProvider = {}
  for (const g of gens) {
    const key = `${g.type} @ ${g.provider}`
    byProvider[key] = (byProvider[key] ?? 0) + 1
  }
  const evidence = {
    verifiedAt: new Date().toISOString(),
    task: '影视专业性升级 E2E（三幕微结构/人物小传/景别语法/视觉锚点/字幕）',
    expression: EXPRESSION,
    contentId: id,
    story: storyEvidence,
    storyboard: boardEvidence,
    sealedStructure: structure ? {
      charactersSealed: (structure.characters ?? []).map((c) => ({ name: c.name, hasVisualAnchor: Boolean(c.visualAnchor) })),
      sceneFunctions: (structure.story?.scenes ?? []).map((s) => s.dramaticFunction),
      shotSizes: (structure.story?.scenes ?? []).flatMap((s) => s.shots).map((s) => s.shotSize),
      shotsWithCharactersInShot: (structure.story?.scenes ?? []).flatMap((s) => s.shots).filter((s) => (s.charactersInShot ?? []).length > 0).length,
    } : null,
    generationLedger: {
      totalCalls: gens.length,
      succeeded: gens.filter((g) => g.status === 'succeeded').length,
      failed: gens.filter((g) => g.status === 'failed').length,
      byProvider,
      llmProviders: [...new Set(gens.filter((g) => g.type === 'text.plan').map((g) => `${g.provider} / ${g.model}`))],
      imageProviders: [...new Set(gens.filter((g) => g.type === 'image.shot').map((g) => `${g.provider} / ${g.model}`))],
      videoProviders: [...new Set(gens.filter((g) => g.type === 'video.shot').map((g) => `${g.provider} / ${g.model}`))],
      ttsProviders: [...new Set(gens.filter((g) => g.type === 'audio.tts').map((g) => `${g.provider} / ${g.model}`))],
    },
    final: state.finalAsset,
    review: state.reviewBundle,
  }
  writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2))
  await prisma.$disconnect()

  // 验收断言（软失败：证据已落盘，人工复核）
  const checks = {
    charactersHaveDesire: (storyEvidence?.characters ?? []).every((c) => c.hasDesire),
    charactersHaveAnchor: (storyEvidence?.characters ?? []).every((c) => c.hasVisualAnchor),
    sceneFunctionsPresent: (storyEvidence?.scenes ?? []).every((s) => s.dramaticFunction),
    sceneValueShiftsPresent: (storyEvidence?.scenes ?? []).every((s) => Boolean(s.valueShift)),
    shotSizesPresent: (boardEvidence?.shots ?? []).every((s) => s.shotSize),
    charactersInShotUsed: (boardEvidence?.shots ?? []).some((s) => (s.charactersInShot ?? []).length > 0),
    sizeProgressionVaries: new Set(boardEvidence?.sizeProgression ?? []).size > 1,
  }
  log('验收断言：' + JSON.stringify(checks, null, 2))
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k)
  log(failed.length === 0 ? '✓ 全部专业性断言通过' : `✗ 未通过：${failed.join(', ')}（证据已落盘供复核）`)
  state.step = 'done'
  saveState()
}

if (state.step === 'done') {
  log('E2E 完成，证据：' + EVIDENCE_FILE)
}
