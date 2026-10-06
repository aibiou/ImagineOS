// 深度巡检 custom.db：索引/Job/Generation/Provenance/版本结构
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

console.log('=== Asset 表索引 ===')
const idx = await db.$queryRawUnsafe("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='Asset'")
for (const i of idx) console.log(`- ${i.name}: ${i.sql}`)

console.log('\n=== GenerationJob ===')
const jobs = await db.generationJob.findMany({
  select: { type: true, status: true, retryCount: true, error: true, outputJson: true, createdAt: true, completedAt: true, claimedAt: true },
  orderBy: { createdAt: 'asc' },
})
for (const j of jobs) {
  console.log(`- [${j.status}] ${j.type} retry=${j.retryCount} created=${j.createdAt.toISOString()} done=${j.completedAt?.toISOString() ?? '-'} ${j.error ? 'ERR: ' + String(j.error).slice(0, 200) : ''}`)
  if (j.outputJson) console.log(`  OUT: ${String(j.outputJson).slice(0, 200)}`)
}

console.log('\n=== Generation（router 调用日志）===')
const gens = await db.generation.findMany({
  select: { purpose: true, status: true, provider: true, model: true, latencyMs: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
})
for (const g of gens) console.log(`- [${g.status}] ${g.purpose} via ${g.provider}/${g.model} ${g.latencyMs ? g.latencyMs + 'ms' : ''}`)

console.log('\n=== Content 详情 ===')
const contents = await db.content.findMany({
  include: {
    owner: { select: { displayName: true, handle: true } },
    versions: { select: { versionNumber: true, creationMethod: true, changelog: true, createdAt: true } },
    publication: true,
    remixOf: { include: { sourceContent: { select: { title: true } } } },
  },
})
for (const c of contents) {
  console.log(`\n- [${c.status}] ${c.title} (${c.owner.displayName})`)
  console.log(`  createdAt=${c.createdAt.toISOString()} updatedAt=${c.updatedAt.toISOString()} vis=${c.visibility}`)
  for (const v of c.versions) console.log(`  v${v.versionNumber}: ${v.creationMethod} "${v.changelog}" at ${v.createdAt.toISOString()}`)
  if (c.publication) console.log(`  published: channel=${c.publication.channel} at ${c.publication.publishedAt?.toISOString()}`)
  if (c.remixOf) console.log(`  remixOf: ${c.remixOf.sourceContent.title}`)
}

console.log('\n=== Intent ===')
const intents = await db.intent.findMany({ select: { contentId: true, primaryIntent: true, source: true, createdAt: true } })
for (const i of intents) console.log(`- content=${i.contentId.slice(0, 8)} source=${i.source} intent="${String(i.primaryIntent).slice(0, 50)}"`)

console.log('\n=== 版本 structure 概览（当前版本）===')
const withVersions = await db.content.findMany({
  include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
})
for (const c of withVersions) {
  const v = c.versions[0]
  if (!v) continue
  try {
    const st = JSON.parse(v.structureJson)
    console.log(`- "${c.title}" v${v.versionNumber}: scenes=${st?.story?.scenes?.length ?? 0} style=${st?.style?.slice(0, 40) ?? '-'}`)
    for (const s of st?.story?.scenes ?? []) {
      for (const sh of s.shots ?? []) {
        console.log(`    shot: dur=${sh.durationMs} cam=${sh.cameraMotion} img="${String(sh.imagePrompt ?? sh.visualDescription ?? '').slice(0, 60)}" tts=${sh.narrationLine ? 'Y' : 'N'}`)
      }
    }
  } catch (e) { console.log(`  structure 解析失败: ${e.message}`) }
}

await db.$disconnect()
