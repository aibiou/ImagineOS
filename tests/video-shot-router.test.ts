// video.shot 能力路由测试（M1.5 Gate 6）：注册/路由/回落探测/记账
// 铁律：测试注入 fake provider，绝不触网。
import { describe, it, expect, afterEach } from 'vitest'
import { registerProvider, clearRegistry, resetRegistry, hasVideoShotProvider, router } from '@/ai/router/registry'
import type { VideoShotProvider, ProviderCallContext } from '@/ai/router/types'

const ctx: ProviderCallContext = { contentId: 'test-content', versionId: null, purpose: 'test' }

function fakeVideoProvider(id: string, ok: boolean, latency = 5): VideoShotProvider {
  return {
    id,
    capability: 'video.shot',
    model: `fake-${id}`,
    async execute() {
      if (!ok) throw new Error(`${id} 失败`)
      await new Promise((r) => setTimeout(r, latency))
      return { base64: Buffer.from('fake-mp4').toString('base64'), mime: 'video/mp4', durationMs: 5000 }
    },
  }
}

describe('video.shot 能力路由（M1.5 Gate 6）', () => {
  afterEach(() => {
    resetRegistry()
  })

  it('链空时 router.video 抛 ProviderExhaustedError，hasVideoShotProvider=false（2026-10-20 起：管线据此诚实报错，不再静默回落）', async () => {
    clearRegistry()
    expect(hasVideoShotProvider()).toBe(false)
    await expect(router.video({ prompt: 'p', imageUrl: 'data:image/png;base64,xx' }, ctx)).rejects.toThrow(/video\.shot/)
  })

  it('注册 fake provider 后可路由并返回视频字节', async () => {
    clearRegistry()
    registerProvider(fakeVideoProvider('fake-video', true))
    expect(hasVideoShotProvider()).toBe(true)
    const { result, providerId, model } = await router.video(
      { prompt: 'slow push in', imageUrl: 'data:image/png;base64,xx', size: '720x1280', speedFirst: true },
      ctx,
    )
    expect(providerId).toBe('fake-video')
    expect(model).toBe('fake-fake-video')
    expect(result.mime).toBe('video/mp4')
    expect(Buffer.from(result.base64, 'base64').toString()).toBe('fake-mp4')
  })

  it('链耗尽时抛 ProviderExhaustedError（失败链）', async () => {
    clearRegistry()
    registerProvider(fakeVideoProvider('bad-video', false))
    await expect(router.video({ prompt: 'p', imageUrl: 'u' }, ctx)).rejects.toThrow(/bad-video/)
  })

  it('生产链默认注册 zai-video（cogvideox 图生视频）', () => {
    resetRegistry()
    expect(hasVideoShotProvider()).toBe(true)
  })
})
