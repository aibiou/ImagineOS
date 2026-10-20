import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const contentId = process.argv[2]
const rows = await db.generation.findMany({ where: { contentId, type: 'video.shot' }, orderBy: { createdAt: 'asc' }, select: { provider: true, status: true, latencyMs: true, createdAt: true } })
console.log('video.shot 全账本（按提交时间）:')
for (const r of rows) {
  const p = (r.provider ?? '').split('·').pop()
  console.log(`  ${r.createdAt.toISOString()} ${p.padEnd(24)} ${r.status.padEnd(9)} ${((r.latencyMs ?? 0) / 1000).toFixed(1)}s`)
}
const ok = rows.filter((r) => r.status === 'succeeded')
console.log(`成功 ${ok.length}/${rows.length}`)
await db.$disconnect()
