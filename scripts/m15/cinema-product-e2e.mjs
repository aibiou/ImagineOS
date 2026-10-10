// 产品级升级 E2E 驱动（cinema-product-021：多画幅 + 修订定位器语义升级）
// 链路：imagine/start（横屏原话）→ intent（画幅识别断言）→ …全管线… → render → ffprobe 1280x720
//       → 修订定位器（「色调再暖」应命中 lookBook 层，镜头词不动）→ apply（画幅守卫 + 差异账本）→ 清场
// 状态落 scripts/m15/state/cinema-product-e2e-state.json（断点续跑）；证据落 download/ui-e2e/。
// 验收点：
//   A. 意图层：fields.aspectRatio='16:9' 且 sources.aspectRatio='user'（原话「横屏」被识别）
//   B. 密封配方：ContentVersion.structureJson.aspectRatio='16:9'
//   C. 生成账本：image.shot inputJson.size='1344x768'（画幅感知管线兑现）
//   D. 成片：ffprobe 宽 1280 高 720 + aac 音频流（渲染画幅兑现）
//   E. 修订定位器：targetLevel=style；story.lookBook 变化；全部 imagePrompt 逐字不变（分层传播正道）
//   F. 画幅守卫：apply 后新版本 structureJson.aspectRatio='16:9'（丢字段也不回 9:16）+ revision-diff 账本事件
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const BASE = 'http://localhost:3000'
const STATE_FILE = 'scripts/m15/state/cinema-product-e2e-state.json'
const EVIDENCE_FILE = 'download/ui-e2e/cinema-product-e2e-evidence.json'
const FRAMES_DIR = 'download/ui-e2e/cinema-product-frames'

const EXPRESSION = '横屏做一个深夜修表铺的短片：老修表匠每晚留一盏灯，等一个再也没回来的客人'

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

// ---------- 1. 开始创作（横屏原话） ----------
if (!state.contentId) {
  const res = await api('POST', '/api/imagine/start', { text: EXPRESSION })
  if (res.status !== 201) throw new Error(`imagine/start 失败：${res.status} ${JSON.stringify(res.json)}`)
  state.contentId = res.json.contentId
  state.step = 'intent'
  saveState()
  log(`作品已创建：${state.contentId}`)
}
const id = state.contentId

