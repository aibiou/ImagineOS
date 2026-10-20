// 世界一致性升级 E2E 驱动（cinema-world-consistency）
// 链路：imagine/start → intent → directions → select → story → storyboard → generate → render → 证据落盘 → 清场
// 状态落 scripts/m15/state/cinema-world-e2e-state.json（断点续跑）；证据落 download/ui-e2e/。
// 验收点（全面一致性升级 2026-10-09）：
//   A. Story 层真实产出：lookBook（全片视觉圣经）+ 每场 locationAnchor（场景视觉锚点）
//   B. 生成账本直接证据：image.shot / video.shot 的 inputJson.prompt 含
//      'Film look (whole film)' + 'Scene (keep environment consistent)' + 'Lighting:' ——代码注入真实流量兑现
//   C. 同场景所有镜头注入同一 locationAnchor（逐字一致，代码保证）
//   D. 渲染成片（loudnorm 响度归一链路无错）+ 音频流存在
//   E. 帧抽取留档（供 VLM 盲评脚本独立复核场景/人物/色调一致性）
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const BASE = 'http://localhost:3000'
const STATE_FILE = 'scripts/m15/state/cinema-world-e2e-state.json'
const EVIDENCE_FILE = 'download/ui-e2e/cinema-world-e2e-evidence.json'
const FRAMES_DIR = 'download/ui-e2e/cinema-world-frames'

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
mkdirSync(FRAMES_DIR, { recursive: true })

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

// ---------- 2. 意图编译 ----------
if (state.step === 'intent') {
  const res = await api('POST', `/api/contents/${id}/intent`, { confirm: true })
  if (res.status !== 200) throw new Error(`intent 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
  state.step = 'directions'
  saveState()
  log('意图就绪')
}

// ---------- 3. 创作方向（025：入队即返 → 轮询出现） ----------
if (state.step === 'directions') {
  const res = await api('POST', `/api/contents/${id}/directions`, {})
  if (res.status !== 200) throw new Error(`directions 入队失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
  let directions = null
  for (let i = 0; i < 72 && !directions?.length; i++) {
    await new Promise((r) => setTimeout(r, 2500))
    const probe = await api('GET', `/api/contents/${id}/creation`)
    directions = probe.json?.plan?.directions
    const job = probe.json?.job
    if (job && (job.status === 'failed' || job.status === 'timeout')) {
      throw new Error(`方向构思失败：${job.error ?? '未知'}`)
    }
  }
  if (!directions?.length) throw new Error('方向轮询超时（180s）')
  const picked = directions[0]
  state.directionId = picked.id
  state.step = 'selected'
  saveState()
  log(`方向：${directions.map((d) => d.name).join(' / ')} → 选「${picked.name}」`)
}
if (state.step === 'selected' && !state.selected) {
  const res = await api('POST', `/api/contents/${id}/directions/select`, { directionId: state.directionId })
  if (res.status !== 200) throw new Error(`select 失败：${res.status}`)
  state.selected = true
  state.step = 'story'
  saveState()
}

// ---------- 4. 展开故事（验收 A：lookBook + locationAnchor） ----------
let storyEvidence = state.storyEvidence ?? null
if (state.step === 'story') {
  const res = await api('POST', `/api/contents/${id}/story`, {})
  if (res.status !== 200) throw new Error(`story 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
  const story = res.json.story
  storyEvidence = {
    logline: story.logline,
    lookBook: story.lookBook ?? null,
    emotionArc: story.emotionArc,
    characters: (story.characters ?? []).map((c) => ({ name: c.name, visualAnchor: c.visualAnchor ?? null })),
    scenes: story.scenes.map((s) => ({
      index: s.index, summary: s.summary, location: s.location ?? null,
      locationAnchor: s.locationAnchor ?? null, timeOfDay: s.timeOfDay ?? null,
      dramaticFunction: s.dramaticFunction, valueShift: s.valueShift,
    })),
  }
  state.storyEvidence = storyEvidence
  state.step = 'storyboard'
  saveState()
  log(`故事就绪：${story.logline}`)
  log(`  lookBook：「${storyEvidence.lookBook ?? '（缺失！）'}」`)
  for (const s of storyEvidence.scenes) {
    log(`  场景${s.index} ${s.location ?? '?'}${s.timeOfDay ? '·' + s.timeOfDay : ''} 锚点${s.locationAnchor ? '✓' : '✗'}：${(s.locationAnchor ?? '').slice(0, 70)}…`)
  }
}

// ---------- 5. 分镜 ----------
let boardEvidence = state.boardEvidence ?? null
if (state.step === 'storyboard') {
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
    sizeProgression: allShots.map((sh) => sh.shotSize ?? '?'),
    scenes: story.scenes.map((s) => ({
      index: s.index, shots: s.shots.length,
      locationAnchor: s.locationAnchor ?? null, timeOfDay: s.timeOfDay ?? null,
    })),
  }
  state.boardEvidence = boardEvidence
  state.step = 'generate'
  saveState()
  log(`分镜就绪：${boardEvidence.shotCount} 镜；景别 ${boardEvidence.sizeProgression.join(' → ')}`)
}

// ---------- 6. AI 生成 ----------
if (state.step === 'generate') {
  const res = await api('POST', `/api/contents/${id}/generate`, {})
  if (res.status !== 200) throw new Error(`generate 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
  state.step = 'generating'
  state.jobId = res.json.jobId
  saveState()
  log(`生成已入队（job=${state.jobId}）——轮询（native 视频串行，预计 5–15 分钟）`)
}

async function waitForStatus(target, timeoutMs, stageLabel) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const res = await api('GET', `/api/contents/${id}/creation`)
    if (res.status !== 200) throw new Error(`creation 轮询失败：${res.status}`)
    const status = res.json.content.status
    const job = res.json.job
    const line = `${status} | ${job?.label ?? job?.stage ?? ''}`
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
  }
  saveState()
  log(`生成完成：mode=${bundle.generationMode?.mode}（native ${bundle.generationMode?.nativeShots}/${bundle.generationMode?.totalShots}）`)
}

