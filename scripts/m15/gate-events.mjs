import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const contentId = process.argv[2]
const events = await db.provenance.findMany({ where: { contentId, model: 'quality-gate' }, orderBy: { createdAt: 'asc' } })
console.log('=== quality-gate 全事件 ===')
for (const e of events) {
  const p = JSON.parse(e.payloadJson ?? '{}')
  console.log(`${e.createdAt.toISOString().slice(11, 19)} 镜${(p.shotIndex ?? -1) + 1} ${p.stage}: ${p.skipped ? 'SKIP' : p.pass ? 'PASS' : 'FAIL'} score=${p.score ?? '-'} attempts=${p.attempts}${(p.issues ?? []).length ? ' [' + p.issues.join('；').slice(0, 90) + ']' : ''}`)
}
await db.$disconnect()
