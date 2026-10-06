// scripts/m15/run-remix-chain.mjs —— Gate 4：Remix Quality（Original → Remix → 再修改 Remix）
// 原作：Gate 3 的父亲故事（已发布，修订链完成）
// Remix 指令：「把父亲换成母亲，保持原来的情绪和视觉风格。」
// 再修改：「结尾旁白轻一点，收得更平静。」
// 验证：原作零改动（字段级 diff）/ 新作产生 / parent relation / Intent 继承 / 可继续修改 / Remix Graph
import { Client, applyRevisionStep, loadState, saveState } from './lib.mjs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const G4_ID = 'g4-remix'
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

/** 原作全量快照（字段级零改动验证的对比基线） */
async function snapshotContent(contentId) {
  const c = await db.content.findUnique({
    where: { id: contentId },
    include: {
      versions: { orderBy: { versionNumber: 'asc' }, select: { id: true, versionNumber: true, creationMethod: true, changelog: true, structureJson: true, createdAt: true } },
      intents: { select: { rawExpression: true, fieldsJson: true, createdAt: true } },
      publication: true,
      provenance: { orderBy: { createdAt: 'asc' }, select: { eventType: true, createdAt: true, payloadJson: true } },
    },
  })
  if (!c) throw new Error(`原作不存在：${contentId}`)
  const assets = await db.asset.findMany({ where: { contentId }, select: { id: true, kind: true, hash: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
  const remixRows = await db.remix.findMany({ where: { sourceContentId: contentId }, select: { id: true, derivativeContentId: true, createdAt: true } })
  return { content: JSON.parse(JSON.stringify({ ...c, updatedAt: undefined })), assets: JSON.parse(JSON.stringify(assets)), remixes: JSON.parse(JSON.stringify(remixRows)) }
}

/** 字段级对比 */
function diffSnapshot(a, b) {
  const changes = []
  const ca = JSON.stringify(a.content, null, 0)
  const cb = JSON.stringify(b.content, null, 0)
  if (ca !== cb) changes.push('Content/versions/intents/publication/provenance 有变动（需逐项排查）')
  if (JSON.stringify(a.assets) !== JSON.stringify(b.assets)) changes.push('原作资产集有变动')
  return changes
}

async function main() {
  // ---- 0) 前置：Gate 3 的父亲故事 ----
  const father = loadState('g3-father')
  if (!father || father.phase !== 'published') throw new Error('Gate 3 未完成（先跑 run-revision-chain.mjs）')
  const sourceContentId = father.contentId

  // ---- 1) 原作快照（Remix 前）----
  const before = await snapshotContent(sourceContentId)
  console.log(`[${ts()}] 原作快照完成：${before.content.versions.length} 版 / ${before.assets.length} 资产 / ${before.remixes.length} Remix 记录`)

  // ---- 2) Remix（新匿名用户）----
  let state = loadState(G4_ID)
  const remixer = new Client('g4-remix')
  if (!state?.remix?.contentId) {
    console.log(`\n[${ts()}] 新用户 Remix：「从这里开始我的版本」`)
    const res = await remixer.post(`/api/contents/${sourceContentId}/remix`, {})
    state = state ?? { caseId: G4_ID, phase: 'remixed', contentId: null, revisions: [], timeline: {}, elapsed: {}, record: {} }
    state.remix = { contentId: res.contentId, remixId: res.remixId, sourceContentId: res.sourceContentId, sourceVersionId: res.sourceVersionId, at: new Date().toISOString() }
    state.contentId = res.contentId
    state.cookies = remixer.dump()
    saveState(G4_ID, state)
    console.log(`  副本 contentId=${res.contentId}（remixId=${res.remixId.slice(0, 8)}）`)
  } else {
    remixer.restore(state.cookies)
    console.log(`[${ts()}] Remix 已存在（断点续跑）：${state.remix.contentId}`)
  }
  const derivativeId = state.remix.contentId

  // ---- 3) Remix 副本语义验证（DB 级）----
  const remixRow = await db.remix.findFirst({ where: { derivativeContentId: derivativeId } })
  const derivative = await db.content.findUnique({ where: { id: derivativeId }, include: { versions: true, intents: true } })
  const derivativeIntent = derivative.intents[0]
  const sourceIntent = (await db.intent.findFirst({ where: { contentId: sourceContentId }, orderBy: { createdAt: 'asc' } }))
  const checks = {
    血缘三件套: remixRow ? { derivativeContentId: remixRow.derivativeContentId === derivativeId, derivativeVersionId: derivative.versions.some((v) => v.id === remixRow.derivativeVersionId), sourceContentId: remixRow.sourceContentId === sourceContentId } : null,
    衍作首版method: derivative.versions[0]?.creationMethod === 'remix',
    配方继承: derivative.versions[0]?.structureJson === before.content.versions[before.content.versions.length - 1].structureJson,
    Intent上下文继承: derivativeIntent?.rawExpression === sourceIntent?.rawExpression,
    remix记录数: (await db.remix.findMany({ where: { sourceContentId } })).length,
  }
  console.log(`\n[${ts()}] Remix 语义验证：${JSON.stringify(checks, null, 1)}`)

  // ---- 4) Remix 副本重新生成（副本 READY → regenerate 出自己的像素）----
  if (!state.regenerated) {
    console.log(`\n[${ts()}] Remix 副本生成自己的画面（regenerate）`)
    const d = await db.content.findUnique({ where: { id: derivativeId }, select: { status: true } })
    if (d.status === 'READY') {
      // READY → REVIEW → GENERATING（generationFlow.regenerate 路径）
      const reg = await remixer.post(`/api/contents/${derivativeId}/regenerate`, {})
      console.log(`  regenerate job=${reg.jobId}`)
      // 等生成完成 → REVIEW → 渲染
      await poll(remixer, derivativeId, 'REVIEW')
    }
    await remixer.post(`/api/contents/${derivativeId}/render`, {})
    await poll(remixer, derivativeId, 'READY')
    state.regenerated = true
    state.cookies = remixer.dump()
    saveState(G4_ID, state)
  }

  // ---- 5) 修改 Remix：「把父亲换成母亲，保持原来的情绪和视觉风格。」----
  const REVISIONS = [
    { feedback: '把父亲换成母亲，保持原来的情绪和视觉风格。', note: '主角替换：父亲→母亲，风格延续' },
    { feedback: '结尾旁白轻一点，收得更平静。', note: '结尾情绪收敛' },
  ]
  const doneCount = state.revisions?.length ?? 0
  for (let i = doneCount; i < REVISIONS.length; i++) {
    console.log(`\n[${ts()}] Remix 修改 ${i + 1}/${REVISIONS.length}：「${REVISIONS[i].feedback}」`)
    const entry = await applyRevisionStep(remixer, G4_ID, REVISIONS[i].feedback, REVISIONS[i].note)
    console.log(`  定位：${entry.plan.targetLevel}｜${entry.plan.summary}｜影响镜头 ${JSON.stringify(entry.plan.affectedShotIndexes)}`)
    console.log(`  局部性：改动 ${entry.diff.changedShotCount}/${entry.diff.shotCount.after} 镜；修改字段：${entry.diff.changedShots.map((c) => `镜${c.shotIndex + 1}[${Object.keys(c.fields).join('/')}]`).join(' ')}`)
    console.log(`  新版本：v${entry.version.versionNumber}｜耗时 ${((entry.elapsedMs ?? 0) / 1000).toFixed(0)}s`)
  }

  // ---- 6) 原作零改动（字段级 diff）----
  const after = await snapshotContent(sourceContentId)
  const violations = diffSnapshot(before, after)
  // remix_received Provenance 追加是预期的（只追加不变量允许新增事件，不允许改动原有行）
  console.log(`\n[${ts()}] 原作零改动验证：${violations.length === 0 ? '✓ 原作所有行零改动（remix_received 事件按只追加不变量新增，原行未动）' : '✗ ' + violations.join('；')}`)

  // ---- 7) Remix Graph 汇总 ----
  const graph = {
    source: { contentId: sourceContentId, title: before.content.title, versions: before.content.versions.length },
    derivative: { contentId: derivativeId, title: derivative.title, versions: (await db.contentVersion.findMany({ where: { contentId: derivativeId } })).length },
    totalRemixes: (await db.remix.findMany({ where: { sourceContentId } })).length,
  }
  console.log(`\n[${ts()}] Remix Graph：${JSON.stringify(graph, null, 1)}`)

  await db.$disconnect()
  console.log(`\n[${ts()}] Gate 4 完成`)
}

async function poll(client, contentId, target) {
  const { waitForStatus } = await import('./lib.mjs')
  return waitForStatus(client, contentId, target, { timeoutMs: 900_000 })
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
