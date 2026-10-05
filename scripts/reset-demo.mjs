import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const n = await db.user.deleteMany({ where: { isDemo: true } })
console.log('removed demo users:', n.count)
await db.$disconnect()
