// scripts/m15/recover-g3-v4.mjs —— Gate 3 修订 3（v4 童年镜头）失败恢复
// 背景（真实记录）：2026-10-06T16:24:06 修订 3「第二个镜头换成童年」apply 成功创建 v4，
// 但其 storyboard Job 于 16:26:26 失败——z-ai TTS 二次进入 429 冷却
//（[ModelRouter] 能力 audio.tts 的全部候选 Provider 失败：zai-tts 429）。
// 内容状态机按 §51 原地留在 GENERATING（不丢用户工作），修订链脚本 applyRevisionStep
// 在 waitForStatus(REVIEW) 处崩溃，revisions[] 只记账到 v3。
// 恢复：regenerate（API 接受 GENERATING 态，同 v4 版本换新 Job）→ REVIEW → render → READY，
// 然后把修订 3 记账补齐（diff 从 DB v3/v4 密封结构重建，plan 细节随崩溃丢失，如实标注）。
import { Client, waitForStatus, loadState, saveState, diffStructures, summarizeStructure } from './lib.mjs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const CASE_ID = 'g3-father'
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

async function main() {
  const state = loadState(CASE_ID)
  const contentId = state.contentId
  console.log(`[${ts()}] 恢复 g3-father（contentId=${contentId}，state.revisions=${state.revisions?.length ?? 0}）`)

  const client = new Client('g3-father')
  client.restore(state.cookies)

  // ---- 1) 探测僵死态 ----
  const probe = await client.get(`/api/contents/${contentId}/creation`)
  console.log(`[${ts()}] 当前状态：content=${probe.content?.status} job=${probe.job ? probe.job.type + '/' + probe.job.status : 'null'}`)
  if (probe.content?.status !== 'GENERATING') {
    console.log(`[${ts()}] 内容不在 GENERATING（可能已恢复过），退出——幂等保护`)
    await db.$disconnect()
    return
  }
  if (probe.job) {
    console.log(`[${ts()}] 有活跃 Job 在跑（${probe.job.type}），等待其自然结束再人工重跑本脚本`)
    await db.$disconnect()
    process.exit(2)
  }

  // ---- 2) v4 结构与 v3 结构（DB 权威源） ----
  const content = await db.content.findUnique({ where: { id: contentId }, select: { currentVersionId: true } })
  const v4 = await db.contentVersion.findUnique({ where: { id: content.currentVersionId } })
  const v3 = await db.contentVersion.findFirst({
    where: { contentId, versionNumber: (v4.versionNumber ?? 1) - 1 },
  })
  console.log(`[${ts()}] 当前版本：v${v4.versionNumber}「${v4.changelog}」（创建于 ${v4.createdAt.toISOString()}）`)
  const structureAfter = v4.structureJson ? JSON.parse(v4.structureJson) : {}
  const structureBefore = v3?.structureJson ? JSON.parse(v3.structureJson) : {}

  // ---- 3) regenerate 同版本重跑 → REVIEW ----
  const t0 = Date.now()
  const reg = await client.post(`/api/contents/${contentId}/regenerate`, {})
  console.log(`[${ts()}] regenerate 重入：jobId=${reg.jobId}（同 v${reg.versionNumber} 版本）`)
  const reviewData = await waitForStatus(client, contentId, 'REVIEW', { timeoutMs: 900_000 })
  console.log(`[${ts()}] ✓ 生成完成 → REVIEW（${((Date.now() - t0) / 1000).toFixed(0)}s）`)

  // ---- 4) render → READY ----
  await client.post(`/api/contents/${contentId}/render`, {})
  const doneData = await waitForStatus(client, contentId, 'READY', { timeoutMs: 420_000 })
  console.log(`[${ts()}] ✓ 渲染完成 → READY（成片 ${doneData.assets?.final?.durationMs ?? '?'}ms）`)

  // ---- 5) 修订 3 记账补齐（真实标注：恢复模式，plan 细节随崩溃丢失） ----
  const entry = {
    feedback: '第二个镜头换成童年。',
    plan: {
      targetLevel: '(崩溃丢失：plan 结果未落盘，apply 成功证明定位为 shot 级)',
      summary: '镜头 2 替换为童年场景（v4 密封结构 diff 重建）',
      reason: 'v4 changelog：镜头 2 替换为童年场景',
      affectedShotIndexes: null,
      changeKind: null,
    },
    version: { versionId: v4.id, versionNumber: v4.versionNumber },
    changelog: v4.changelog,
    elapsedMs: null,
    final: doneData.assets?.final ?? null,
    structureSummary: summarizeStructure(structureAfter),
    diff: diffStructures(structureBefore, structureAfter),
    recovery: {
      mode: 'post-crash regenerate（同版本新 Job）',
      originalApplyAt: v4.createdAt.toISOString(),
      originalJobFailedAt: '2026-10-06T16:26:26.474Z',
      originalJobError: '[ModelRouter] 能力 audio.tts 的全部候选 Provider 失败：zai-tts(API request failed with status 429)',
      recoveredAt: new Date().toISOString(),
      recoveryElapsedMs: Date.now() - t0,
    },
  }
  state.revisions = state.revisions ?? []
  state.revisions.push(entry)
  state.phase = 'ready'
  saveState(CASE_ID, state)
  console.log(`[${ts()}] 修订 3 记账补齐（revisions=${state.revisions.length}）——diff 改动 ${entry.diff.changedShotCount}/${entry.diff.shotCount.after} 镜`)

  await db.$disconnect()
  console.log(`[${ts()}] g3-father 恢复完成，修订链可从修订 4（结尾不要煽情）续跑`)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
