import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const tables = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name")
console.log(tables.map(t => t.name).join(', '))
await db.$disconnect()
