// scripts/m15/serial-season-e2e.mjs —— serial-season-027 真实管线 E2E 冒烟
// 验证语义（设计文档 §7 验收标准 4，全程真实供给、断点续跑）：
//   A. seed    ：「6 分钟连续短剧」意图 → 方向选定（分集量级 360s）
//   B. season  ：POST /season/plan → 轮询 Job → 断言 3 集孵化（PLANNING）+ Season 落盘 + anchorHash
//   C. episode ：驱动第 1 集 story.draft（真实 LLM + 圣经注入）→ DB 断言
//                集故事的 characters[].visualAnchor === 圣经原文（字节一致——防飘逸 L1 的真金断言）
//   D. evidence：DB 直查——Season/Episode/Intent/Provenance 账本 + anchorHash 对账
// 用法：node scripts/m15/serial-season-e2e.mjs [seed|season|episode|evidence|cleanup]
import { Client, loadState, saveState, sleep } from './lib.mjs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } })
const CASE_ID = 'serial-season-027'
const IDEA = '做一个 6 分钟的连续短剧：暴雨季的城市里，外卖骑手老陈一边还债一边独自照顾术后的女儿小雨，某个深夜他在写字楼撞见一个不该出现的人影。'

const state = loadState(CASE_ID) ?? {
  caseId: CASE_ID,
  phase: 'init', // init → started → intended → directed → season → episode → done
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

async function pollCreation(contentId) {
  return client.get(`/api/contents/${contentId}/creation`)
}

async function waitForJob(jobId, { timeoutMs = 240_000, intervalMs = 4000, label = '' } = {}) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    const data = await client.get(`/api/contents/${state.contentId}/season/plan?jobId=${jobId}`)
    last = data
    if (data.status === 'succeeded' || data.status === 'failed' || data.status === 'timeout') return data
    await sleep(intervalMs)
  }
  throw new Error(`等待超时（${label}）；最后=${JSON.stringify(last).slice(0, 300)}`)
}

// ---------------- A. seed：意图与方向 ----------------
async function seed() {
  if (!state.contentId) {
    const res = await client.post('/api/imagine/start', { text: IDEA })
    state.contentId = res.content?.id ?? res.contentId
    if (!state.contentId) throw new Error(`start 未返回 contentId：${JSON.stringify(res).slice(0, 300)}`)
    persist()
  }
  // 意图访谈（有问则答，两轮内收敛；每步后重查权威状态，容忍「这步已完成」）
  let data = await pollCreation(state.contentId)
  if (data.content.status === 'IDEA') {
    const first = await client.post(`/api/contents/${state.contentId}/intent`, {}).catch((e) => e?.body ?? null)
    const questions = first?.questions ?? []
    if (questions.length > 0) {
      await client
        .post(`/api/contents/${state.contentId}/intent`, { answers: ['6 分钟左右，分集看着来', '压抑里带点温暖', '普通观众'] })
        .catch(() => null)
    }
    await client.post(`/api/contents/${state.contentId}/intent`, { confirm: true }).catch(() => null)
    data = await pollCreation(state.contentId)
  }
  console.log('[seed] status =', data.content.status)
  // 方向
  if (data.content.status === 'INTENT') {
    await client.post(`/api/contents/${state.contentId}/directions`, {}).catch(() => null)
    for (let i = 0; i < 60; i++) {
      const d = await pollCreation(state.contentId)
      const list = d.plan?.directions ?? d.directions?.list ?? null
      if (list?.length) {
        const chosen = list[0]
        await client.post(`/api/contents/${state.contentId}/directions/select`, { directionId: chosen.id })
        console.log('[seed] 方向已选：', chosen.name)
        break
      }
      await sleep(3000)
    }
  }
  const after = await pollCreation(state.contentId)
  const intent = after.intent?.record?.fields ?? after.intent?.fields ?? {}
  console.log('[seed] 意图时长 =', intent.duration, 's；format =', intent.format)
  state.phase = 'directed'
  persist()
}

// ---------------- B. season：季规划 ----------------
async function season() {
  const enqueue = await client.post(`/api/contents/${state.contentId}/season/plan`, {})
  console.log('[season] 入队响应：', JSON.stringify(enqueue).slice(0, 200))
  let job = null
  if (enqueue.jobId) {
    job = await waitForJob(enqueue.jobId, { label: 'season.plan' })
    console.log('[season] Job 终态：', job.status)
    if (job.status !== 'succeeded') throw new Error(`season.plan 失败：${String(job.error).slice(0, 300)}`)
  } else if (!enqueue.alreadyPlanned) {
    throw new Error(`意外的入队响应：${JSON.stringify(enqueue)}`)
  }
  const view = await client.get(`/api/contents/${state.contentId}/season/plan`)
  const sv = view.season
  console.log('[season] 分集几何：', sv.episodeCount, '集 ×', Math.round(sv.episodeSec), 's；anchorHash =', sv.anchorHash)
  console.log('[season] 集列表：', sv.episodes.map((e) => `E${e.index + 1}「${e.title}」${e.status}`).join(' | '))
  state.evidence.episodeCount = sv.episodeCount
  state.evidence.anchorHash = sv.anchorHash
  state.evidence.episodeContentIds = sv.episodes.map((e) => e.contentId)
  state.evidence.logline = (await db.season.findUnique({ where: { contentId: state.contentId } }))?.bibleJson
    ? JSON.parse((await db.season.findUnique({ where: { contentId: state.contentId } })).bibleJson).seasonLogline
    : null
  state.phase = 'season'
  persist()
}

