import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
/** SQLite 交互事务统一超时：并发写锁竞争下 5s 默认值会 P2028（M1.5 实测修复） */
export const SQLITE_TX_TIMEOUT = { timeout: 30_000 }
