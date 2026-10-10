import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const contentId = process.argv[2]
const job = await db.generationJob.findFirst({ where: { contentId }, orderBy: { createdAt: 'desc' } })
if (job) {
  console.log('JOB:', job.type, job.status, 'retry' + job.retryCount)
  const out = job.outputJson ? JSON.parse(job.outputJson) : {}
  console.log('stage:', out.stage, '| label:', out.label, '| current:', out.current, '/', out.total)
  if (out.shotAssets) {
    for (const s of out.shotAssets) {
      const g = s.gate ? `${s.gate.pass ? 'PASS' : 'FAIL'}${s.gate.skipped ? '(skip)' : ''} ${s.gate.score ?? '-'}/10 x${s.gate.attempts}` : '-'
      const vg = s.videoGate ? `vid:${s.videoGate.pass ? 'PASS' : 'FAIL'}${s.videoGate.skipped ? '(skip)' : ''} ${s.videoGate.score ?? '-'}` : 'vid:…'
      console.log(`  镜${s.shotIndex + 1}: ${g} | ${vg} | img:${s.imageAssetId ? '✓' : '✗'} vid:${s.videoAssetId ? '✓' : '…'} tts:${s.ttsAssetId ? '✓' : '…'}`)
    }
  }
}
const gens = await db.generation.findMany({ where: { contentId }, orderBy: { createdAt: 'desc' }, take: 8, select: { type: true, status: true, provider: true, latencyMs: true, createdAt: true } })
console.log('---最近8笔供给调用---')
for (const g of gens) console.log(g.type, g.status, (g.provider ?? '').split('·').pop(), g.latencyMs + 'ms', g.createdAt.toISOString())
const provs = await db.provenance.findMany({ where: { contentId, model: 'quality-gate' }, orderBy: { createdAt: 'asc' } })
console.log('---quality-gate 事件:', provs.length, '---')
await db.$disconnect()
