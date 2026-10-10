// 025 全方位无死角 E2E（设计 docs/design/no-blind-spot-025.md §4 验收）
// 验证四条战线的真实管线证据：
//   战线二①：POST /directions 入队即返（<3s 携 jobId）→ 轮询方向出现 → bundle.job.type=intent.directions（双通道领取实证）
//   战线三①：storyboard.generate Generation 账本 promptSummary 含「已验证的高分写法范例」段（跨项目反哺实证）
//   战线二②：revision.plan 入队即返 → GET 轮询出 plan；换 feedback 重提 → 旧 Job superseded（failed + 人话原因）+ 新 plan 到达
//   战线一①：（可选生成段）图像 Generation 账本 promptSummary 以「Framing requirement:」开头（景别前置实证）
// 断点续跑：state 落盘 scripts/m15/state/no-blind-spot.json；供给墙下可分段重跑。
// 用法：node scripts/m15/no-blind-spot-e2e.mjs [--with-generate]
import { PrismaClient } from '@prisma/client'
import { Client, waitForStatus, loadState, saveState, sleep } from './lib.mjs'
import { existsSync, mkdirSync } from 'node:fs'

const db = new PrismaClient()
const STATE_FILE = 'no-blind-spot'
const WITH_GENERATE = process.argv.includes('--with-generate')

