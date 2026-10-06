// scripts/m15/export-human-test.mjs —— Gate 7：真人测试结果导出
// 用法：
//   node scripts/m15/export-human-test.mjs --since="2026-10-07 10:00"   # 按时间窗导出（推荐：测试开始时刻）
//   node scripts/m15/export-human-test.mjs --users=uid1,uid2            # 按用户导出
//   node scripts/m15/export-human-test.mjs                              # 全量（含种子数据，仅调试用）
// 输出：scripts/m15/state/human-test-export.json + 控制台摘要
// 设计：每位被试 = 一个独立浏览器会话 = 一个匿名 User；
//       六指标全部从 DB 权威记账推导，不依赖前端埋点（防丢失/防伪造）。
import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'node:fs'

const db = new PrismaClient()
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([\w-]+)=(.*)$/)
  return m ? [m[1], m[2]] : [a, true]
}))

const since = args.since ? new Date(args.since) : null
if (since && Number.isNaN(since.getTime())) { console.error('--since 时间格式无效'); process.exit(1) }
const userList = args.users ? String(args.users).split(',') : null

// 被试筛选：排除种子演示账号（isDemo=true 是 M1/M1.5 种子与案例作者）
const users = await db.user.findMany({
  where: {
    isDemo: false,
    ...(userList ? { id: { in: userList } } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
  },
  include: {
    contents: { include: { versions: { select: { id: true, versionNumber: true, creationMethod: true, createdBy: true, changelog: true, createdAt: true } }, publication: true, remixOf: true } },
    remixesMade: { select: { id: true, sourceContentId: true, derivativeContentId: true, createdAt: true } },
    interactions: { select: { type: true, createdAt: true } },
  },
})

const rows = []
for (const u of users) {
  const created = u.contents
  const published = created.filter((c) => c.publication?.publishedAt != null)
  const revised = created.filter((c) => c.versions.some((v) => v.creationMethod === 'revision'))
  const revisionCount = created.reduce((n, c) => n + c.versions.filter((v) => v.creationMethod === 'revision').length, 0)
  const remixed = u.remixesMade.length
  // 「我还想做一个」行为率分子：同被试创作 ≥2 件作品（第一件之后的每一件都是自发再创作）
  const repeatCreation = Math.max(0, created.length - 1)
  const nativeContents = []
  for (const c of created) {
    const gens = await db.generation.findMany({ where: { contentId: c.id, type: 'video.shot' }, select: { status: true } })
    const ok = gens.filter((g) => g.status === 'succeeded').length
    if (gens.length > 0) nativeContents.push({ contentId: c.id, nativeShots: ok, nativeAttempts: gens.length, mode: ok > 0 ? (ok === gens.length ? 'native' : 'native-with-fallback') : 'composition-fallback' })
  }
  rows.push({
    userId: u.id,
    displayName: u.displayName,
    handle: u.handle,
    joinedAt: u.createdAt,
    metrics: {
      contentsCreated: created.length,
      published: published.length,
      revisedContents: revised.length,
      revisionCount,
      remixed: remixed,
      repeatCreation,
      interactions: u.interactions.length,
    },
    contents: created.map((c) => ({
      contentId: c.id,
      title: c.title,
      status: c.status,
      publishedAt: c.publication?.publishedAt ?? null,
      versions: c.versions.map((v) => ({ v: v.versionNumber, method: v.creationMethod, changelog: (v.changelog ?? '').slice(0, 60), by: v.createdBy === u.id ? 'self' : v.createdBy })),
      remixOf: c.remixOf ? { sourceContentId: c.remixOf.sourceContentId } : null,
    })),
    remixes: u.remixesMade,
    nativeConfig: nativeContents,
  })
}

const summary = {
  exportedAt: new Date().toISOString(),
  since: since?.toISOString() ?? null,
  participants: rows.length,
  aggregate: {
    contentsCreated: rows.reduce((n, r) => n + r.metrics.contentsCreated, 0),
    published: rows.reduce((n, r) => n + r.metrics.published, 0),
    revisedParticipants: rows.filter((r) => r.metrics.revisionCount > 0).length,
    remixedParticipants: rows.filter((r) => r.metrics.remixed > 0).length,
    repeatCreationParticipants: rows.filter((r) => r.metrics.repeatCreation > 0).length,
    intentCompletion: rows.length > 0 ? rows.filter((r) => r.metrics.contentsCreated > 0).length / rows.length : 0,
    'repeatRate(我还想做一个)': rows.length > 0 ? rows.filter((r) => r.metrics.repeatCreation > 0).length / rows.length : 0,
  },
  participants: rows,
}

writeFileSync('scripts/m15/state/human-test-export.json', JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ 导出时间: summary.exportedAt, 被试数: rows.length, 汇总: summary.aggregate }, null, 2))
console.log('→ scripts/m15/state/human-test-export.json')
await db.$disconnect()
