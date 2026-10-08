// E2E 分享链路驱动（底座②端到端验证，2026-10-08；断点续跑版）
// 目的：验证「发布分享落地页」功能真实可用——走真实用户公共 API 全链：
//   表达 → 意图确认 → 方向生成/选定 → 故事 → 分镜 → AI 生成（product 模式
//   native-first）→ 渲染成片 → 发布 → 匿名访客看 /w/:id → 删除收尾。
// 依据：产品负责人 2026-10-08 授权「生成作品仅为端到端验证功能真实可用」。
// 断点续跑：本环境会外部 SIGKILL 后台进程（supervise-g6-native.sh 已记录）；
//   状态与 cookie 落 /tmp/e2e-share-state.json，重启后按状态机恢复当前步。
// 用法：node scripts/m15/e2e-share-driver.mjs（由 supervise-e2e-share.sh 循环拉起）
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

const BASE = 'http://localhost:3000'
const STATE_FILE = '/tmp/e2e-share-state.json'
const TEXT = '深夜的城市慢慢安静下来，一杯还冒着热气的咖啡放在窗台，提醒每一个晚归的人：今天也辛苦了。'
const POLL_MS = 5000
const STORYBOARD_BUDGET_MS = 35 * 60 * 1000
const RENDER_BUDGET_MS = 10 * 60 * 1000

const state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  : { contentId: null, cookie: '', startedAt: new Date().toISOString() }
if (!('contentId' in state)) state.contentId = null
if (!('cookie' in state)) state.cookie = ''

let cookie = state.cookie ?? ''
const persist = (extra = {}) => {
  Object.assign(state, extra, { at: new Date().toISOString() })
  state.cookie = cookie
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 1))
}
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) {
    cookie = setCookie.split(';')[0]
    persist()
  }
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* HTML 响应 */ }
  return { res, json, text }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 轮询创作 bundle 直到谓词命中；超时抛错 */
async function pollCreation(contentId, predicate, label, budgetMs) {
  const deadline = Date.now() + budgetMs
  let last = null
  let lastProgressLog = 0
  while (Date.now() < deadline) {
    const { res, json } = await api(`/api/contents/${contentId}/creation`)
    if (!res.ok) throw new Error(`creation 轮询失败 HTTP ${res.status}`)
    last = json
    if (predicate(json)) return json
    const job = json?.job
    if (job && Date.now() - lastProgressLog > 15000) {
      lastProgressLog = Date.now()
      const out = job.outputJson ? JSON.parse(job.outputJson) : {}
      log(`  … ${label}｜status=${json.content.status} job=${job.status} 进度=${out.label ?? `${out.current ?? '?'}/${out.total ?? '?'}`} 镜头资产=${(out.shotAssets ?? []).length}`)
    }
    await sleep(POLL_MS)
  }
  throw new Error(`超时：${label}（最后状态 ${last?.content?.status}）`)
}

