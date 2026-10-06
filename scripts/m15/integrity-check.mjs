// scripts/m15/integrity-check.mjs —— Gate 5：Content Object 数据库级完整性检查
// 维度：Content/ContentVersion/Asset/Generation/Provenance/Remix 六表关系完整性
// 输出：控制台报告 + state/integrity.json（供 Content Integrity Report 使用）
import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'node:fs'

const db = new PrismaClient()
const issues = [] // { severity: 'error'|'warn', table, check, detail }
const stats = {}

function error(table, check, detail) { issues.push({ severity: 'error', table, check, detail }) }
function warn(table, check, detail) { issues.push({ severity: 'warn', table, check, detail }) }

// ---------- 1. Content ↔ ContentVersion ----------
const contents = await db.content.findMany({ include: { versions: true, publication: true, remixOf: true, remixSources: true } })

// 案例分类：M1.5 生产案例（scripts/m15/state 中的 contentId + 父亲/Remix 链）vs 遗留测试数据
const { readdirSync, readFileSync: rf } = await import('node:fs')
const m15ContentIds = new Set()
for (const f of readdirSync('scripts/m15/state').filter((x) => /^(p\d+|g[34]-)/.test(x))) {
  try {
    const st = JSON.parse(rf(`scripts/m15/state/${f}`, 'utf8'))
    if (st.contentId) m15ContentIds.add(st.contentId)
    if (st.remix?.contentId) m15ContentIds.add(st.remix.contentId)
  } catch {}
}
stats.m15Cases = contents.filter((c) => m15ContentIds.has(c.id)).length
stats.legacyFixtures = contents.length - stats.m15Cases
stats.contents = contents.length
stats.byStatus = {}
for (const c of contents) stats.byStatus[c.status] = (stats.byStatus[c.status] ?? 0) + 1

for (const c of contents) {
  if (c.versions.length === 0) {
    error('Content', '版本存在性', `作品 ${c.id}（${c.title}）没有任何版本`)
    continue
  }
  if (c.currentVersionId == null) {
    if (!['IDEA', 'INTENT', 'PLANNING', 'STORY', 'STORYBOARD'].includes(c.status)) {
      error('Content', '现势指针', `作品 ${c.id}（${c.title}）状态 ${c.status} 但 currentVersionId 为空`)
    }
  } else {
    const current = c.versions.find((v) => v.id === c.currentVersionId)
    if (!current) error('Content', '现势指针', `作品 ${c.id} 的 currentVersionId ${c.currentVersionId} 不在其版本集合中`)
    else if (current.versionNumber !== Math.max(...c.versions.map((v) => v.versionNumber))) {
      warn('Content', '现势指针最新性', `作品 ${c.id}（${c.title}）currentVersion=v${current.versionNumber} 但最大版本为 v${Math.max(...c.versions.map((v) => v.versionNumber))}`)
    }
  }
  // 版本号连续性
  const nums = c.versions.map((v) => v.versionNumber).sort((a, b) => a - b)
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) { warn('ContentVersion', '版本号连续性', `作品 ${c.id}（${c.title}）版本号 ${nums} 不连续`); break }
  }
  // 版本链 parent 一致性
  for (const v of c.versions) {
    if (v.parentVersionId) {
      const parent = c.versions.find((x) => x.id === v.parentVersionId)
      if (!parent) error('ContentVersion', '血缘链', `作品 ${c.id} 版本 v${v.versionNumber} 的 parent 不在同一作品的版本集合中`)
    }
  }
  // PUBLISHED 作品必有 Publication
  if (c.status === 'PUBLISHED' && !c.publication) error('Content', '发布记录', `作品 ${c.id}（${c.title}）已发布但无 Publication 记录`)
}

// ---------- 2. ContentVersion ↔ Asset（经 GenerationJob.outputJson） ----------
const jobs = await db.generationJob.findMany()
stats.jobs = jobs.length
stats.jobsByType = {}
for (const j of jobs) stats.jobsByType[j.type] = (stats.jobsByType[j.type] ?? 0) + 1
stats.jobsByStatus = {}
for (const j of jobs) stats.jobsByStatus[j.status] = (stats.jobsByStatus[j.status] ?? 0) + 1

const assets = await db.asset.findMany()
const assetIds = new Set(assets.map((a) => a.id))
stats.assets = assets.length
stats.assetsByKind = {}
for (const a of assets) stats.assetsByKind[a.kind] = (stats.assetsByKind[a.kind] ?? 0) + 1