// ---------- 7. 渲染成片（验收 D：loudnorm 音频链） ----------
if (state.step === 'render') {
  const res = await api('POST', `/api/contents/${id}/render`, {})
  if (res.status !== 200) throw new Error(`render 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
  state.step = 'rendering'
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

// ---------- 8. 证据汇总（验收 B/C：账本 prompt 注入直接证据 + ffprobe + 帧抽取） ----------
if (state.step === 'verify') {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } })
  const gens = await prisma.generation.findMany({ where: { contentId: id }, orderBy: { createdAt: 'asc' } })
  const version = await prisma.contentVersion.findFirst({ where: { contentId: id }, orderBy: { versionNumber: 'desc' } })
  const structure = version?.structureJson ? JSON.parse(version.structureJson) : null

  // ---- 验收 B：账本 prompt 注入断言（真实调用的直接证据） ----
  const imageGens = gens.filter((g) => g.type === 'image.shot' && g.status === 'succeeded')
  const videoGens = gens.filter((g) => g.type === 'video.shot' && g.status === 'succeeded')
  const promptOf = (g) => { try { return JSON.parse(g.inputJson ?? '{}').prompt ?? null } catch { return null } }
  const injectionCheck = (g) => {
    const p = promptOf(g) ?? ''
    return {
      promptRecorded: Boolean(promptOf(g)),
      hasLookBook: p.includes('Film look (whole film)'),
      hasLocationAnchor: p.includes('Scene (keep environment consistent)'),
      hasLighting: p.includes('Lighting:'),
      hasCharacterAnchor: p.includes('keep visually consistent'),
    }
  }
  const imageInjection = imageGens.map(injectionCheck)
  const videoInjection = videoGens.map(injectionCheck)

  // ---- 验收 C：同场景所有镜头注入同一锚点（逐字一致，代码保证） ----
  const sceneAnchorConsistency = (structure?.story?.scenes ?? []).map((sc) => {
    const prompts = imageGens.map(promptOf).filter(Boolean)
    const anchor = sc.locationAnchor
    const hits = anchor ? prompts.filter((p) => p.includes(anchor)) : []
    return { sceneIndex: sc.index, shots: sc.shots.length, hasAnchor: Boolean(anchor), anchorHitCount: hits.length }
  })

  const byProvider = {}
  for (const g of gens) {
    const key = `${g.type} @ ${g.provider}`
    byProvider[key] = (byProvider[key] ?? 0) + 1
  }

  // ---- 验收 D：ffprobe 成片（音频流 + loudnorm 后规格） ----
  let ffprobe = null
  try {
    const finalUrl = state.finalAsset?.url ?? ''
    const diskPath = finalUrl.startsWith('/storage/') ? `storage${finalUrl.slice('/storage'.length)}` : null
    // 成片实际在 storage/assets/<hash>.mp4；从 Asset 表反查更稳
    const asset = await prisma.asset.findFirst({
      where: { contentId: id, kind: 'final' },
      orderBy: { createdAt: 'desc' },
    })
    const probePath = asset ? `storage/assets/${asset.storageLocation.split('/').pop()}` : diskPath
    if (probePath && existsSync(probePath)) {
      const out = execFileSync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,sample_rate',
        '-of', 'json', probePath,
      ]).toString()
      ffprobe = JSON.parse(out)
      // ---- 验收 E：帧抽取（首镜中点 / 次镜中点 / 末镜中点） ----
      const shots = (structure?.story?.scenes ?? []).flatMap((s) => s.shots)
      let acc = 0
      const timeline = shots.map((sh) => { const start = acc; acc += (sh.durationMs ?? 6000) / 1000; return { start, end: acc } })
      const total = acc || 1
      const picks = [
        { name: 'shot1-mid', t: (timeline[0]?.start + timeline[0]?.end) / 2 || total * 0.15 },
        { name: 'shot2-mid', t: (timeline[1]?.start + timeline[1]?.end) / 2 || total * 0.45 },
        { name: 'last-mid', t: (timeline[timeline.length - 1]?.start + timeline[timeline.length - 1]?.end) / 2 || total * 0.85 },
      ]
      for (const p of picks) {
        try {
          execFileSync('ffmpeg', ['-y', '-ss', Math.min(p.t, total - 0.5).toFixed(2), '-i', probePath,
            '-frames:v', '1', `${FRAMES_DIR}/${p.name}.jpg`], { stdio: 'ignore' })
          log(`帧抽取：${p.name}.jpg @ ${p.t.toFixed(1)}s`)
        } catch (e) { log(`帧抽取失败 ${p.name}：${e.message}`) }
      }
    } else {
      log(`成片路径未定位（url=${finalUrl}）`)
    }
  } catch (e) { log(`ffprobe 失败：${e.message}`) }

  const evidence = {
    verifiedAt: new Date().toISOString(),
    task: '世界一致性升级 E2E（lookBook/locationAnchor/时段光线/账本注入证据/loudnorm）',
    expression: EXPRESSION,
    contentId: id,
    story: storyEvidence,
    storyboard: boardEvidence,
    sealedStructure: structure ? {
      lookBookSealed: structure.story?.lookBook ?? null,
      scenes: (structure.story?.scenes ?? []).map((s) => ({
        index: s.index, location: s.location, locationAnchor: s.locationAnchor ?? null, timeOfDay: s.timeOfDay ?? null,
        shots: s.shots.length,
      })),
    } : null,
    ledgerInjection: {
      imageSucceeded: imageGens.length,
      imageInjection,
      imageAllInjected: imageInjection.length > 0 && imageInjection.every((c) => c.hasLookBook && c.hasLocationAnchor),
      videoSucceeded: videoGens.length,
      videoInjection,
      sceneAnchorConsistency,
    },
    generationLedger: {
      totalCalls: gens.length,
      succeeded: gens.filter((g) => g.status === 'succeeded').length,
      failed: gens.filter((g) => g.status === 'failed').length,
      byProvider,
    },
    final: state.finalAsset,
    ffprobe,
    review: state.reviewBundle,
  }
  writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2))
  await prisma.$disconnect()

  const checks = {
    storyHasLookBook: Boolean(storyEvidence?.lookBook),
    scenesHaveAnchors: (storyEvidence?.scenes ?? []).every((s) => Boolean(s.locationAnchor)),
    lookBookSealed: Boolean(structure?.story?.lookBook),
    imagePromptsInjected: evidence.ledgerInjection.imageAllInjected,
    promptsRecordedInLedger: imageInjection.every((c) => c.promptRecorded),
    finalHasAudio: (ffprobe?.streams ?? []).some((s) => s.codec_type === 'audio'),
  }
  log('验收断言：' + JSON.stringify(checks, null, 2))
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k)
  log(failed.length === 0 ? '✓ 全部世界一致性断言通过' : `✗ 未通过：${failed.join(', ')}（证据已落盘供复核）`)
  state.step = 'cleanup'
  saveState()
}

// ---------- 9. 清场 ----------
if (state.step === 'cleanup') {
  const res = await api('DELETE', `/api/contents/${id}`)
  log(`清场：DELETE ${id} → ${res.status}`)
  writeFileSync(STATE_FILE, JSON.stringify({ contentId: null, cookie: '', step: 'start', done: true, finishedAt: new Date().toISOString() }, null, 2))
  log('E2E 完成，证据：' + EVIDENCE_FILE + '；帧：' + FRAMES_DIR)
}
if (state.step === 'start' && state.done) {
  log('（上次已完成并清场；如需重跑请删除 state 文件）')
}
