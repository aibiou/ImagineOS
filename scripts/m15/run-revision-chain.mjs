// scripts/m15/run-revision-chain.mjs —— Gate 3：Revision Quality（连续真实修改测试）
// 初始 Intent：「我想做一个关于父亲的故事。」
// 修订序列：再温暖一点 → 父亲不要说话 → 第二个镜头换成童年 → 结尾不要煽情
// 每次验证：理解正确（plan）/ 局部修改（diff）/ 新 Version / 旧 Version 保留 / 修改原因（changelog）
import { Client, driveCase, applyRevisionStep, loadState, saveState, blankState, waitForStatus } from './lib.mjs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const CASE_ID = 'g3-father'
const TEXT = '我想做一个关于父亲的故事。'
const REVISIONS = [
  { feedback: '再温暖一点。', note: '整体情绪调暖' },
  { feedback: '父亲不要说话。', note: '去掉父亲台词，只留画面与环境' },
  { feedback: '第二个镜头换成童年。', note: '镜头 2 替换为童年场景' },
  { feedback: '结尾不要煽情。', note: '结尾收敛情绪' },
]

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

async function main() {
  // ---- 1) 初始创作全链（停在 READY——修订只接受 REVIEW/READY/STORYBOARD，发布后无下线 API）
  const state = loadState(CASE_ID)
  const readyForRevision = state?.phase === 'ready' || state?.phase === 'published'
  if (!readyForRevision) {
    console.log(`[${ts()}] Gate 3：初始创作「${TEXT}」（停在 READY，修订后统一发布）`)
    const client = new Client('g3-father')
    await driveCase(client, CASE_ID, { text: TEXT, description: '一位父亲的安静故事', stopBeforePublish: true })
  } else {
    console.log(`[${ts()}] Gate 3：初始创作已完成（断点续跑）`)
  }
  const fatherState = loadState(CASE_ID)
  const contentId = fatherState.contentId
  console.log(`[${ts()}] 父亲故事 contentId=${contentId} phase=${fatherState.phase}`)

  // 若上一轮已发布（旧逻辑遗留），先记录：修订链将失败——脚本设计已避免，此分支仅防御提示
  const content = await db.content.findUnique({ where: { id: contentId }, select: { status: true } })
  if (content?.status === 'PUBLISHED' && (fatherState.revisions?.length ?? 0) < REVISIONS.length) {
    console.log(`  ⚠ 作品已 PUBLISHED 且修订未完成——Alpha 无下线 API，修订链无法继续（需重置案例）`)
  }

  // ---- 2) 连续修订 ----
  const client = new Client('g3-father')
  client.restore(fatherState.cookies)
  const doneCount = fatherState.revisions?.length ?? 0

  for (let i = doneCount; i < REVISIONS.length; i++) {
    const { feedback, note } = REVISIONS[i]
    console.log(`\n[${ts()}] 修订 ${i + 1}/${REVISIONS.length}：「${feedback}」`)
    const entry = await applyRevisionStep(client, CASE_ID, feedback, note)
    console.log(`  定位：${entry.plan.targetLevel}｜${entry.plan.summary}`)
    console.log(`  原因：${entry.plan.reason}｜影响镜头：${JSON.stringify(entry.plan.affectedShotIndexes)}｜类型：${entry.plan.changeKind}`)
    console.log(`  局部性：改动 ${entry.diff.changedShotCount}/${entry.diff.shotCount.after} 镜（未动 ${entry.diff.unchangedShotCount}）`)
    for (const cs of entry.diff.changedShots) {
      console.log(`    · 镜头 ${cs.shotIndex + 1}：${Object.keys(cs.fields).join(', ')}`)
    }
    console.log(`  新版本：v${entry.version.versionNumber}（changelog：${entry.changelog}）｜耗时 ${((entry.elapsedMs ?? 0) / 1000).toFixed(0)}s`)
  }

  // ---- 3) 版本链完整性 ----
  const versions = await db.contentVersion.findMany({ where: { contentId }, orderBy: { versionNumber: 'asc' } })
  console.log(`\n[${ts()}] 版本链（${versions.length} 版）：`)
  for (const v of versions) {
    console.log(`  v${v.versionNumber}: ${v.creationMethod}「${v.changelog}」${new Date(v.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}`)
  }

  // ---- 4) 最终版发布（供 Gate 4 Remix）----
  const final = await db.content.findUnique({ where: { id: contentId }, select: { status: true, visibility: true } })
  if (final?.status !== 'PUBLISHED') {
    const c2 = new Client('g3-father')
    c2.restore(loadState(CASE_ID).cookies)
    await c2.post(`/api/contents/${contentId}/publish`, { visibility: 'public' })
    console.log(`\n[${ts()}] 最终版已发布（v${versions[versions.length - 1].versionNumber}）`)
  }

  await db.$disconnect()
  console.log(`\n[${ts()}] Gate 3 完成：${loadState(CASE_ID).revisions.length} 次修订`)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