for (const j of jobs) {
  if (j.status !== 'succeeded' || !j.outputJson) continue
  try {
    const out = JSON.parse(j.outputJson)
    if (j.type === 'video.storyboard' && Array.isArray(out.shotAssets)) {
      for (const e of out.shotAssets) {
        if (!assetIds.has(e.imageAssetId)) error('Asset', '分镜资产引用', `Job ${j.id} 引用的图像资产 ${e.imageAssetId} 不存在`)
        if (e.ttsAssetId && !assetIds.has(e.ttsAssetId)) error('Asset', '分镜资产引用', `Job ${j.id} 引用的旁白资产 ${e.ttsAssetId} 不存在`)
        if (e.videoAssetId && !assetIds.has(e.videoAssetId)) error('Asset', '分镜资产引用', `Job ${j.id} 引用的视频资产 ${e.videoAssetId} 不存在`)
      }
    }
    if (j.type === 'video.render') {
      if (out.finalAssetId && !assetIds.has(out.finalAssetId)) error('Asset', '成片资产引用', `Job ${j.id} 引用的成片资产 ${out.finalAssetId} 不存在`)
      if (out.posterAssetId && !assetIds.has(out.posterAssetId)) error('Asset', '封面资产引用', `Job ${j.id} 引用的封面资产 ${out.posterAssetId} 不存在`)
    }
  } catch { warn('GenerationJob', 'outputJson 解析', `Job ${j.id} 的 outputJson 无法解析`) }
}

// ---------- 3. Content ↔ Generation（记账完整性；查询提前供下游使用） ----------
const generations = await db.generation.findMany()
stats.generations = generations.length

// READY/PUBLISHED 作品必有 final 资产（Remix 配方继承副本除外：待再生成属预期语义）
for (const c of contents) {
  if (['READY', 'PUBLISHED'].includes(c.status)) {
    const finals = assets.filter((a) => a.contentId === c.id && a.kind === 'final')
    const hasGeneration = generations.some((g) => g.contentId === c.id)
    if (finals.length === 0 && !(c.remixOf && !hasGeneration)) {
      error('Asset', '成片存在性', `作品 ${c.id}（${c.title}）状态 ${c.status} 但无 final 资产`)
    }
    const posters = assets.filter((a) => a.contentId === c.id && a.kind === 'thumbnail')
    if (posters.length === 0 && finals.length > 0) warn('Asset', '封面存在性', `作品 ${c.id}（${c.title}）有成片但无封面资产`)
  }
}
stats.generationsByType = {}
for (const g of generations) stats.generationsByType[g.type] = (stats.generationsByType[g.type] ?? 0) + 1
stats.generationsByStatus = {}
for (const g of generations) stats.generationsByStatus[g.status] = (stats.generationsByStatus[g.status] ?? 0) + 1

const contentIdSet = new Set(contents.map((c) => c.id))
for (const g of generations) {
  if (!contentIdSet.has(g.contentId)) error('Generation', '外键', `Generation ${g.id} 引用不存在的 content ${g.contentId}`)
  if (g.latencyMs == null) warn('Generation', '延迟记账', `Generation ${g.id}（${g.type}/${g.purpose}）无 latencyMs`)
}
// 有生成动作的作品必有记账
for (const j of jobs) {
  if (!contentIdSet.has(j.contentId)) error('GenerationJob', '外键', `Job ${j.id} 引用不存在的 content ${j.contentId}`)
}
for (const c of contents) {
  if (c.versions.some((v) => v.creationMethod !== 'initial' && v.creationMethod !== 'remix')) {
    const gens = generations.filter((g) => g.contentId === c.id)
    if (gens.length === 0) warn('Generation', '记账覆盖', `作品 ${c.id}（${c.title}）有修订/再生成但无任何 Generation 记账`)
  }
}

// ---------- 4. Provenance（只追加 + 事件覆盖） ----------
const provenance = await db.provenance.findMany({ orderBy: { createdAt: 'asc' } })
stats.provenance = provenance.length
stats.provenanceByEvent = {}
for (const p of provenance) stats.provenanceByEvent[p.eventType] = (stats.provenanceByEvent[p.eventType] ?? 0) + 1

for (const c of contents) {
  const events = provenance.filter((p) => p.contentId === c.id)
  if (events.length === 0) { error('Provenance', '创建事件', `作品 ${c.id}（${c.title}）无任何溯源事件`); continue }
  if (c.remixOf) {
    // Remix 衍作品：诞生事件 = remix_received（从哪里来），不要求 content_created
    if (!events.some((e) => e.eventType === 'remix_received')) error('Provenance', 'remix 诞生事件', `Remix 衍作品 ${c.title} 无 remix_received 事件`)
  } else {
    if (!events.some((e) => e.eventType === 'content_created')) error('Provenance', '创建事件', `作品 ${c.id}（${c.title}）缺 content_created`)
  }
  if (c.status === 'PUBLISHED' && !events.some((e) => e.eventType === 'published')) error('Provenance', '发布事件', `作品 ${c.id}（${c.title}）已发布但无 published 事件`)
}
// 时间线单调（同 content 内事件时间不倒序——弱断言，SQLite 时间精度 ms 内可能并列）
for (const c of contents) {
  const events = provenance.filter((p) => p.contentId === c.id)
  for (let i = 1; i < events.length; i++) {
    if (events[i].createdAt < events[i - 1].createdAt) { warn('Provenance', '时间线单调', `作品 ${c.id} 的溯源事件时间倒序（并列写入可接受）`); break }
  }
}