async function main() {
  let contentId = state.contentId
  persist({ step: 'resume-check' })
  let bundle = null
  if (contentId) {
    const { res, json } = await api(`/api/contents/${contentId}/creation`)
    if (res.ok) bundle = json
    else { log(`旧 contentId=${contentId} 不可达（${res.status}），重新开始`); contentId = null; cookie = '' }
  }

  // ---- 1. 开始表达（无既有内容时）----
  if (!contentId) {
    const start = await api('/api/imagine/start', { method: 'POST', body: { text: TEXT } })
    if (!start.res.ok) throw new Error(`imagine/start 失败 ${start.res.status}: ${start.text.slice(0, 200)}`)
    contentId = start.json.contentId
    if (!contentId) throw new Error('imagine/start 未返回 contentId')
    persist({ contentId, step: 'start' })
    log(`① 表达已开始 contentId=${contentId}`)
  } else {
    log(`↻ 续跑 contentId=${contentId}（status=${bundle?.content?.status}）`)
  }

  const reload = async () => {
    const { json } = await api(`/api/contents/${contentId}/creation`)
    return json
  }
  let b = bundle ?? (await reload())

  // ---- 2. 意图确认（IDEA→INTENT）----
  if (b.content.status === 'IDEA') {
    persist({ step: 'intent' })
    const intent = await api(`/api/contents/${contentId}/intent`, { method: 'POST', body: { confirm: true } })
    if (!intent.res.ok) throw new Error(`intent 失败: ${intent.text.slice(0, 200)}`)
    log('② 意图已确认 → INTENT')
    b = await reload()
  }

  // ---- 3. 方向生成 + 选定（INTENT→PLANNING）----
  if (b.content.status === 'INTENT') {
    persist({ step: 'directions' })
    const dirs = await api(`/api/contents/${contentId}/directions`, { method: 'POST', body: {} })
    if (!dirs.res.ok) throw new Error(`directions 失败: ${dirs.text.slice(0, 200)}`)
    b = await pollCreation(contentId, (x) => (x.plan?.directions?.length ?? 0) > 0, '方向生成', 3 * 60 * 1000)
    log(`③ 方向就绪（${b.plan.directions.length} 个）→ 选定「${b.plan.directions[0].name}」`)
  }
  if (b.content.status === 'INTENT' || (b.plan?.directions?.length && b.content.status === 'INTENT')) {
    const select = await api(`/api/contents/${contentId}/directions/select`, { method: 'POST', body: { directionId: b.plan.directions[0].id } })
    if (!select.res.ok) throw new Error(`directions/select 失败: ${select.text.slice(0, 200)}`)
    log('④ 方向已锁定')
    b = await reload()
  }

  // ---- 5. 故事（PLANNING→STORY）----
  if (b.content.status === 'PLANNING' && !b.story) {
    persist({ step: 'story' })
    const story = await api(`/api/contents/${contentId}/story`, { method: 'POST' })
    if (!story.res.ok) throw new Error(`story 失败: ${story.text.slice(0, 200)}`)
    b = await pollCreation(contentId, (x) => x.story != null, '故事展开', 5 * 60 * 1000)
  }
  if (b.content.status === 'PLANNING' && b.story) {
    log(`⑤ 故事就绪（${b.story.scenes?.length ?? 0} 场景）`)
  }

  // ---- 6. 分镜（STORY→STORYBOARD）----
  if (b.content.status === 'STORY') {
    persist({ step: 'storyboard' })
    const sb = await api(`/api/contents/${contentId}/storyboard`, { method: 'POST' })
    if (!sb.res.ok) throw new Error(`storyboard 失败: ${sb.text.slice(0, 200)}`)
    b = await pollCreation(contentId, (x) => x.content.status === 'STORYBOARD', '分镜拆解', 3 * 60 * 1000)
  }
  const shotCount = (b.story?.scenes ?? []).flatMap((s) => s.shots ?? []).length
  if (['STORYBOARD', 'GENERATING', 'REVIEW', 'READY', 'PUBLISHED'].includes(b.content.status)) {
    log(`⑥ 分镜就绪（${shotCount} 镜）`)
  }

  // ---- 7. AI 生成（STORYBOARD→REVIEW；native-first 长时段）----
  if (b.content.status === 'STORYBOARD') {
    persist({ step: 'generate' })
    const gen = await api(`/api/contents/${contentId}/generate`, { method: 'POST' })
    if (!gen.res.ok) throw new Error(`generate 失败: ${gen.text.slice(0, 200)}`)
    log(`⑦ AI 生成开始（product 模式 native-first，预算 ${Math.round(STORYBOARD_BUDGET_MS / 60000)} 分钟）`)
  }
  if (['STORYBOARD', 'GENERATING'].includes(b.content.status)) {
    b = await pollCreation(
      contentId,
      (x) => ['REVIEW', 'READY', 'PUBLISHED'].includes(x.content.status),
      'AI 生成',
      STORYBOARD_BUDGET_MS,
    )
    log('⑧ 生成完成 → REVIEW')
  }

  // ---- 8. 渲染成片（REVIEW→READY）----
  if (b.content.status === 'REVIEW') {
    persist({ step: 'render' })
    const render = await api(`/api/contents/${contentId}/render`, { method: 'POST' })
    if (!render.res.ok) throw new Error(`render 失败: ${render.text.slice(0, 200)}`)
    b = await pollCreation(contentId, (x) => x.content.status === 'READY', '渲染成片', RENDER_BUDGET_MS)
  }
  if (b.content.status === 'READY' || b.content.status === 'PUBLISHED') {
    if (!b.assets?.final) {
      b = await reload()
      if (!b.assets?.final) throw new Error('READY 但无 final 资产')
    }
    log(`⑨ 成片就绪 ${b.assets.final.url}（${b.assets.final.durationMs ?? '?'}ms）`)
  }

  // ---- 9. 发布（READY→PUBLISHED）----
  if (b.content.status === 'READY') {
    persist({ step: 'publish' })
    const pub = await api(`/api/contents/${contentId}/publish`, { method: 'POST', body: { visibility: 'public' } })
    if (!pub.res.ok) throw new Error(`publish 失败: ${pub.text.slice(0, 200)}`)
    b = await reload()
    log('⑩ 已发布 → PUBLISHED')
  }

  // ---- 10. 匿名访客验证分享页 ----
  persist({ step: 'verify-share' })
  const savedCookie = cookie
  cookie = ''
  const share = await api(`/w/${contentId}`)
  cookie = savedCookie
  if (share.res.status !== 200) throw new Error(`分享页 HTTP ${share.res.status}`)
  const html = share.text
  const checks = {
    hasVideoSrc: html.includes('/api/assets/') && html.includes('<video'),
    hasTitle: html.includes((b.content.title ?? '').slice(0, 8)),
    hasRemixCta: html.includes('从这里开始创作'),
  }
  log(`⑪ 分享页 200：video=${checks.hasVideoSrc} title=${checks.hasTitle} remixCTA=${checks.hasRemixCta}`)

  const finalUrl = new URL(b.assets.final.url, BASE).pathname
  const assetRes = await fetch(`${BASE}${finalUrl}`)
  log(`⑫ 视频资产伺服 HTTP ${assetRes.status}（${assetRes.headers.get('content-type')}，${assetRes.headers.get('content-length') ?? '?'} bytes）`)
  if (assetRes.status !== 200) throw new Error('资产伺服失败')

  const explore = await api('/api/contents?scope=explore')
  const inExplore = (explore.json?.items ?? []).some((i) => i.id === contentId)
  log(`⑬ 探索列表${inExplore ? '已含' : '未含'}该作品`)

  // ---- 11a. 核心链路取证（删除前执行——级联删除会抹掉 Generation/Provenance 证据）----
  // 目的：回答「一句话→最终 AI 内容结果」的产物形态——每镜 native 视频成败、
  // provider、错误串、成片形态（ffprobe）。写入 /tmp/e2e-core-forensics.json。
  try {
    const { PrismaClient } = await import('@prisma/client')
    const { execFileSync } = await import('node:child_process')
    const db = new PrismaClient()
    const gens = await db.generation.findMany({
      where: { contentId },
      orderBy: { createdAt: 'asc' },
      select: { type: true, provider: true, model: true, status: true, outputJson: true, inputJson: true, latencyMs: true, createdAt: true },
    })
    const provs = await db.provenance.findMany({
      where: { contentId, OR: [{ eventType: 'ai_generated' }] },
      orderBy: { createdAt: 'asc' },
      select: { model: true, payloadJson: true, createdAt: true },
    })
    const sbJob = await db.generationJob.findFirst({
      where: { contentId, type: 'video.storyboard', status: 'succeeded' },
      orderBy: { completedAt: 'desc' },
    })
    const shotAssets = sbJob?.outputJson ? (JSON.parse(sbJob.outputJson).shotAssets ?? []) : []
    const nativeShots = shotAssets.filter((s) => s.videoAssetId).length
    const mode = nativeShots === 0 ? 'composition' : nativeShots === shotAssets.length ? 'native' : 'hybrid'
    const finalRes = await fetch(`${BASE}${finalUrl}`)
    const filmBuf = Buffer.from(await finalRes.arrayBuffer())
    writeFileSync('/tmp/e2e-final-film.mp4', filmBuf)
    let ffprobe = null
    try {
      ffprobe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height,r_frame_rate', '-of', 'json', '/tmp/e2e-final-film.mp4']).toString())
    } catch (e) { ffprobe = { error: String(e?.message ?? e).slice(0, 200) } }
    const forensics = {
      at: new Date().toISOString(),
      generationMode: { mode, nativeShots, totalShots: shotAssets.length },
      videoShotLedger: gens.filter((g) => g.type === 'video.shot').map((g) => {
        const out = g.outputJson ? (() => { try { return JSON.parse(g.outputJson) } catch { return {} } })() : {}
        const inp = g.inputJson ? (() => { try { return JSON.parse(g.inputJson) } catch { return {} } })() : {}
        return { at: g.createdAt.toISOString().slice(11, 23), provider: g.provider, model: g.model, status: g.status, purpose: inp.purpose ?? null, latencyMs: g.latencyMs, error: out.error ?? null }
      }),
      ledgerByType: gens.reduce((acc, g) => { const k = `${g.type}/${g.status}`; acc[k] = (acc[k] ?? 0) + 1; return acc }, {}),
      nativeFallbackEvents: provs.filter((p) => p.model === 'native-fallback').map((p) => JSON.parse(p.payloadJson ?? '{}')),
      modeDecisionEvent: provs.find((p) => p.model === 'mode-decision')?.payloadJson ?? null,
      film: { bytes: filmBuf.length, durationSec: ffprobe?.format?.duration ?? null, streams: (ffprobe?.streams ?? []).map((s) => `${s.codec_name} ${s.width ?? ''}x${s.height ?? ''} ${s.r_frame_rate ?? ''}`.trim()) },
    }
    writeFileSync('/tmp/e2e-core-forensics.json', JSON.stringify(forensics, null, 1))
    log(`⑬a 核心取证：mode=${mode}（native ${nativeShots}/${shotAssets.length} 镜）｜video.shot 记账 ${forensics.videoShotLedger.length} 条｜成片 ${forensics.film.durationSec}s/${(filmBuf.length / 1024 / 1024).toFixed(1)}MB`)
    await db.$disconnect()
  } catch (e) {
    log(`⑬a 取证失败（不阻断主流程）：${String(e?.message ?? e).slice(0, 200)}`)
  }

  // ---- 11. 删除收尾（E2E 顺带验证删除链 + 平台零残留）----
  persist({ step: 'cleanup' })
  const del = await api(`/api/contents/${contentId}`, { method: 'DELETE' })
  if (!del.res.ok) throw new Error(`删除失败: ${del.text.slice(0, 200)}`)
  cookie = ''
  const after = await api(`/w/${contentId}`)
  log(`⑭ 删除完成；分享页善后 HTTP ${after.res.status}（期望 404）`)

  const summary = {
    result: 'SUCCESS',
    contentId,
    title: b.content.title,
    shots: shotCount,
    durationMs: b.assets.final.durationMs ?? null,
    shareChecks: checks,
    inExplore,
    afterDeleteStatus: after.res.status,
  }
  writeFileSync('/tmp/e2e-share-result.json', JSON.stringify(summary, null, 1))
  persist({ step: 'done', result: 'SUCCESS' })
  log('✅ E2E 分享链路验证通过', JSON.stringify(summary))
  process.exit(0)
}

main().catch((e) => {
  console.error(`❌ E2E 失败：${e?.message ?? e}`)
  process.exit(1)
})