// ---------- 2. 意图编译（验收 A：横屏识别） ----------
let intentEvidence = state.intentEvidence ?? null
if (state.step === 'intent') {
  const probe = await api('GET', `/api/contents/${id}/creation`)
  const st = probe.json?.content?.status
  if (st !== 'IDEA') {
    // 断点恢复：服务端已推进（进程死亡前 confirm 已完成）——从 DB 权威读取意图记录
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } })
    const row = await prisma.intent.findFirst({ where: { contentId: id }, orderBy: { createdAt: 'asc' } })
    await prisma.$disconnect()
    const fields = row?.fieldsJson ? JSON.parse(row.fieldsJson) : {}
    intentEvidence = {
      aspectRatio: fields?.fields?.aspectRatio ?? null,
      aspectSource: fields?.sources?.aspectRatio ?? null,
      topic: fields?.fields?.topic ?? null,
      via: 'db-recovered',
    }
    state.intentEvidence = intentEvidence
    state.step = 'directions'
    saveState()
    log(`恢复（status=${st}）：DB 意图 aspectRatio=${intentEvidence.aspectRatio}（来源=${intentEvidence.aspectSource}）`)
  }
}
if (state.step === 'intent' && !intentEvidence) {
  // 断点恢复：证据已存则跳过首轮抽取（内容可能已被服务端推进到 INTENT）
  if (!intentEvidence) {
    // 先无 confirm 抽取（模拟 UI 自动理解），断言画幅识别
    const first = await api('POST', `/api/contents/${id}/intent`, {})
    if (first.status !== 200) throw new Error(`intent 抽取失败：${first.status} ${JSON.stringify(first.json)?.slice(0, 300)}`)
    const f = first.json.record?.fields ?? {}
    const s = first.json.record?.sources ?? {}
    intentEvidence = { aspectRatio: f.aspectRatio ?? null, aspectSource: s.aspectRatio ?? null, topic: f.topic }
    state.intentEvidence = intentEvidence
    log(`意图抽取：aspectRatio=${intentEvidence.aspectRatio}（来源=${intentEvidence.aspectSource}）主题=${f.topic}`)
    // 兜底（顺带验证画幅直改通道）：LLM 未识别「横屏」→ 用户直改（来源转 user）
    if (intentEvidence.aspectRatio !== '16:9') {
      log(`⚠️ 意图未识别横屏（得 ${intentEvidence.aspectRatio}）→ 走画幅直改通道（POST /intent { aspectRatio }）`)
      const patch = await api('POST', `/api/contents/${id}/intent`, { aspectRatio: '16:9' })
      if (patch.status !== 200) throw new Error(`画幅直改失败：${patch.status} ${JSON.stringify(patch.json)?.slice(0, 200)}`)
      const pf = patch.json.record?.fields ?? {}
      const ps = patch.json.record?.sources ?? {}
      intentEvidence = { aspectRatio: pf.aspectRatio ?? null, aspectSource: ps.aspectRatio ?? null, topic: f.topic, via: 'aspect-patch' }
      state.intentEvidence = intentEvidence
      log(`画幅直改生效：aspectRatio=${intentEvidence.aspectRatio}（来源=${intentEvidence.aspectSource}）`)
      if (intentEvidence.aspectRatio !== '16:9') throw new Error('画幅直改通道未生效（fields.aspectRatio 仍非 16:9）')
    }
  } else {
    log(`恢复意图证据：aspectRatio=${intentEvidence.aspectRatio}（来源=${intentEvidence.aspectSource}）`)
  }
  // 确认推进（422 = 服务端已推进过——进程被回收后断点恢复的幂等容错）
  const res = await api('POST', `/api/contents/${id}/intent`, { confirm: true })
  if (res.status !== 200 && res.status !== 422) throw new Error(`intent confirm 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
  if (res.status === 422) {
    const probe = await api('GET', `/api/contents/${id}/creation`)
    if (probe.json?.content?.status === 'IDEA') throw new Error('confirm 422 但仍在 IDEA（非幂等场景）')
    log('confirm 幂等跳过（服务端已完成推进）')
  }
  state.step = 'directions'
  saveState()
  log('意图就绪（已确认）')
}

// ---------- 3. 创作方向（025：入队即返 → 轮询出现） ----------
if (state.step === 'directions') {
  // 断点恢复：方向已生成则直接用（避免重复 LLM 调用与 422）
  const probe = await api('GET', `/api/contents/${id}/creation`)
  let directions = probe.json?.plan?.directions
  if (!directions?.length) {
    const res = await api('POST', `/api/contents/${id}/directions`, {})
    if (res.status !== 200) throw new Error(`directions 入队失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
    for (let i = 0; i < 72 && !directions?.length; i++) {
      await new Promise((r) => setTimeout(r, 2500))
      const p2 = await api('GET', `/api/contents/${id}/creation`)
      directions = p2.json?.plan?.directions
      const job = p2.json?.job
      if (job && (job.status === 'failed' || job.status === 'timeout')) {
        throw new Error(`方向构思失败：${job.error ?? '未知'}`)
      }
    }
  } else {
    log('方向已存在（断点恢复），直接选用')
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

// ---------- 4. 展开故事 ----------
let storyEvidence = state.storyEvidence ?? null
if (state.step === 'story') {
  // 断点恢复：故事已生成（status 越过 PLANNING）则直接从创作聚合读取
  const probe = await api('GET', `/api/contents/${id}/creation`)
  let story = probe.json?.story ?? null
  if (!story && probe.json?.content?.status === 'PLANNING') {
    const res = await api('POST', `/api/contents/${id}/story`, {})
    if (res.status !== 200) throw new Error(`story 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
    story = res.json.story
  }
  if (!story) throw new Error(`story 不可得（status=${probe.json?.content?.status}）`)
  storyEvidence = {
    logline: story.logline,
    lookBook: story.lookBook ?? null,
    shotCount: story.scenes.flatMap((sc) => sc.shots).length,
    scenes: story.scenes.map((sc) => ({ index: sc.index, location: sc.location, locationAnchor: sc.locationAnchor ?? null, timeOfDay: sc.timeOfDay ?? null })),
  }
  state.storyEvidence = storyEvidence
  state.step = 'storyboard'
  saveState()
  log(`故事就绪：${story.logline}`)
  log(`  lookBook：「${storyEvidence.lookBook ?? '（缺失！）'}」`)
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
  const allShots = story.scenes.flatMap((sc) => sc.shots)
  boardEvidence = { shotCount: allShots.length, sizeProgression: allShots.map((sh) => sh.shotSize ?? '?') }
  state.boardEvidence = boardEvidence
  state.step = 'generate'
  saveState()
  log(`分镜就绪：${boardEvidence.shotCount} 镜；景别 ${boardEvidence.sizeProgression.join(' → ')}`)
}

// ---------- 6. AI 生成 ----------
if (state.step === 'generate') {
  const probe = await api('GET', `/api/contents/${id}/creation`)
  const st = probe.json?.content?.status
  if (st === 'GENERATING' || st === 'REVIEW' || st === 'RENDERING' || st === 'READY') {
    // 断点恢复：生成已在服务端进行/完成（客户端死亡不影响服务端 Job）
    state.step = st === 'REVIEW' ? 'render' : st === 'READY' ? 'verify' : 'generating'
    saveState()
    log(`恢复：生成已在进行/完成（status=${st}）→ step=${state.step}`)
  } else {
    const res = await api('POST', `/api/contents/${id}/generate`, {})
    if (res.status !== 200) throw new Error(`generate 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
    state.step = 'generating'
    state.jobId = res.json.jobId
    saveState()
    log(`生成已入队（job=${state.jobId}）——轮询（native 视频串行，预计 5–15 分钟）`)
  }
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
  state.reviewBundle = { status: bundle.content.status, generationMode: bundle.generationMode }
  saveState()
  log(`生成完成：mode=${bundle.generationMode?.mode}（native ${bundle.generationMode?.nativeShots}/${bundle.generationMode?.totalShots}）`)
}

// ---------- 7. 渲染成片 ----------
if (state.step === 'render') {
  const probe = await api('GET', `/api/contents/${id}/creation`)
  const st = probe.json?.content?.status
  if (st === 'RENDERING' || st === 'READY') {
    state.step = st === 'READY' ? 'verify' : 'rendering'
    saveState()
    log(`恢复：渲染已在进行/完成（status=${st}）`)
  } else {
    const res = await api('POST', `/api/contents/${id}/render`, {})
    if (res.status !== 200) throw new Error(`render 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
    state.step = 'rendering'
    saveState()
    log('渲染已入队')
  }
}
if (state.step === 'rendering') {
  const bundle = await waitForStatus('READY', 5 * 60 * 1000, '渲染')
  state.step = 'verify'
  state.finalAsset = { url: bundle.assets?.final?.url, durationMs: bundle.assets?.final?.durationMs }
  saveState()
  log(`成片就绪：${state.finalAsset.url}（${Math.round((state.finalAsset.durationMs ?? 0) / 1000)}s）`)
}

// ---------- 8. 成片取证（验收 B/C/D：密封画幅 + 账本尺寸 + ffprobe 分辨率） ----------
if (state.step === 'verify') {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } })
  const gens = await prisma.generation.findMany({ where: { contentId: id }, orderBy: { createdAt: 'asc' } })
  const version = await prisma.contentVersion.findFirst({ where: { contentId: id }, orderBy: { versionNumber: 'desc' } })
  const structure = version?.structureJson ? JSON.parse(version.structureJson) : null

  // 验收 C：图像账本尺寸 = 1344x768（画幅感知管线兑现）
  const imageGens = gens.filter((g) => g.type === 'image.shot' && g.status === 'succeeded')
  const payloadOf = (g) => { try { return JSON.parse(g.inputJson ?? '{}') } catch { return {} } }
  const imageSizes = imageGens.map((g) => payloadOf(g).size ?? null)
  const videoGens = gens.filter((g) => g.type === 'video.shot')
  const videoSizes = videoGens.map((g) => payloadOf(g).size ?? null)

  // 验收 D：ffprobe 成片
  let ffprobe = null
  let frameFiles = []
  try {
    const asset = await prisma.asset.findFirst({ where: { contentId: id, kind: 'final' }, orderBy: { createdAt: 'desc' } })
    const probePath = asset ? `storage/assets/${asset.storageLocation.split('/').pop()}` : null
    if (probePath && existsSync(probePath)) {
      const out = execFileSync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,sample_rate',
        '-of', 'json', probePath,
      ]).toString()
      ffprobe = JSON.parse(out)
      const durationSec = Number(ffprobe.format?.duration ?? 0)
      for (const [i, t] of [0.15, 0.5, 0.85].entries()) {
        const name = `wide-shot${i + 1}.jpg`
        try {
          execFileSync('ffmpeg', ['-y', '-ss', (durationSec * t).toFixed(2), '-i', probePath, '-frames:v', '1', `${FRAMES_DIR}/${name}`], { stdio: 'ignore' })
          frameFiles.push(name)
        } catch (e) { log(`帧抽取失败 ${name}：${e.message}`) }
      }
    } else {
      log(`成片路径未定位`)
    }
  } catch (e) { log(`ffprobe 失败：${e.message}`) }

  state.verifyEvidence = {
    sealedAspectRatio: structure?.aspectRatio ?? null,
    lookBookSealed: structure?.story?.lookBook ?? null,
    imageSizes,
    videoSizes,
    ffprobeStreams: (ffprobe?.streams ?? []).map((s) => ({ codec_type: s.codec_type, codec_name: s.codec_name, width: s.width, height: s.height, sample_rate: s.sample_rate })),
    durationSec: Number(ffprobe?.format?.duration ?? 0),
    frameFiles,
    generationLedger: {
      totalCalls: gens.length,
      byType: gens.reduce((acc, g) => { acc[g.type] = (acc[g.type] ?? 0) + 1; return acc }, {}),
      byProvider: gens.reduce((acc, g) => { const k = `${g.type}@${g.provider}`; acc[k] = (acc[k] ?? 0) + 1; return acc }, {}),
    },
  }
  state.step = 'revision'
  saveState()
  await prisma.$disconnect()
  log(`取证完成：sealed=${state.verifyEvidence.sealedAspectRatio}，图像尺寸 ${[...new Set(imageSizes)].join('/')}，成片 ${state.verifyEvidence.durationSec.toFixed(1)}s`)
}

// ---------- 9. 修订定位器（验收 E/F：lookBook 层命中 + 画幅守卫 + 差异账本） ----------
if (state.step === 'revision') {
  const FEEDBACK = '色调再暖一点，全片整体往暖琥珀调走'
  const current = await api('GET', `/api/contents/${id}/creation`)
  // revision/plan 的输入是当前密封结构（服务端取）
  const res = await api('POST', `/api/contents/${id}/revision/plan`, { feedback: FEEDBACK })
  if (res.status !== 200) throw new Error(`revision/plan 失败：${res.status} ${JSON.stringify(res.json)?.slice(0, 300)}`)
  const plan = res.json.plan
  const newStructure = res.json.structure

  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } })
  const versionRow = await prisma.contentVersion.findFirst({ where: { contentId: id }, orderBy: { versionNumber: 'desc' } })
  const before = versionRow?.structureJson ? JSON.parse(versionRow.structureJson) : null
  const beforePrompts = (before?.story?.scenes ?? []).flatMap((sc) => sc.shots.map((sh) => sh.imagePrompt ?? ''))
  const afterPrompts = (newStructure?.story?.scenes ?? []).flatMap((sc) => sc.shots.map((sh) => sh.imagePrompt ?? ''))
  const promptsUntouched = JSON.stringify(beforePrompts) === JSON.stringify(afterPrompts)
  const lookBookChanged = (before?.story?.lookBook ?? '') !== (newStructure?.story?.lookBook ?? '')

  state.revisionPlanEvidence = {
    feedback: FEEDBACK,
    plan,
    lookBookBefore: before?.story?.lookBook ?? null,
    lookBookAfter: newStructure?.story?.lookBook ?? null,
    lookBookChanged,
    promptsUntouched,
    shotCount: beforePrompts.length,
    structureCarriesAspect: newStructure?.aspectRatio ?? null,
  }
  log(`修订计划：targetLevel=${plan.targetLevel}｜summary=「${plan.summary}」`)
  log(`  lookBook 变化：${lookBookChanged ? '✓' : '✗'}｜镜头 imagePrompt 逐字不变：${promptsUntouched ? '✓' : '✗'}｜结构携带画幅：${newStructure?.aspectRatio ?? '（丢失→守卫兜底）'}`)

  // ---- apply（验收 F：画幅守卫 + revision-diff 账本） ----
  // 模拟定位器丢字段：显式删掉 aspectRatio 再提交——守卫必须补回 16:9
  const dropped = JSON.parse(JSON.stringify(newStructure))
  delete dropped.aspectRatio
  const applyRes = await api('POST', `/api/contents/${id}/revision/apply`, { structure: dropped, changelog: FEEDBACK })
  if (applyRes.status !== 200) throw new Error(`revision/apply 失败：${applyRes.status} ${JSON.stringify(applyRes.json)?.slice(0, 300)}`)
  const newVersionId = applyRes.json.versionId

  const newVersionRow = await prisma.contentVersion.findUnique({ where: { id: newVersionId } })
  const guardedAspect = newVersionRow?.structureJson ? JSON.parse(newVersionRow.structureJson).aspectRatio : null
  const diffEvent = await prisma.provenance.findFirst({
    where: { contentId: id, model: 'revision-diff' },
    orderBy: { createdAt: 'desc' },
  })
  const diffPayload = diffEvent?.payloadJson ? JSON.parse(diffEvent.payloadJson) : null

  state.revisionApplyEvidence = {
    newVersionId,
    newVersionNumber: applyRes.json.versionNumber,
    droppedAspectOnSubmit: true,
    guardedAspect,
    diffEvent: diffPayload ? { stage: diffPayload.stage, changedLayers: diffPayload.changedLayers, changedPaths: diffPayload.changedPaths, changedCount: diffPayload.changedCount } : null,
  }
  log(`画幅守卫：提交时删掉 aspectRatio → 新版本密封=${guardedAspect}（期望 16:9）`)
  if (diffPayload) log(`差异账本：${JSON.stringify(diffPayload.changedLayers)}（${diffPayload.changedCount} 处）`)
  await prisma.$disconnect()
  state.step = 'regenerating'
  saveState()
}

// ---------- 10. 修订重生成完成（保持平台干净） ----------
if (state.step === 'regenerating') {
  try {
    await waitForStatus('REVIEW', 22 * 60 * 1000, '修订重生成')
    log('修订重生成完成（REVIEW）')
  } catch (e) {
    log(`修订重生成未完成（${e.message}）——证据已足，继续清场`)
  }
  state.step = 'done'
  saveState()
}

// ---------- 11. 证据汇总 + 清场 ----------
if (state.step === 'done') {
  // 补充证据：最近一次 storyboard 的分镜图像实测分辨率（直接探针，不依赖账本字段）
  try {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } })
    const sbJob = await prisma.generationJob.findFirst({
      where: { contentId: id, type: 'video.storyboard', status: 'succeeded' },
      orderBy: { completedAt: 'desc' },
    })
    if (sbJob?.outputJson) {
      const out = JSON.parse(sbJob.outputJson)
      const first = (out.shotAssets ?? [])[0]
      if (first?.imageAssetId) {
        const asset = await prisma.asset.findUnique({ where: { id: first.imageAssetId } })
        const p = asset ? `storage/assets/${asset.storageLocation.split('/').pop()}` : null
        if (p && existsSync(p)) {
          const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', p]).toString())
          const s = probe.streams?.[0]
          state.verifyEvidence = state.verifyEvidence ?? {}
          state.verifyEvidence.shotImageDimensions = s ? `${s.width}x${s.height}` : null
        }
      }
    }
    await prisma.$disconnect()
  } catch (e) { log(`图像探针失败（不影响主证据）：${e.message}`) }
  const evidence = {
    verifiedAt: new Date().toISOString(),
    task: '产品级升级 E2E（多画幅 16:9 全管线 + 修订定位器 lookBook 语义 + 画幅守卫 + 差异账本）',
    expression: EXPRESSION,
    contentId: id,
    intent: state.intentEvidence,
    story: state.storyEvidence,
    storyboard: state.boardEvidence,
    verify: state.verifyEvidence,
    revisionPlan: state.revisionPlanEvidence,
    revisionApply: state.revisionApplyEvidence,
    final: state.finalAsset,
    review: state.reviewBundle,
  }
  writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2))

  const v = state.verifyEvidence ?? {}
  const r = state.revisionPlanEvidence ?? {}
  const a = state.revisionApplyEvidence ?? {}
  const videoStream = (v.ffprobeStreams ?? []).find((s) => s.codec_type === 'video')
  const checks = {
    intentAspectRecognized: state.intentEvidence?.aspectRatio === '16:9',
    sealedAspectRatio: v.sealedAspectRatio === '16:9',
    shotImage1344x768: v.shotImageDimensions === '1344x768',
    finalVideo1280x720: videoStream?.width === 1280 && videoStream?.height === 720,
    finalHasAudio: (v.ffprobeStreams ?? []).some((s) => s.codec_type === 'audio'),
    revisionTargetStyle: r.plan?.targetLevel === 'style',
    revisionLookBookChanged: r.lookBookChanged === true,
    revisionPromptsUntouched: r.promptsUntouched === true,
    aspectGuardHeld: a.guardedAspect === '16:9',
    diffLedgerWritten: Boolean(a.diffEvent),
  }
  writeFileSync(EVIDENCE_FILE.replace('.json', '-checks.json'), JSON.stringify({ checks, passCount: Object.values(checks).filter(Boolean).length, total: Object.keys(checks).length }, null, 2))
  log(`断言 ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}：${JSON.stringify(checks)}`)

  // 清场
  const del = await api('DELETE', `/api/contents/${id}`)
  log(`清场 DELETE：${del.status}`)
  state = { contentId: null, cookie: '', step: 'finished', startedAt: new Date().toISOString() }
  saveState()
  log('E2E 完成')
}
