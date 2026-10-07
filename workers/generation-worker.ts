// 进程内生成 Worker（§53 / T6.1.1）
// 循环：requeueStale（崩溃恢复）→ claimNext（乐观锁）→ execute → complete/fail
// 看门狗：每 12 轮 tick（约 30s）扫一次孤儿 GENERATING/RENDERING（无活跃 Job 且超时 → 标记失败）
// 单进程内单循环（Alpha 单实例）；接口按可替换队列 worker 设计。
// 测试直接调用 runOneTick()，不启动定时器。

import { jobService } from '@/core/jobs/job-service'
import { executeJob } from './pipeline-executor'

const TICK_INTERVAL_MS = 2500
const WATCHDOG_EVERY_TICKS = 12 // 12 × 2.5s = 30s 一轮看门狗扫描
const WORKER_GLOBAL_KEY = '__imagineos_worker__'

declare global {
   
  var __imagineos_worker__: { started: boolean; timer?: NodeJS.Timeout } | undefined
}

export async function runOneTick(): Promise<boolean> {
  await jobService.requeueStale()
  const job = await jobService.claimNext()
  if (!job) return false
  try {
    await jobService.markRunning(job.id)
    await executeJob(job.id, job.type, job.inputJson)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const outcome = await jobService.fail(job.id, message)
    console.warn(`[worker] Job ${job.id}（${job.type}）失败 → ${outcome}：${message}`)
  }
  return true
}

/** 启动后台循环（Next.js instrumentation 调用；模块级守卫防 dev 热重载双启） */
export function startWorker(): void {
  if (process.env.IMAGINEOS_DISABLE_WORKER === '1') return
  const g = globalThis as typeof globalThis & { [k: string]: unknown }
  const state = g[WORKER_GLOBAL_KEY] as { started: boolean; timer?: NodeJS.Timeout } | undefined
  if (state?.started) return
  g[WORKER_GLOBAL_KEY] = { started: true }

  let ticks = 0
  const loop = async () => {
    try {
      // 每轮最多消化 3 个 Job（防长任务阻塞心跳语义）
      for (let i = 0; i < 3; i++) {
        const had = await runOneTick()
        if (!had) break
      }
      // 看门狗：孤儿 GENERATING/RENDERING（无活跃 Job 且静默超时）→ 标记失败，永不无限转圈
      if (ticks % WATCHDOG_EVERY_TICKS === 0) {
        const marked = await jobService.sweepOrphanedGenerations()
        if (marked > 0) console.warn(`[watchdog] 标记 ${marked} 个长期无进展的生成（GENERATING/RENDERING 孤儿）为超时失败`)
      }
      ticks++
    } catch (e) {
      console.warn('[worker] tick 异常（下一轮继续）：', e instanceof Error ? e.message : e)
    }
  }
  const timer = setInterval(() => void loop(), TICK_INTERVAL_MS)
  timer.unref?.() // 不阻止进程退出
  console.log('[ImagineOS] generation worker 已启动（tick = 2.5s，watchdog = 30s）')
}

export function stopWorker(): void {
  const g = globalThis as typeof globalThis & { [k: string]: unknown }
  const state = g[WORKER_GLOBAL_KEY] as { started: boolean; timer?: NodeJS.Timeout } | undefined
  if (state?.timer) clearInterval(state.timer)
  if (g[WORKER_GLOBAL_KEY]) g[WORKER_GLOBAL_KEY] = { started: false }
}
