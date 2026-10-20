import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const jobs = await db.generationJob.findMany({
  select: { type: true, status: true, claimedAt: true, startedAt: true },
  orderBy: { createdAt: 'desc' },
  take: 5,
})
for (const j of jobs) console.log(`${j.type}:${j.status}${j.claimedAt ? ' (claimed ' + j.claimedAt.toISOString() + ')' : ''}`)
await db.$disconnect()