// ---------- 5. Remix（血缘三件套 + 关系完整性） ----------
const remixes = await db.remix.findMany()
stats.remixes = remixes.length
for (const r of remixes) {
  const derivative = contents.find((c) => c.id === r.derivativeContentId)
  const source = contents.find((c) => c.id === r.sourceContentId)
  if (!derivative) { error('Remix', '衍作品存在', `Remix ${r.id} 的 derivativeContent ${r.derivativeContentId} 不存在`); continue }
  if (!source) { error('Remix', '原作存在', `Remix ${r.id} 的 sourceContent ${r.sourceContentId} 不存在`); continue }
  // 血缘三件套
  if (!derivative.versions.some((v) => v.id === r.derivativeVersionId)) error('Remix', '衍作版本', `Remix ${r.id} 的 derivativeVersionId 不属于衍作品`)
  if (!source.versions.some((v) => v.id === r.sourceVersionId)) error('Remix', '原作版本', `Remix ${r.id} 的 sourceVersionId 不属于原作`)
  // 衍作首版 method=remix
  const dv = derivative.versions.find((v) => v.id === r.derivativeVersionId)
  if (dv && dv.creationMethod !== 'remix') warn('Remix', '创建方式标记', `衍作品 ${derivative.title} 的 v${dv.versionNumber} creationMethod=${dv.creationMethod}（预期 remix）`)
  // 溯源事件（remixed 记在原作侧，remix_received 记在衍作侧——fork-service 双侧记录）
  const remixedEvents = provenance.filter((p) => p.contentId === source.id && p.eventType === 'remixed')
  const receivedEvents = provenance.filter((p) => p.contentId === derivative.id && p.eventType === 'remix_received')
  if (remixedEvents.length === 0) warn('Provenance', 'remixed 事件', `原作 ${source.title} 无 remixed 事件`)
  if (receivedEvents.length === 0) warn('Provenance', 'remix_received 事件', `衍作品 ${derivative.title} 无 remix_received 事件`)
}

// ---------- 6. 资产孤儿与文件落盘 ----------
const orphanAssets = assets.filter((a) => !contentIdSet.has(a.contentId))
if (orphanAssets.length > 0) error('Asset', '孤儿', `${orphanAssets.length} 个资产引用不存在的 content`)
// 文件存在性（抽样 final/thumbnail）
const { existsSync } = await import('node:fs')
const { resolve } = await import('node:path')
let missingFiles = 0
for (const a of assets.filter((x) => ['final', 'thumbnail'].includes(x.kind))) {
  if (!existsSync(resolve('storage/assets', a.storageLocation))) { missingFiles++; error('Asset', '文件落盘', `资产 ${a.id}（${a.kind}）文件缺失：${a.storageLocation}`) }
}
stats.finalAssetsOnDisk = assets.filter((x) => x.kind === 'final').length - missingFiles

// ---------- 汇总 ----------
// 分类：M1.5 生产案例 issue vs 遗留测试数据 issue（按「作品 <id>」提取归属）
function belongsToM15(detail) {
  const m = detail.match(/作品 (\w+)/)
  return !m || m15ContentIds.has(m[1])
}
const m15Issues = issues.filter((i) => belongsToM15(i.detail))
const legacyIssues = issues.filter((i) => !belongsToM15(i.detail))
const report = {
  checkedAt: new Date().toISOString(),
  stats,
  errorCount: m15Issues.filter((i) => i.severity === 'error').length,
  warnCount: m15Issues.filter((i) => i.severity === 'warn').length,
  issues: m15Issues,
  legacy: {
    note: 'M0/M1 遗留测试夹具（状态机走查/发布走查等），不计入 Gate 5 结论',
    errorCount: legacyIssues.filter((i) => i.severity === 'error').length,
    warnCount: legacyIssues.filter((i) => i.severity === 'warn').length,
    issues: legacyIssues,
  },
}
writeFileSync('scripts/m15/state/integrity.json', JSON.stringify(report, null, 2))

console.log('=== Content Object Integrity Check（Gate 5）===')
console.log(JSON.stringify(stats, null, 2))
console.log(`\nM1.5 生产案例：错误 ${report.errorCount} ｜ 警告 ${report.warnCount}`)
for (const i of m15Issues) console.log(`  [${i.severity === 'error' ? '✗' : '!'}] ${i.table}/${i.check}：${i.detail}`)
console.log(`\n遗留测试夹具（不计入结论）：错误 ${report.legacy.errorCount} ｜ 警告 ${report.legacy.warnCount}`)
await db.$disconnect()
