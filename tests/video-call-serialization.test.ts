// native 视频调用串行化回归测试（gate7-core-native-013，2026-10-08）
// 根因：storyboard 管线 IMAGE_CONCURRENCY=2 使两镜视频并发提交，zai key 视频并发=1
// （E2E 账本实证 429 三连烧穿退避）→ 逐镜回落合成。修复：createCallSerializer 串行化。
// 铁律：纯时序测试，绝不触网。
import { describe, it, expect } from 'vitest'
import { createCallSerializer } from '@/ai/router/call-serializer'

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('createCallSerializer（native 视频提交互斥）', () => {
  it('并发包装的调用整体互斥：任一时刻至多 1 个在执行', async () => {
    const serialize = createCallSerializer()
    let active = 0
    let maxActive = 0
    const task = (id: number) =>
      serialize(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await tick(25)
        active--
        return id
      })
    const results = await Promise.all([task(1), task(2), task(3), task(4)])
    expect(results).toEqual([1, 2, 3, 4])
    expect(maxActive).toBe(1) // 互斥成立：zai 视频并发=1 的通道不再互踩 429
  })

  it('前序失败不阻塞后序（错误各自传播，队列不废）', async () => {
    const serialize = createCallSerializer()
    const first = serialize(async () => {
      throw new Error('429 Too many requests')
    }).catch((e: Error) => e.message)
    const second = serialize(async () => 'ok')
    expect(await first).toBe('429 Too many requests')
    expect(await second).toBe('ok')
  })

  it('执行顺序 = 提交顺序（FIFO，镜头次序可预测）', async () => {
    const serialize = createCallSerializer()
    const order: number[] = []
    await Promise.all([
      serialize(async () => {
        await tick(30)
        order.push(1)
      }),
      serialize(async () => {
        order.push(2)
      }),
      serialize(async () => {
        await tick(5)
        order.push(3)
      }),
    ])
    expect(order).toEqual([1, 2, 3])
  })

  it('多实例互不影响（未来按 provider 分键串行化的扩展位）', async () => {
    const a = createCallSerializer()
    const b = createCallSerializer()
    let active = 0
    let maxActive = 0
    const wrapped = (s: ReturnType<typeof createCallSerializer>) =>
      s(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await tick(20)
        active--
      })
    await Promise.all([wrapped(a), wrapped(b)])
    expect(maxActive).toBe(2) // 不同实例各自独立
  })
})
