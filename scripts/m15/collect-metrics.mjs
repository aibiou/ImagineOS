// scripts/m15/collect-metrics.mjs —— M1.5 指标汇总（DB 权威源）
// 输出 state/metrics.json：每案例的 Intent / CreativePlan / Generation 记账 / Job 时长 / 资产 / 版本链
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const stateFiles = readdirSync('scripts/m15/state').filter((f) => /^p\d+.*\.json$/.test(f))
const cases = stateFiles.map((f) => JSON.parse(readFileSync(join('scripts/m15/state', f), 'utf8')))

function stat(nums) {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  return {
    n: nums.length,
    mean: +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(0),
    p50: +sorted[Math.floor(sorted.length / 2)].toFixed(0),
    max: +sorted[sorted.length - 1].toFixed(0),
    total: nums.reduce((a, b) => a + b, 0),
  }
}

const out = { collectedAt: new Date().toISOString(), cases: [], totals: {} }

for (const s of cases) {
  if (!s.contentId) continue
  const content = await db.content.findUnique({
    where: { id: s.contentId },
    include: {
      versions: { orderBy: { versionNumber: 'asc' } },
      intents: true,
      publication: true,
      remixOf: { include: { sourceContent: { select: { title: true } } } },
    },
  })
  if (!content) continue

  const generations = await db.generation.findMany({ where: { contentId: s.contentId }, orderBy: { createdAt: 'asc' } })
  const jobs = await db.generationJob.findMany({ where: { contentId: s.contentId }, orderBy: { createdAt: 'asc' } })
  const assets = await db.asset.findMany({ where: { contentId: s.contentId } })

  // Generation 记账按 (type, purpose) 汇总（purpose 存于 inputJson）
  const genBy = {}
  for (const g of generations) {
    let purpose = null
    try { purpose = JSON.parse(g.inputJson ?? '{}')?.purpose ?? null } catch {}
    const key = `${g.type}${purpose ? '/' + purpose : ''}`
    genBy[key] = genBy[key] ?? { succeeded: 0, failed: 0, latencies: [] }
    genBy[key][g.status]++
    if (g.latencyMs != null) genBy[key].latencies.push(g.latencyMs)
  }
  const genSummary = {}
  for (const [k, v] of Object.entries(genBy)) {
    genSummary[k] = { succeeded: v.succeeded, failed: v.failed, latencyMs: stat(v.latencies) }
  }

  // Job 时长（queued→completed 全程 + running 段）
  const jobSummary = jobs.map((j) => ({
    type: j.type,
    status: j.status,
    queueMs: j.startedAt ? j.startedAt - j.createdAt : null,
    runMs: j.completedAt && j.startedAt ? j.completedAt - j.startedAt : null,
    totalMs: j.completedAt ? j.completedAt - j.createdAt : null,
  }))

  const intentRow = content.intents[0]
  let intentRecord = null
  try { intentRecord = intentRow?.fieldsJson ? JSON.parse(intentRow.fieldsJson) : null } catch {}

  const finalAsset = assets.find((a) => a.kind === 'final')
  const thumbAsset = assets.find((a) => a.kind === 'thumbnail')

  out.cases.push({
    caseId: s.caseId,
    meta: { type: s.meta?.type ?? null, paradigm: s.meta?.paradigm ?? null },
    content: {
      id: content.id,
      title: content.title,
      status: content.status,
      visibility: content.visibility,
      publishedAt: content.publication?.publishedAt ?? null,
      remixOf: content.remixOf ? { title: content.remixOf.sourceContent.title } : null,
    },
    intent: {
      rawExpression: intentRow?.rawExpression ?? null,
      record: intentRecord
        ? {
            subject: intentRecord.subject ?? null,
            emotion: intentRecord.emotion ?? null,
            tone: intentRecord.tone ?? null,
            format: intentRecord.format ?? null,
            audience: intentRecord.audience ?? null,
            durationSec: intentRecord.durationSec ?? null,
            sources: intentRecord.sources ?? null,
          }
        : null,
    },
    creativePlan: {
      directions: (s.record?.directions ?? []).map((d) => d.name),
      selectedConcept: s.record?.concept ?? null,
      storyLogline: s.record?.storyLogline ?? null,
      storyboard: s.record?.storyboard?.shotCount != null
        ? { shots: s.record.storyboard.shotCount, scenes: s.record.storyboard.scenes }
        : null,
    },
    revisions: (s.revisions ?? []).map((r) => ({
      feedback: r.feedback,
      plan: r.plan,
      versionNumber: r.version?.versionNumber,
      changedShotCount: r.diff?.changedShotCount,
      unchangedShotCount: r.diff?.unchangedShotCount,
      changedShots: (r.diff?.changedShots ?? []).map((cs) => ({ shotIndex: cs.shotIndex, fields: Object.keys(cs.fields) })),
      elapsedMs: r.elapsedMs,
    })),
    timeline: { ...s.timeline },
    elapsed: { ...s.elapsed },
    generations: genSummary,
    jobs: jobSummary,
    assets: {
      generated: assets.filter((a) => a.kind === 'generated').length,
      final: finalAsset ? { durationMs: finalAsset.durationMs, sizeBytes: finalAsset.sizeBytes, mime: finalAsset.mime } : null,
      thumbnail: thumbAsset ? { sizeBytes: thumbAsset.sizeBytes } : null,
      totalBytes: assets.reduce((n, a) => n + (a.sizeBytes ?? 0), 0),
    },
    versions: content.versions.map((v) => ({
      v: v.versionNumber, method: v.creationMethod, changelog: v.changelog, at: v.createdAt,
    })),
  })
}

// 全局汇总
const allLatencies = {}
for (const c of out.cases) {
  for (const [k, v] of Object.entries(c.generations)) {
    allLatencies[k] = allLatencies[k] ?? { succeeded: 0, failed: 0, latencies: [] }
    allLatencies[k].succeeded += v.succeeded
    allLatencies[k].failed += v.failed
  }
}
// 全库 Generation 行重新分组（purpose 从 inputJson 提取）
const genRows = await db.generation.findMany()
const globalBy = {}
for (const g of genRows) {
  let purpose = null
  try { purpose = JSON.parse(g.inputJson ?? '{}')?.purpose ?? null } catch {}
  const key = `${g.type}${purpose ? '/' + purpose : ''}`
  globalBy[key] = globalBy[key] ?? { succeeded: 0, failed: 0, latencies: [] }
  globalBy[key][g.status]++
  if (g.latencyMs != null) globalBy[key].latencies.push(g.latencyMs)
}
for (const [k, v] of Object.entries(globalBy)) {
  v.latencyMs = stat(v.latencies)
  allLatencies[k] = v
}
out.totals = {
  caseCount: out.cases.length,
  publishedCount: out.cases.filter((c) => c.content.status === 'PUBLISHED').length,
  generationCalls: allLatencies,
  totalAssetsBytes: out.cases.reduce((n, c) => n + (c.assets?.totalBytes ?? 0), 0),
}

writeFileSync('scripts/m15/state/metrics.json', JSON.stringify(out, null, 2))
console.log(`✓ ${out.cases.length} 案例已采集 → scripts/m15/state/metrics.json`)
console.log(`  发布：${out.totals.publishedCount}/${out.cases.length}`)
for (const [k, v] of Object.entries(out.totals.generationCalls)) {
  console.log(`  ${k}: ok=${v.succeeded} fail=${v.failed} 平均=${v.latencyMs?.mean ?? '-'}ms`)
}
await db.$disconnect()