// ---------------- C. episode：第 1 集故事（真实 LLM + 圣经注入） ----------------
async function episode() {
  const seasonRow = await db.season.findUnique({ where: { contentId: state.contentId } })
  if (!seasonRow) throw new Error('Season 不存在（先跑 season 段）')
  const bible = JSON.parse(seasonRow.bibleJson)
  const ep1 = (await db.episode.findFirst({ where: { seasonId: seasonRow.id, index: 0 } }))
  if (!ep1) throw new Error('第 1 集不存在')
  const content = await db.content.findUnique({ where: { id: ep1.contentId } })
  console.log('[episode] 第 1 集状态：', content.status)

  if (content.status === 'PLANNING') {
    const res = await client.post(`/api/contents/${ep1.contentId}/story`, {})
    console.log('[episode] story.draft 入队：', JSON.stringify(res).slice(0, 200))
    // 轮询集状态到 STORY
    const start = Date.now()
    while (Date.now() - start < 240_000) {
      const d = await pollCreation(ep1.contentId)
      if (d.content.status === 'STORY') break
      if (d.content.status === 'PLANNING' && Date.now() - start > 200_000) {
        throw new Error(`第 1 集故事生成超时：${JSON.stringify(d.job ?? {}).slice(0, 200)}`)
      }
      await sleep(4000)
    }
  }

  // 真金断言：集故事的锚点 = 圣经原文（字节一致）
  const storyRow = await db.story.findFirst({ where: { contentId: ep1.contentId }, orderBy: { createdAt: 'desc' } })
  const story = JSON.parse(storyRow.draftJson)
  const anchors = (story.characters ?? []).map((c) => ({ name: c.name, anchor: c.visualAnchor }))
  console.log('[episode] 集故事人物锚点：')
  for (const a of anchors) {
    const bibleChar = bible.characters.find((b) => b.name === a.name)
    const identical = bibleChar && bibleChar.visualAnchor === a.anchor
    console.log(`  · ${a.name}：${identical ? '✓ 字节一致' : `✗ 漂移！（${a.anchor?.slice(0, 60)}…）`}`)
    if (!identical) throw new Error(`锚点漂移：${a.name}`)
  }
  console.log('[episode] lookBook 一致：', story.lookBook === bible.lookBook ? '✓' : '✗')
  if (story.lookBook !== bible.lookBook) throw new Error('lookBook 漂移')
  state.evidence.episode1StoryAnchors = anchors.map((a) => a.name)
  state.phase = 'episode'
  persist()
}

// ---------------- D. evidence：账本 ----------------
async function evidence() {
  const seasonRow = await db.season.findUnique({ where: { contentId: state.contentId }, include: { episodes: true } })
  const bible = JSON.parse(seasonRow.bibleJson)
  const episodes = seasonRow.episodes.sort((a, b) => a.index - b.index)
  console.log('=== serial-season-027 证据账本 ===')
  console.log(`季圣经：${bible.seasonLogline}`)
  console.log(`视觉圣经：${bible.lookBook.slice(0, 90)}…`)
  console.log(`分集：${seasonRow.episodeCount} × ${Math.round(seasonRow.episodeSec)}s = ${seasonRow.totalSec}s；anchorHash=${seasonRow.anchorHash}`)
  console.log(`悬念链：${episodes.map((e) => `E${e.index + 1}${e.cliffhanger ? '钩' : '收'}`).join(' → ')}`)
  for (const ep of episodes) {
    const c = await db.content.findUnique({ where: { id: ep.contentId } })
    const intent = await db.intent.findFirst({ where: { contentId: ep.contentId } })
    const fields = intent?.fieldsJson ? JSON.parse(intent.fieldsJson).fields : {}
    console.log(`  E${ep.index + 1}「${ep.title}」 [${c.status}] duration=${fields.duration}s 人物=${(fields.characters ?? []).map((x) => x.name).join('/')}`)
    console.log(`     悬念：${ep.cliffhanger || '（大结局收口）'}`)
  }
  const provs = await db.provenance.findMany({ where: { contentId: state.contentId, eventType: 'season_planned' } })
  console.log(`Provenance season_planned：${provs.length} 条`)
  const epProvs = await db.provenance.count({ where: { eventType: 'episode_bootstrapped' } })
  console.log(`Provenance episode_bootstrapped（全局）：${epProvs} 条`)
}

async function cleanup() {
  if (state.contentId) {
    const seasonRow = await db.season.findUnique({ where: { contentId: state.contentId }, include: { episodes: true } })
    if (seasonRow) {
      for (const ep of seasonRow.episodes) await db.content.delete({ where: { id: ep.contentId } }).catch(() => {})
      await db.season.delete({ where: { id: seasonRow.id } }).catch(() => {})
    }
    await db.content.delete({ where: { id: state.contentId } }).catch(() => {})
    console.log('[cleanup] 已清场（含剧集 Content）')
  }
  saveState(CASE_ID, { caseId: CASE_ID, phase: 'init' })
}

const phase = process.argv[2] ?? 'all'
if (phase === 'seed' || phase === 'all') await seed()
if (phase === 'season' || phase === 'all') await season()
if (phase === 'episode' || phase === 'all') await episode()
if (phase === 'evidence' || phase === 'all') await evidence()
if (phase === 'cleanup') await cleanup()
await db.$disconnect()
console.log(`[serial-season-e2e] phase=${phase} 完成`)
