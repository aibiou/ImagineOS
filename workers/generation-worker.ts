// 进程内生成 Worker（§53 / T6.1.1）
// 双通道循环（025 战线四）：规划通道（LLM 短任务）+ 生成通道（长任务）分道领取——
//   规划 Job（方向/故事/分镜/修订定位）永远有专属吞吐，绝不与 10–50 分钟的视频生成互相排队；
//   分道语义由 claimNext 的类型过滤保证（规划=只领规划类，生成=排除规划类），乐观锁天然防双通道互踩。
// 循环：requeueStale（崩溃恢复，仅生成通道执行——幂等）→ claimNext（乐观锁）→ execute → complete/fail
// 看门狗：生成通道每 12 轮 tick（约 30s）扫一次孤儿 GENERATING/RENDERING（无活跃 Job 且超时 → 标记失败）
// 接口按可替换队列 worker 设计；测试直接调用 runOneTick()（不传 lane = 领任意类型，旧行为），不启动定时器。

import { jobService, NonRetryableJobError } from '@/core/jobs/job-service'
import { executeJob } from './pipeline-executor'

const TICK_INTERVAL_MS = 2500
const WATCHDOG_EVERY_TICKS = 12 // 12 × 2.5s = 30s 一轮看门狗扫描
const WORKER_GLOBAL_KEY = '__imagineos_worker__'

/** 规划类 Job（LLM 计算型，秒级～分钟级）：专属通道，生成流量再大也不排队 */
export const PLANNING_JOB_TYPES = ['story.draft', 'storyboard.plan', 'intent.directions', 'revision.plan']

declare global {
   
  var __imagineos_worker__: { started: boolean; timers?: NodeJS.Timeout[] } | undefined
}

/** 单次领取并执行（导出供测试/未来扩展用）：lane 决定类型过滤，无参 = 领任意（旧行为） */
export async function claimAndExecute(
  lane?: 'planning' | 'generation',
): Promise<boolean> {
  const job = await jobService.claimNext(
    lane === 'planning' ? PLANNING_JOB_TYPES : undefined,
    lane === 'generation' ? PLANNING_JOB_TYPES : undefined,
  )
  if (!job) return false
  try {
    await jobService.markRunning(job.id)
    await executeJob(job.id, job.type, job.inputJson)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // 确定性失败（前置条件不满足）fail-fast：立即终态 + 用户可见指引，不烧重试
    const retryable = !(e instanceof NonRetryableJobError)
    const outcome = await jobService.fail(job.id, message, { retryable })
    console.warn(`[worker:${lane ?? 'any'}] Job ${job.id}（${job.type}）${retryable ? '失败' : '确定性失败（不重试）'} → ${outcome}：${message}`)
  }
  return true
}

export async function runOneTick(lane?: 'planning' | 'generation'): Promise<boolean> {
  // requeueStale 幂等；双通道下只在生成通道执行（规划通道省一次全表扫）
  if (lane !== 'planning') await jobService.requeueStale()
  return claimAndExecute(lane)
}

/** 启动后台双通道循环（Next.js instrumentation 调用；模块级守卫防 dev 热重载双启） */
export function startWorker(): void {
  if (process.env.IMAGINEOS_DISABLE_WORKER === '1') return
  const g = globalThis as typeof globalThis & { [k: string]: unknown }
  const state = g[WORKER_GLOBAL_KEY] as { started: boolean; timers?: NodeJS.Timeout[] } | undefined
  if (state?.started) return
  g[WORKER_GLOBAL_KEY] = { started: true }

  let ticks = 0

  // 规划通道：每轮最多消化 2 个规划 Job（LLM 短任务快消化）
  const planningLoop = async () => {
    try {
      for (let i = 0; i < 2; i++) {
        const had = await claimAndExecute('planning')
        if (!had) break
      }
    } catch (e) {
      console.warn('[worker:planning] tick 异常（下一轮继续）：', e instanceof Error ? e.message : e)
    }
  }

  // 生成通道：每轮最多消化 3 个生成 Job（防长任务阻塞心跳语义）+ 看门狗
  const generationLoop = async () => {
    try {
      await jobService.requeueStale()
      for (let i = 0; i < 3; i++) {
        const had = await claimAndExecute('generation')
        if (!had) break
      }
      // 看门狗：孤儿 GENERATING/RENDERING（无活跃 Job 且静默超时）→ 标记失败，永不无限转圈
      if (ticks % WATCHDOG_EVERY_TICKS === 0) {
        const marked = await jobService.sweepOrphanedGenerations()
        if (marked > 0) console.warn(`[watchdog] 标记 ${marked} 个长期无进展的生成（GENERATING/RENDERING 孤儿）为超时失败`)
      }
      ticks++
    } catch (e) {
      console.warn('[worker:generation] tick 异常（下一轮继续）：', e instanceof Error ? e.message : e)
    }
  }

  const planningTimer = setInterval(() => void planningLoop(), TICK_INTERVAL_MS)
  const generationTimer = setInterval(() => void generationLoop(), TICK_INTERVAL_MS)
  planningTimer.unref?.()
  generationTimer.unref?.()
  g[WORKER_GLOBAL_KEY] = { started: true, timers: [planningTimer, generationTimer] }
  console.log('[ImagineOS] generation worker 已启动（双通道：规划 + 生成，tick = 2.5s，watchdog = 30s）')
}

export function stopWorker(): void {
  const g = globalThis as typeof globalThis & { [k: string]: unknown }
  const state = g[WORKER_GLOBAL_KEY] as { started: boolean; timers?: NodeJS.Timeout[] } | undefined
  for (const t of state?.timers ?? []) clearInterval(t)
  if (g[WORKER_GLOBAL_KEY]) g[WORKER_GLOBAL_KEY] = { started: false }
}
