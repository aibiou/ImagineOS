// 限速感知调度（双免费额度轮转 + 429 冷却）回归测试，2026-10-07
// 背景：agnes-com / agnes-cn 双站点免费额度（官方免费档：文本 RPM 10 / 图片 1K RPM 10 / 视频 RPM 1）。
// 调度三层策略：同优先级轮转均匀消耗 → 429 冷却排链尾 → 非末位候选限速快速让位。
// 铁律：fake provider 注入，绝不触网。
import { describe, it, expect, afterEach } from 'vitest'
import { registerProvider, clearRegistry, resetRegistry, router, orderCandidates, rateCooldownSnapshot } from '@/ai/router/registry'
import type { ImageShotProvider, ProviderCallContext } from '@/ai/router/types'

const ctx: ProviderCallContext = { contentId: 'test-content', versionId: null, purpose: 'test' }

function fakeImage(id: string, behavior: () => Promise<{ base64: string; mime: string }>): ImageShotProvider {
  return {
    id,
    capability: 'image.shot',
    model: `fake-${id}`,
    async execute() {
      return behavior()
    },
  }
}

const okImage = () => ({ base64: 'x'.repeat(200), mime: 'image/png' })

describe('orderCandidates（纯函数：轮转 + 冷却重排）', () => {
  const chain = [{ id: 'A' }, { id: 'B' }, { id: 'zai' }]

  it('无轮转组 → 原序不变', () => {
    expect(orderCandidates(chain, {}).map((p) => p.id)).toEqual(['A', 'B', 'zai'])
  })

  it('轮转组 [A,B] offset=1 → B 先行，zai 兜底位不动', () => {
    expect(orderCandidates(chain, { rotationGroups: [['A', 'B']], rotationOffset: 1 }).map((p) => p.id)).toEqual(['B', 'A', 'zai'])
  })

  it('offset=组长度 → 回到原序（取模归零）', () => {
    expect(orderCandidates(chain, { rotationGroups: [['A', 'B']], rotationOffset: 2 }).map((p) => p.id)).toEqual(['A', 'B', 'zai'])
  })

  it('冷却 A（未过期）→ A 排链尾', () => {
    const cd = new Map([['A', Date.now() + 30_000]])
    expect(orderCandidates(chain, { cooldowns: cd }).map((p) => p.id)).toEqual(['B', 'zai', 'A'])
  })

  it('冷却已过期 → 原序（冷却窗口结束即恢复）', () => {
    const cd = new Map([['A', Date.now() - 1000]])
    expect(orderCandidates(chain, { cooldowns: cd }).map((p) => p.id)).toEqual(['A', 'B', 'zai'])
  })

  it('全员冷却 → 原序（不作弊式拉黑：全冷却时照常尝试）', () => {
    const now = Date.now()
    const cd = new Map([['A', now + 30_000], ['B', now + 30_000], ['zai', now + 30_000]])
    expect(orderCandidates(chain, { cooldowns: cd }).map((p) => p.id)).toEqual(['A', 'B', 'zai'])
  })

  it('组员不在链中 → 原序（脏容错）', () => {
    expect(orderCandidates(chain, { rotationGroups: [['X', 'Y']], rotationOffset: 1 }).map((p) => p.id)).toEqual(['A', 'B', 'zai'])
  })

  it('轮转与冷却叠加：B 冷却 → A,zai,B（组内轮转被冷却覆盖为安全序）', () => {
    const cd = new Map([['B', Date.now() + 30_000]])
    expect(orderCandidates(chain, { rotationGroups: [['A', 'B']], rotationOffset: 1, cooldowns: cd }).map((p) => p.id)).toEqual(['A', 'zai', 'B'])
  })
})

describe('router 限速快速让位与冷却（fake provider，绝不触网）', () => {
  afterEach(() => resetRegistry())

  it('非末位候选 429 → 1 次尝试即让位（不烧退避重试），下一候选接住', async () => {
    clearRegistry()
    let aAttempts = 0
    const a = fakeImage('a-limited', async () => {
      aAttempts++
      throw new Error('HTTP 429: Too Many Requests')
    })
    const b = fakeImage('b-ok', async () => okImage())
    registerProvider(a)
    registerProvider(b, { prepend: false }) // 链序 [a, b]
    const t0 = Date.now()
    const { providerId } = await router.image({ prompt: 'p', size: '768x1344' }, ctx)
    const elapsed = Date.now() - t0
    expect(providerId).toBe('b-ok')
    expect(aAttempts).toBe(1) // 快速让位：a 只被尝试 1 次
    expect(elapsed).toBeLessThan(500) // 连第一次退避（600ms）都没等
    expect(rateCooldownSnapshot().map((c) => c.providerId)).toContain('a-limited') // 冷却已登记
  })

  it('429 冷却生效：后续调用冷却者让位（先试健康候选）', async () => {
    clearRegistry()
    const calls: string[] = []
    const a = fakeImage('a-limited', async () => {
      calls.push('a')
      if (calls.filter((c) => c === 'a').length === 1) throw new Error('429 rate limit exceeded')
      return okImage()
    })
    const b = fakeImage('b-ok', async () => {
      calls.push('b')
      return okImage()
    })
    registerProvider(a)
    registerProvider(b, { prepend: false })
    await router.image({ prompt: 'p', size: '768x1344' }, ctx) // 第一次：a 429 → 冷却 → b 接住
    calls.length = 0
    await router.image({ prompt: 'p', size: '768x1344' }, ctx) // 第二次：a 冷却中 → b 先试
    expect(calls[0]).toBe('b')
  })

  it('末位候选 429 → 保留 3 次退避重试（单链等待恢复），耗尽后抛 ProviderExhaustedError', async () => {
    clearRegistry()
    let attempts = 0
    const solo = fakeImage('solo-limited', async () => {
      attempts++
      throw new Error('429 rate limited')
    })
    registerProvider(solo)
    await expect(router.image({ prompt: 'p', size: '768x1344' }, ctx)).rejects.toThrow(/image\.shot/)
    expect(attempts).toBe(3) // 末位候选不快速让位：完整退避重试
  }, 10_000)

  it('非限速失败（如 500）→ 行为不变：仍 3 次重试后降级', async () => {
    clearRegistry()
    let aAttempts = 0
    const a = fakeImage('a-broken', async () => {
      aAttempts++
      throw new Error('HTTP 500: server error')
    })
    const b = fakeImage('b-ok', async () => okImage())
    registerProvider(a)
    registerProvider(b, { prepend: false })
    const { providerId } = await router.image({ prompt: 'p', size: '768x1344' }, ctx)
    expect(providerId).toBe('b-ok')
    expect(aAttempts).toBe(3) // 非限速错误不受快速让位影响
  }, 10_000)
})