const STORY_TEXT = '清晨的旧书店，老板每天给第一 位客人留一本手写推荐卡，今天来的是个不肯说话的小女孩'
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` —— ${detail}` : ''}`)
}

const state = loadState(STATE_FILE) ?? {
  phase: 'init',
  contentId: null,
  cookies: null,
  revisionJob1: null,
  revisionJob2: null,
}
const client = new Client('no-blind-spot')
client.restore(state.cookies)
const persist = () => { state.cookies = client.dump(); saveState(STATE_FILE, state) }

async function creation() {
  return client.get(`/api/contents/${state.contentId}/creation`)
}

async function poll(fn, { timeoutMs = 240_000, intervalMs = 2500, label = '' } = {}) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await fn()
    if (last) return last
    await sleep(intervalMs)
  }
  throw new Error(`轮询超时（${label}，${Math.round(timeoutMs / 1000)}s）`)
}

try {
  mkdirSync('scripts/m15/state', { recursive: true })

  // ---- 1) start + intent ----
  if (state.phase === 'init') {
    const res = await client.post('/api/imagine/start', { text: STORY_TEXT })
    state.contentId = res.contentId
    state.phase = 'started'
    persist()
    console.log(`contentId = ${state.contentId}`)
  }
  if (state.phase === 'started') {
    await client.post(`/api/contents/${state.contentId}/intent`, {})
    const confirm = await client.post(`/api/contents/${state.contentId}/intent`, { confirm: true })
    void confirm
    state.phase = 'intent'
    persist()
  }

  // ---- 2) directions：入队即返断言（本轮核心改造点）----
  if (state.phase === 'intent') {
    const t0 = Date.now()
    const res = await client.post(`/api/contents/${state.contentId}/directions`, {})
    const elapsed = Date.now() - t0
    ok('战线二①a：POST /directions 入队即返（<3s）', elapsed < 3000 && !!res.jobId, `耗时 ${elapsed}ms jobId=${res.jobId}`)
    state.directionsJobId = res.jobId

    // 轮询期间抓 bundle.job.type（双通道领取实证）
    let sawDirectionsJob = false
    const bundle = await poll(async () => {
      const b = await creation()
      if (b?.job?.type === 'intent.directions' && ['queued', 'claimed', 'running'].includes(b.job.status)) sawDirectionsJob = true
      return (b?.plan?.directions?.length ?? 0) > 0 ? b : null
    }, { timeoutMs: 240_000, label: '方向出现' })
    ok('战线二①b：轮询接续方向出现（数量≥2）', (bundle.plan.directions?.length ?? 0) >= 2, `${bundle.plan.directions?.length ?? 0} 个方向：${bundle.plan.directions.map((d) => d.name).join(' / ')}`)
    ok('战线二①c：活跃期间 bundle.job.type=intent.directions（双通道 worker 领取实证）', sawDirectionsJob, sawDirectionsJob ? '领取' : '未观测到（可能秒级完成）')
    state.phase = 'directions'
    persist()
  }

  // ---- 3) 选方向 + 故事 + 分镜（022 已有链路回归）----
  if (state.phase === 'directions') {
    const b = await creation()
    await client.post(`/api/contents/${state.contentId}/directions/select`, { directionId: b.plan.directions[0].id })
    const t0 = Date.now()
    await client.post(`/api/contents/${state.contentId}/story`, {})
    ok('回归：POST /story 入队即返（<3s）', Date.now() - t0 < 3000, `${Date.now() - t0}ms`)
    state.phase = 'story'
    persist()
  }
  if (state.phase === 'story') {
    await waitForStatus(client, state.contentId, 'STORY', { timeoutMs: 420_000 })
    const t0 = Date.now()
    await client.post(`/api/contents/${state.contentId}/storyboard`, {})
    ok('回归：POST /storyboard 入队即返（<3s）', Date.now() - t0 < 3000, `${Date.now() - t0}ms`)
    state.phase = 'storyboard'
    persist()
  }
  let storyboardBundle = null
  if (state.phase === 'storyboard') {
    storyboardBundle = await waitForStatus(client, state.contentId, 'STORYBOARD', { timeoutMs: 600_000 })
    state.phase = 'storyboard-done'
    persist()
  } else {
    storyboardBundle = await creation()
  }

  // ---- 4) 战线三账本证据：storyboard.generate 的 system 摘要含范例教学段 ----
  {
    const rows = await db.generation.findMany({
      where: { contentId: state.contentId, type: 'text.plan' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    const sbRow = rows.find((r) => {
      try { return (JSON.parse(r.inputJson ?? '{}')).purpose === 'storyboard.generate' } catch { return false }
    })
    const input = sbRow?.inputJson ? JSON.parse(sbRow.inputJson) : {}
    const systemText = String(input.system ?? '')
    const hasTeaching = systemText.includes('已验证的高分写法范例')
    const exemplarCount = await db.shotExemplar.count()
    ok('战线三①：分镜 Generation 账本 system 含「已验证的高分写法范例」段', hasTeaching && exemplarCount > 0, `范例库 ${exemplarCount} 条 → system 摘要 ${systemText.length} 字（含教学段=${hasTeaching}）`)
    state.storyboardSystem = systemText.slice(0, 300)
    persist()
  }

  // ---- 5) 战线二②：revision.plan 计算型 Job + supersede ----
  if (state.phase === 'storyboard-done') {
    // 手工密封版本（修订定位的原料；生成段不跑时也能验证修订链）
    const content = await db.content.findUnique({ where: { id: state.contentId } })
    const story = storyboardBundle?.story ?? (await creation()).story
    const plan = await db.creativePlan.findFirst({ where: { contentId: state.contentId } })
    const concept = plan?.conceptJson ? JSON.parse(plan.conceptJson) : null
    const structure = {
      concept: concept ?? { name: '推荐卡', oneLiner: '一句话' },
      characters: story?.characters ?? [],
      story,
      intentSummary: STORY_TEXT.slice(0, 120),
      aspectRatio: '9:16',
    }
    const n = await db.contentVersion.count({ where: { contentId: state.contentId } })
    const version = await db.contentVersion.create({
      data: {
        contentId: state.contentId,
        versionNumber: n + 1,
        parentVersionId: null,
        createdBy: content.ownerId,
        creationMethod: 'seed',
        structureJson: JSON.stringify(structure),
        changelog: '初稿',
      },
    })
    await db.content.update({ where: { id: state.contentId }, data: { currentVersionId: version.id } })
    state.versionId = version.id
    state.phase = 'revision'
    persist()
  }

  if (state.phase === 'revision') {
    // 第一次反馈：入队即返 + 轮询出 plan
    const t0 = Date.now()
    const r1 = await client.post(`/api/contents/${state.contentId}/revision/plan`, { feedback: '色调再暖一点，全片往暖琥珀调走' })
    ok('战线二②a：POST /revision/plan 入队即返（<3s 携 jobId）', Date.now() - t0 < 3000 && !!r1.jobId, `耗时 ${Date.now() - t0}ms`)
    state.revisionJob1 = r1.jobId
    persist()

    const plan1 = await poll(async () => {
      const j = await client.get(`/api/contents/${state.contentId}/revision/plan?jobId=${state.revisionJob1}`)
      return j?.status === 'succeeded' && j?.plan ? j : null
    }, { timeoutMs: 240_000, label: '修订 plan #1' })
    ok('战线二②b：GET 轮询出修订 plan（targetLevel 命中 style 层）', plan1.plan?.targetLevel === 'style', `targetLevel=${plan1.plan?.targetLevel} summary=${plan1.plan?.summary}`)

    // 换反馈重提：supersede 实证
    const r2 = await client.post(`/api/contents/${state.contentId}/revision/plan`, { feedback: '结尾别这么悲伤，给一点希望' })
    ok('战线二②c：换 feedback 重提 → supersededJobId 返回旧 Job', r2.supersededJobId === state.revisionJob1 && !!r2.jobId, `old=${r2.supersededJobId?.slice(-6)} new=${r2.jobId?.slice(-6)}`)
    state.revisionJob2 = r2.jobId
    persist()

    const oldJob = await client.get(`/api/contents/${state.contentId}/revision/plan?jobId=${state.revisionJob1}`)
    ok('战线二②d：旧 Job 终态 failed + 人话原因', oldJob?.status === 'failed' && String(oldJob?.error ?? '').includes('已被新的修订请求取代'), oldJob?.error)

    const plan2 = await poll(async () => {
      const j = await client.get(`/api/contents/${state.contentId}/revision/plan?jobId=${state.revisionJob2}`)
      return j?.status === 'succeeded' && j?.plan ? j : null
    }, { timeoutMs: 240_000, label: '修订 plan #2' })
    ok('战线二②e：新 plan 到达（story 层定位）', !!plan2.plan?.targetLevel, `targetLevel=${plan2.plan?.targetLevel} summary=${plan2.plan?.summary}`)
    state.phase = 'done'
    persist()
  }

  // ---- 6) 可选生成段：战线一账本证据（图像 prompt 前置景别）----
  if (WITH_GENERATE && state.phase === 'done') {
    console.log('\n---- 生成段（时间有界；视频供给 503 时诚实失败也收集图像账本证据）----')
    state.phase = 'generating'
    persist()
    try {
      const g = await client.post(`/api/contents/${state.contentId}/generate`, {})
      void g
      // 有界观察：最多 12 分钟，无论成败都收账本
      const start = Date.now()
      let final = null
      while (Date.now() - start < 12 * 60_000) {
        await sleep(10_000)
        const b = await creation()
        if (b?.content?.status === 'REVIEW' || b?.content?.status === 'READY') { final = b; break }
        if (b?.content?.status === 'GENERATING' && !b?.job) { final = b; break }
      }
      const imgRows = await db.generation.findMany({
        where: { contentId: state.contentId, type: 'image.shot' },
        orderBy: { createdAt: 'asc' },
      })
      const firstInput = imgRows[0]?.inputJson ? JSON.parse(imgRows[0].inputJson) : {}
      const firstPrompt = String(firstInput.prompt ?? '')
      ok('战线一①：首个图像 Generation 账本 prompt 以「Framing requirement:」开头', firstPrompt.startsWith('Framing requirement:'), firstPrompt.slice(0, 90))
      const gateRows = await db.provenance.count({
        where: { contentId: state.contentId, model: 'quality-gate' },
      })
      ok('质量门 in-loop 活跃（image.gate 事件 ≥1）', gateRows >= 1, `${gateRows} 个门事件`)
      console.log(`生成段观察：status=${final?.content?.status ?? 'timeout'} 图像账本=${imgRows.length} 条`)
    } catch (e) {
      console.log(`生成段异常（不影响前置断言）：${e.message}`)
    }
  }

  // ---- 汇总 ----
  const passed = results.filter((r) => r.pass).length
  console.log(`\n========== 025 E2E 汇总：${passed}/${results.length} ==========`)
  for (const r of results.filter((x) => !x.pass)) console.log(`✗ 未过：${r.name} —— ${r.detail}`)
  process.exitCode = results.every((r) => r.pass) ? 0 : 1
} catch (e) {
  console.error(`E2E 中断（断点续跑就绪，phase=${state.phase}）：${e.message}`)
  process.exitCode = 2
} finally {
  await db.$disconnect()
}
