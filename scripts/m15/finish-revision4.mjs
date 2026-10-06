// scripts/m15/finish-revision4.mjs —— 修订 4（v5 结尾收敛情绪）收尾
// 背景（真实记录）：2026-10-06T20:52 编排器进程树被外部 SIGKILL 击杀（无 FATAL 输出），
// 时点在 v5 生成完成（20:52:41 REVIEW）之后、render POST 之前——v5 无 render Job。
// 本脚本：render → READY → 修订 4 记账（diff v4→v5 重建，plan 细节随击杀丢失如实标注）
//        → 发布 → state.phase=published（Gate 4 / Native Golden 前置）。
import { Client, waitForStatus, loadState, saveState, diffStructures, summarizeStructure } from './lib.mjs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const CASE_ID = 'g3-father'
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

async function main() {
  const state = loadState(CASE_ID)
  const contentId = state.contentId
  console.log(`[${ts()}] 修订 4 收尾（contentId=${contentId}，state.revisions=${state.revisions?.length ?? 0}）`)

  const client = new Client('g3-father')
  client.restore(state.cookies)

  const probe = await client.get(`/api/contents/${contentId}/creation`)
  console.log(`[${ts()}] 当前状态：${probe.content?.status}`)
  if (probe.content?.status === 'PUBLISHED') {
    console.log(`[${ts()}] 已发布——幂等退出`)
    await db.$disconnect()
    return
  }
  if (probe.content?.status !== 'REVIEW' && probe.content?.status !== 'READY') {
    throw new Error(`意外状态：${probe.content?.status}（期望 REVIEW/READY）`)
  }

  // ---- 1) render → READY（若已 READY 则跳过） ----
  let doneData
  if (probe.content?.status === 'REVIEW') {
    const t0 = Date.now()
    await client.post(`/api/contents/${contentId}/render`, {})
    doneData = await waitForStatus(client, contentId, 'READY', { timeoutMs: 420_000 })
    console.log(`[${ts()}] ✓ 渲染完成 → READY（${((Date.now() - t0) / 1000).toFixed(0)}s，成片 ${doneData.assets?.final?.durationMs ?? '?'}ms）`)
  } else {
    doneData = probe
    console.log(`[${ts()}] 已 READY（断点续跑）`)
  }

  // ---- 2) 修订 4 记账补齐 ----
  const v5 = await db.contentVersion.findFirst({ where: { contentId, versionNumber: 5 } })
  const v4 = await db.contentVersion.findFirst({ where: { contentId, versionNumber: 4 } })
  const structureAfter = v5.structureJson ? JSON.parse(v5.structureJson) : {}
  const structureBefore = v4?.structureJson ? JSON.parse(v4.structureJson) : {}
  const entry = {
    feedback: '结尾不要煽情。',
    plan: {
      targetLevel: '(编排器被 SIGKILL 击杀，plan 输出未落盘；apply 成功创建 v5 证明修订链有效)',
      summary: '结尾收敛情绪（v5 密封结构 diff 重建）',
      reason: 'v5 changelog：结尾收敛情绪',
      affectedShotIndexes: null,
      changeKind: null,
    },
    version: { versionId: v5.id, versionNumber: v5.versionNumber },
    changelog: v5.changelog,
    elapsedMs: null,
    final: doneData.assets?.final ?? null,
    structureSummary: summarizeStructure(structureAfter),
    diff: diffStructures(structureBefore, structureAfter),
    recovery: {
      mode: 'post-crash render+record（v5 生成已完成，仅补 render/publish/记账）',
      originalApplyAt: v5.createdAt.toISOString(),
      originalGenerationDoneAt: '2026-10-06T20:52:41.425Z',
      orchestratorKilledAt: '~2026-10-06T20:52:4x（无 FATAL 输出，SIGKILL 特征）',
      recoveredAt: new Date().toISOString(),
    },
  }
  state.revisions = state.revisions ?? []
  if (state.revisions.length === 3) {
    state.revisions.push(entry)
    console.log(`[${ts()}] 修订 4 记账补齐（revisions=4）——diff 改动 ${entry.diff.changedShotCount}/${entry.diff.shotCount.after} 镜`)
  } else {
    console.log(`[${ts()}] revisions=${state.revisions.length}（非 3，跳过记账防重复）`)
  }

  // ---- 3) 发布 + state 戳记 ----
  await client.post(`/api/contents/${contentId}/publish`, { visibility: 'public' })
  state.phase = 'published'
  state.timeline = state.timeline ?? {}
  state.timeline.published = new Date().toISOString()
  saveState(CASE_ID, state)
  console.log(`[${ts()}] ✓ Gate 3 四连改完成并发布（v5 最终版）——state.phase → published`)

  await db.$disconnect()
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
