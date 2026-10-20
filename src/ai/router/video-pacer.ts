// 节奏化视频调度器（设计见 docs/design/quality-reproduction.md §3.2）
// 根因：agnes 免费档视频 RPM=1——相邻两次提交间隔可能 < 60s（前序视频 45s 完成即提交后序）
// → 429 → 60s 冷却重试可能耗尽 → 旧版逐镜回落 Ken Burns（已取缔）。
// 语义：在 call-serializer 互斥之上追加「提交间隔下限」——每次调用前等待 nextAllowedSubmitAt，
// 调用即置 nextAllowedSubmitAt = now + gap。提交节奏与 RPM 窗口对齐后，429 从常态变意外
// （router 内既有冷却重试继续兜底）。
// 代价（诚实）：5 镜 native ≈ 4×61s 间隔 + 出片 ≈ 5-6 分钟——RPM=1 的物理下限。
// gap 动态读 env（IMAGINEOS_VIDEO_SUBMIT_GAP_MS，默认 61s）：双站视频轮转后可减半；测试可调 1ms。
// 时钟/睡眠可注入（测试零等待）。

import { createCallSerializer, type CallSerializer } from './call-serializer'

export const DEFAULT_VIDEO_SUBMIT_GAP_MS = 61_000

/** 动态读取提交间隔（测试可运行时覆盖） */
export function videoSubmitGapMs(): number {
  const env = Number(process.env.IMAGINEOS_VIDEO_SUBMIT_GAP_MS)
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_VIDEO_SUBMIT_GAP_MS
}

export interface PacedSchedulerOptions {
  /** 相邻两次提交的最小间隔（毫秒）；缺省动态读 env */
  minGapMs?: number
  /** 可注入时钟（默认 Date.now；测试用） */
  now?: () => number
  /** 可注入睡眠（默认真实 setTimeout；测试用瞬时桩） */
  sleep?: (ms: number) => Promise<void>
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface PacedScheduler {
  <T>(fn: () => Promise<T>): Promise<T>
  /** 距下一次允许提交还需多久（进度叙事用；≤0 表示立即可提交） */
  nextSubmitWaitMs(): number
}

/** 创建节奏化串行调度器：同实例调用永不并发，且提交间隔 ≥ minGapMs（缺省动态 env） */
export function createPacedVideoScheduler(opts: PacedSchedulerOptions = {}): PacedScheduler {
  const fixedGap = opts.minGapMs
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? defaultSleep
  const serialize: CallSerializer = createCallSerializer()
  let nextAllowedSubmitAt = 0
  const paced = <T>(fn: () => Promise<T>): Promise<T> =>
    serialize(async () => {
      const gap = fixedGap ?? videoSubmitGapMs()
      const wait = nextAllowedSubmitAt - now()
      if (wait > 0) await sleep(wait)
      nextAllowedSubmitAt = now() + gap
      return fn()
    })
  paced.nextSubmitWaitMs = () => Math.max(0, nextAllowedSubmitAt - now())
  return paced
}
