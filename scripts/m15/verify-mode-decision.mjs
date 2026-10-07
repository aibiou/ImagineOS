// scripts/m15/verify-mode-decision.mjs —— 审计 R3 修复实测：mode.decision 路由决策事件随 storyboard Job 落库
// 全链真实生成（composition 默认模式）→ 断言 Provenance 事件字段 → 断言意图口径与产物口径一致（零回落）→ 清理
// 幂等：state 落盘断点续跑（lib.mjs）；重跑前删除 state/verify-modedecision.json 即全新执行
import { rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, driveCase, openDb } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const caseId = 'verify-modedecision'
const STATE_FILE = join(HERE, 'state', `${caseId}.json`)

const client = new Client(`verify-${Date.now()}`) // 全新匿名会话
const t0 = Date.now()

console.log(`▶ 全链开始（stopBeforePublish，composition 默认模式，含真实图像/TTS/render）`)
const state = await driveCase(client, caseId, {
  text: '验证路由决策日志：一只纸飞机掠过傍晚的教学楼屋顶，最后落在操场边的草地上。',
  preferKeywords: ['安静', '校园'],
  stopBeforePublish: true,
})
const contentId = state.contentId
console.log(`✔ 全链完成 phase=${state.phase} contentId=${contentId} 耗时=${Math.round((Date.now() - t0) / 1000)}s`)

// ---------------- 断言 ----------------
const db = await openDb()
let pass = 0
const checks = []

// 1. mode.decision 事件存在且字段正确
const decisionEvents = await db.provenance.findMany({
  where: { contentId, model: 'mode-decision' },
  orderBy: { createdAt: 'asc' },
})
const evt = decisionEvents[0]
const payload = evt ? JSON.parse(evt.payloadJson ?? '{}') : null
checks.push(['mode.decision 事件已落库', decisionEvents.length >= 1])
checks.push(['eventType=ai_generated / actorType=system', evt?.eventType === 'ai_generated' && evt?.actorType === 'system'])
checks.push(['payload.stage=mode.decision', payload?.stage === 'mode.decision'])
checks.push(['payload.mode=composition（当前默认）', payload?.mode === 'composition'])
checks.push(['payload.forceNative=false（进程环境实测口径）', payload?.forceNative === false])
checks.push(['payload.motionShots=0（配方无 motion 写入点）', payload?.motionShots === 0])
checks.push(['payload.videoProviderAvailable=true（链非空）', payload?.videoProviderAvailable === true])

// 2. 意图口径（mode.decision）与产物口径（shotAssets）一致 → 零回落
const sbJob = await db.generationJob.findFirst({
  where: { contentId, type: 'video.storyboard', status: 'succeeded' },
  orderBy: { createdAt: 'desc' },
})
const out = sbJob?.outputJson ? JSON.parse(sbJob.outputJson) : null
const shotAssets = out?.shotAssets ?? []
const nativeShots = shotAssets.filter((s) => s.videoAssetId).length
checks.push(['storyboard Job 成功且 shotAssets 非空', shotAssets.length > 0])
checks.push([`产物口径=composition（native镜头 ${nativeShots}/${shotAssets.length}）`, nativeShots === 0])
checks.push([`意图 totalShots 与产物镜头数一致（${payload?.totalShots} vs ${shotAssets.length}）`, payload?.totalShots === shotAssets.length])

// 3. 全链回归：READY + 成片资产
const content = await db.content.findUnique({ where: { id: contentId } })
checks.push(['content.status=READY（全链无回归）', content?.status === 'READY'])

for (const [name, ok] of checks) {
  console.log(`   ${ok ? '✓' : '✗'} ${name}`)
  if (ok) pass++
}
console.log(`断言：${pass}/${checks.length} 通过`)

// ---------------- 清理（不污染 Gate 7 导出窗口） ----------------
await db.content.delete({ where: { id: contentId } }).catch((e) => console.log('   content 清理失败：', e.message))
const recentUser = await db.user.findFirst({
  where: { createdAt: { gte: new Date(Date.now() - 20 * 60_000) }, displayName: { startsWith: '旅人' } },
  orderBy: { createdAt: 'desc' },
})
if (recentUser) {
  await db.user.delete({ where: { id: recentUser.id } }).catch((e) => console.log('   user 清理失败：', e.message))
}
if (existsSync(STATE_FILE)) rmSync(STATE_FILE)
const leftover = await db.provenance.count({ where: { contentId } })
console.log(`清理 ✓（content + 匿名 user + state 文件；残留事件=${leftover}）`)

await db.$disconnect()
process.exit(pass === checks.length ? 0 : 1)
