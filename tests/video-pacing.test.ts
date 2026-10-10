// 节奏化视频调度器回归测试（quality-repro-023，设计 docs/design/quality-reproduction.md §3.2）
// 背景：agnes 免费档视频 RPM=1——相邻提交间隔 < 60s → 429 → 旧版回落 Ken Burns（已取缔）。
// pacer 在 serializer 互斥之上保证提交间隔 ≥ gap。锁定语义：
//   1. 提交间隔保证（相邻调用起点间隔 ≥ minGapMs——时钟注入观测）
//   2. 互斥保持（RPM=1 通道永不并发）
//   3. 失败传播不废队列
//   4. 首次调用零等待（nextAllowedSubmitAt 初始为 0）
//   5. nextSubmitWaitMs 可观测（进度叙事数据源）
//   6. env 动态覆盖（videoSubmitGapMs 运行时可调，测试 1ms 不真等 61s）
// 铁律：注入时钟/瞬时睡眠，零真实等待、绝不触网。
import { describe, it, expect, afterEach } from 'vitest'
import { createPacedVideoScheduler, videoSubmitGapMs, DEFAULT_VIDEO_SUBMIT_GAP_MS } from '@/ai/router/video-pacer'

/** 可控时钟 + 记录式睡眠 */
function makeHarness() {
  let now = 1_000_000
  const sleeps: number[] = []
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      now += ms // 睡眠即时间流逝（零真实等待）
    },
    advance: (ms: number) => (now += ms),
    sleeps,
    clock: () => now,
  }
}

afterEach(() => {
  delete process.env.IMAGINEOS_VIDEO_SUBMIT_GAP_MS
})

describe('createPacedVideoScheduler（RPM=1 提交节奏）', () => {
  it('相邻提交起点间隔 ≥ minGapMs（快速完成的前序不再引发后序 429）', async () => {
    const h = makeHarness()
    const paced = createPacedVideoScheduler({ minGapMs: 61_000, now: h.now, sleep: h.sleep })
    const starts: number[] = []
    await Promise.all([
      paced(async () => {
        starts.push(h.clock())
        h.advance(45_000) // 前序视频 45s 即完成（< 60s RPM 窗口——旧版 429 根因场景）
        return 'a'
      }),
      paced(async () => {
        starts.push(h.clock())
        h.advance(10_000)
        return 'b'
      }),
    ])
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(61_000) // 节奏对齐：后序等到窗口外才提交
  })

  it('互斥保持：任一时刻至多 1 个在执行（serializer 语义不回归）', async () => {
    const h = makeHarness()
    const paced = createPacedVideoScheduler({ minGapMs: 100, now: h.now, sleep: h.sleep })
    let active = 0
    let maxActive = 0
    await Promise.all([
      paced(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        h.advance(50)
        active--
      }),
      paced(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        h.advance(50)
        active--
      }),
    ])
    expect(maxActive).toBe(1)
  })

  it('首次调用零等待（nextAllowedSubmitAt 初始为 0）', async () => {
    const h = makeHarness()
    const paced = createPacedVideoScheduler({ minGapMs: 61_000, now: h.now, sleep: h.sleep })
    await paced(async () => 'ok')
    expect(h.sleeps).toEqual([]) // 第一次提交不等待
  })

  it('前序失败不废队列：错误传播后序照常（等节奏后提交）', async () => {
    const h = makeHarness()
    const paced = createPacedVideoScheduler({ minGapMs: 61_000, now: h.now, sleep: h.sleep })
    const first = paced(async () => {
      throw new Error('video_queue_full')
    }).catch((e: Error) => e.message)
    const second = paced(async () => 'ok')
    expect(await first).toBe('video_queue_full')
    expect(await second).toBe('ok')
    expect(h.sleeps[0]).toBe(61_000) // 后序仍守节奏（失败不等于可以抢跑砸限流）
  })

  it('nextSubmitWaitMs 可观测（进度叙事「排队中，还需 Ns」数据源）', async () => {
    const h = makeHarness()
    const paced = createPacedVideoScheduler({ minGapMs: 61_000, now: h.now, sleep: h.sleep })
    expect(paced.nextSubmitWaitMs()).toBe(0)
    await paced(async () => 'first')
    expect(paced.nextSubmitWaitMs()).toBe(61_000)
    h.advance(20_000)
    expect(paced.nextSubmitWaitMs()).toBe(41_000)
  })
})

describe('videoSubmitGapMs（env 动态覆盖：运行时可调）', () => {
  it('缺省 61s；env 合法值运行时生效；非法值回缺省', () => {
    expect(videoSubmitGapMs()).toBe(DEFAULT_VIDEO_SUBMIT_GAP_MS)
    process.env.IMAGINEOS_VIDEO_SUBMIT_GAP_MS = '1'
    expect(videoSubmitGapMs()).toBe(1)
    process.env.IMAGINEOS_VIDEO_SUBMIT_GAP_MS = 'abc'
    expect(videoSubmitGapMs()).toBe(DEFAULT_VIDEO_SUBMIT_GAP_MS)
    process.env.IMAGINEOS_VIDEO_SUBMIT_GAP_MS = '-5'
    expect(videoSubmitGapMs()).toBe(DEFAULT_VIDEO_SUBMIT_GAP_MS)
  })

  it('pacer 未显式传 gap 时动态读 env（测试 1ms 不真等 61s）', async () => {
    process.env.IMAGINEOS_VIDEO_SUBMIT_GAP_MS = '1'
    const h = makeHarness()
    const paced = createPacedVideoScheduler({ now: h.now, sleep: h.sleep })
    await paced(async () => 'a')
    await paced(async () => 'b')
    expect(h.sleeps).toEqual([1]) // 第二次调用只等 1ms——env 生效于调用时刻
  })
})
