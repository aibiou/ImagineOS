// scripts/m15/repair-g4-state.mjs —— 从 DB 重建 g4-remix state 的 revisions（状态踩踏 bug 修复）
// 背景：run-remix-chain 第 7 步旧 state 覆盖 → revisions 被踩空。DB 版本链完整（衍作 v1 remix → v2 换母亲 → v3 结尾收敛）。
import { loadState, saveState, diffStructures, summarizeStructure } from './lib.mjs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const G4_ID = 'g4-remix'

async function main() {
  const state = loadState(G4_ID)
  const derivativeId = state.remix.contentId
  console.log('衍作:', derivativeId, '| 当前 revisions:', state.revisions?.length ?? 0)

  const versions = await db.contentVersion.findMany({ where: { contentId: derivativeId }, orderBy: { versionNumber: 'asc' } })
  console.log('DB 版本链:', versions.map(v => `v${v.versionNumber}[${v.creationMethod}]「${v.changelog}」`).join(' → '))

  const REVISIONS = [
    { feedback: '把父亲换成母亲，保持原来的情绪和视觉风格。', note: '主角替换：父亲→母亲，风格延续' },
    { feedback: '结尾旁白轻一点，收得更平静。', note: '结尾情绪收敛' },
  ]

  state.revisions = []
  for (let i = 0; i < REVISIONS.length; i++) {
    const { feedback, note } = REVISIONS[i]
    const after = versions[i + 1]  // v2 / v3
    const before = versions[i]     // v1 / v2
    if (!after) { console.log(`缺少 v${i + 2}，跳过`); continue }
    const structureAfter = after.structureJson ? JSON.parse(after.structureJson) : {}
    const structureBefore = before.structureJson ? JSON.parse(before.structureJson) : {}
    const diff = diffStructures(structureBefore, structureAfter)
    // 版本创建时间近似修订耗时起点；渲染完成时间从 render Job 取
    const renderJob = await db.generationJob.findFirst({
      where: { contentId: derivativeId, type: 'video.render', versionId: after.id, status: 'succeeded' },
    })
    const elapsedMs = renderJob ? renderJob.updatedAt.getTime() - after.createdAt.getTime() : null
    state.revisions.push({
      feedback,
      plan: {
        targetLevel: '(state 踩踏后从 DB 重建；plan 输出未持久化，定位级别由结构 diff 推断)',
        summary: note + '（v' + after.versionNumber + ' 密封结构 diff 重建）',
        reason: 'v' + after.versionNumber + ' changelog：' + after.changelog,
        affectedShotIndexes: diff.changedShots.map(c => c.shotIndex),
        changeKind: null,
      },
      version: { versionId: after.id, versionNumber: after.versionNumber },
      changelog: after.changelog,
      elapsedMs,
      final: null,
      structureSummary: summarizeStructure(structureAfter),
      diff,
      recovery: {
        mode: 'post-clobbering rebuild（run-remix-chain 第 7 步旧 state 覆盖踩空 revisions，DB 权威源重建）',
        rebuiltAt: new Date().toISOString(),
      },
    })
    console.log(`修订${i + 1}: v${after.versionNumber}「${after.changelog}」改动 ${diff.changedShotCount}/${diff.shotCount.after} 镜 ${elapsedMs ? Math.round(elapsedMs / 1000) + 's' : ''}`)
  }

  state.phase = 'published'
  state.derivativePublished = true
  saveState(G4_ID, state)
  console.log('已重建 → revisions=' + state.revisions.length + ' phase=published')
  await db.$disconnect()
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
