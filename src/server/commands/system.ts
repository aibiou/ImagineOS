import { z } from 'zod'
import { execFileSync } from 'node:child_process'
import { db } from '@/lib/db'
import { defineCommand } from './registry'

/**
 * system.health — walking skeleton (T0.7 AC): a real command that walks
 * env → db → media toolchain → registry. The home page renders its result,
 * proving the whole kernel path end to end before any feature work begins.
 */
defineCommand({
  name: 'system.health',
  description: '内核自检：数据库 / 媒体管线 / 命令注册表',
  input: z.object({}).strict(),
  permission: 'public',
  handler: async () => {
    const checks: Record<string, string> = {}

    // 1. Database (Prisma + SQLite)
    try {
      await db.$queryRaw`SELECT 1`
      checks.database = 'ok'
    } catch {
      checks.database = 'failed'
    }

    // 2. Media pipeline (FFmpeg/FFprobe — ADR-001 Alpha render path)
    try {
      execFileSync('ffprobe', ['-version'], { timeout: 3000, stdio: 'ignore' })
      checks.mediaPipeline = 'ok'
    } catch {
      checks.mediaPipeline = 'failed'
    }

    // 3. Command registry is alive (self import would be circular; count via listCommands)
    const { listCommands } = await import('./registry')
    checks.commandRegistry = 'ok'

    const allOk = Object.values(checks).every((v) => v === 'ok')
    return {
      status: allOk ? 'ok' : 'degraded',
      version: 'alpha-0.1.0',
      checks,
      commands: listCommands().length,
    }
  },
})
