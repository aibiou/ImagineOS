import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const jobs = await db.generationJob.findMany({ orderBy: { createdAt: 'desc' }, take: 5 })
for (const j of jobs) console.log(j.type, j.status, '|', (j.error ?? '').slice(0, 160))
await db.$disconnect()
