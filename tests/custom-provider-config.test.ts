// 自定义模型服务配置测试（ADR-0004 / M1.5 Phase B 解锁）
// 覆盖：链构建（优先级/停用排除/z-ai 兜底）/ 掩码工具 / OpenAI 兼容适配器请求形态。
// 铁律：全部 mock fetch，绝不触网。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildChainsFromConfigs } from '@/ai/router/registry'
import { joinUrl, maskApiKey, isMaskedKey } from '@/core/settings/provider-config-service'
import type { ProviderConfigRow } from '@/core/settings/provider-config-service'
import { buildProviderFromConfig } from '@/ai/providers/openai-compat'
import type { ProviderCallContext } from '@/ai/router/types'

const ctx: ProviderCallContext = { contentId: 'test-content', versionId: null, purpose: 'test' }

function makeRow(overrides: Partial<ProviderConfigRow>): ProviderConfigRow {
  return {
    id: 'cfg-1',
    channel: 'llm',
    label: '测试服务',
    providerType: 'openai-compat',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test-1234567890abcdef',
    modelName: 'test-model',
    extraJson: null,
    enabled: true,
    priority: 100,
    lastTestStatus: null,
    lastTestMessage: null,
    lastTestedAt: null,
    createdAt: new Date('2026-10-06T00:00:00Z'),
    updatedAt: new Date('2026-10-06T00:00:00Z'),
    ...overrides,
  }
}

describe('链构建 buildChainsFromConfigs', () => {
  it('无配置 → 四条链均为空（生产侧由 ensureChainsFresh 兜底 z-ai）', () => {
    const chains = buildChainsFromConfigs([])
    expect(chains.text).toHaveLength(0)
    expect(chains.image).toHaveLength(0)
    expect(chains.audio).toHaveLength(0)
    expect(chains.video).toHaveLength(0)
  })

  it('自定义按 priority 升序入链；停用项排除', () => {
    const chains = buildChainsFromConfigs([
      makeRow({ id: 'a', channel: 'llm', label: '低优先', priority: 200 }),
      makeRow({ id: 'b', channel: 'llm', label: '高优先', priority: 10 }),
      makeRow({ id: 'c', channel: 'llm', label: '停用', priority: 5, enabled: false }),
    ])
    expect(chains.text.map((p) => p.id)).toEqual(['openai-compat:高优先', 'openai-compat:低优先'])
  })

  it('四通道各归其链，provider.id/model 来自配置', () => {
    const chains = buildChainsFromConfigs([
      makeRow({ id: 'l', channel: 'llm', label: '对话', modelName: 'deepseek-chat' }),
      makeRow({ id: 'i', channel: 'image', label: '画面', modelName: 'kolors' }),
      makeRow({ id: 't', channel: 'tts', label: '配音', modelName: 'tts-1' }),
      makeRow({ id: 'v', channel: 'video', label: '视频', modelName: 'wan2' }),
    ])
    expect(chains.text[0]?.model).toBe('deepseek-chat')
    expect(chains.image[0]?.model).toBe('kolors')
    expect(chains.audio[0]?.model).toBe('tts-1')
    expect(chains.video[0]?.model).toBe('wan2')
  })

  it('未知通道返回 null（不进链）', () => {
    expect(buildProviderFromConfig(makeRow({ channel: 'unknown' }))).toBeNull()
  })
})

describe('掩码工具', () => {
  it('长密钥保留前3后4，短密钥全掩', () => {
    expect(maskApiKey('sk-abcdefgh12345678')).toBe('sk-••••••••5678')
    expect(maskApiKey('short')).toBe('••••••••')
  })
  it('isMaskedKey 识别掩码哨兵', () => {
    expect(isMaskedKey('sk-••••••••5678')).toBe(true)
    expect(isMaskedKey('sk-real-key-123')).toBe(false)
  })
  it('joinUrl 容忍尾斜杠', () => {
    expect(joinUrl('https://a.com/v1/', '/models')).toBe('https://a.com/v1/models')
    expect(joinUrl('https://a.com/v1', '/models')).toBe('https://a.com/v1/models')
  })
})

describe('OpenAI 兼容适配器（mock fetch，不触网）', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('LLM：POST {base}/chat/completions，带 Bearer 头，解析 choices 与 usage', async () => {
    const spy = vi.fn(async (url: string | URL, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '这是计划' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
    globalThis.fetch = spy as unknown as typeof fetch

    const provider = buildProviderFromConfig(makeRow({ channel: 'llm' }))
    if (!provider || provider.capability !== 'text.plan') throw new Error('应构建 LLM provider')
    const result = await provider.execute({ system: 's', user: 'u' }, ctx)
    expect(result.text).toBe('这是计划')
    expect(result.usage?.totalTokens).toBe(15)

    const calls = spy.mock.calls as unknown as Array<[string, RequestInit]>
    const first = calls[0]
    const [calledUrl, init] = first ?? ['', {} as RequestInit]
    expect(String(calledUrl)).toBe('https://api.example.com/v1/chat/completions')
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test-1234567890abcdef')
    expect(JSON.parse(String(init?.body)).model).toBe('test-model')
  })

  it('LLM 401 → 错误信息含服务名与状态码（供 isNonRetryable 立即降级）', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'invalid api key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch
    const provider = buildProviderFromConfig(makeRow({ channel: 'llm', label: '坏钥匙' }))
    if (!provider || provider.capability !== 'text.plan') throw new Error('应构建 LLM provider')
    await expect(provider.execute({ system: 's', user: 'u' }, ctx)).rejects.toThrow(/401|invalid api key/)
  })

  it('图像：解析 OpenAI b64_json 形态；size 默认取 payload', async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('fake-png').toString('base64').padEnd(120, 'x') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    globalThis.fetch = spy as unknown as typeof fetch
    const provider = buildProviderFromConfig(makeRow({ channel: 'image' }))
    if (!provider || provider.capability !== 'image.shot') throw new Error('应构建图像 provider')
    const result = await provider.execute({ prompt: 'p', size: '768x1344' }, ctx)
    expect(result.mime).toBe('image/png')
    const calls = spy.mock.calls as unknown as Array<[string, RequestInit]>
    const first = calls[0]
    const [, init] = first ?? ['', {} as RequestInit]
    expect(JSON.parse(String(init?.body)).size).toBe('768x1344')
  })

  it('图像：URL 形态 → 自动下载转 base64', async () => {
    let call = 0
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      call++
      if (call === 1) {
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/img.png' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(new Uint8Array(2048).buffer, { status: 200, headers: { 'content-type': 'image/png' } })
    }) as unknown as typeof fetch
    const provider = buildProviderFromConfig(makeRow({ channel: 'image' }))
    if (!provider || provider.capability !== 'image.shot') throw new Error('应构建图像 provider')
    const result = await provider.execute({ prompt: 'p', size: '768x1344' }, ctx)
    expect(result.base64.length).toBeGreaterThan(100)
  })

  it('TTS：POST {base}/audio/speech，二进制响应转 base64，附加参数 voice 生效', async () => {
    const spy = vi.fn(async () =>
      new Response(new Uint8Array(4096).buffer, { status: 200, headers: { 'content-type': 'audio/wav' } }),
    )
    globalThis.fetch = spy as unknown as typeof fetch
    const provider = buildProviderFromConfig(makeRow({ channel: 'tts', extraJson: '{"voice":"alloy"}' }))
    if (!provider || provider.capability !== 'audio.tts') throw new Error('应构建 TTS provider')
    const result = await provider.execute({ text: '你好' }, ctx)
    expect(result.mime).toBe('audio/wav')
    const calls = spy.mock.calls as unknown as Array<[string, RequestInit]>
    const first = calls[0]
    const [, init] = first ?? ['', {} as RequestInit]
    const body = JSON.parse(String(init?.body))
    expect(body.voice).toBe('alloy')
    expect(body.response_format).toBe('wav')
  })

  it('视频：submit → 轮询 SUCCEEDED → 下载，全程 URL 正确', async () => {
    const calls: string[] = []
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      const u = String(url)
      calls.push(u)
      if (u.endsWith('/video/submit')) {
        return new Response(JSON.stringify({ requestId: 'req-1' }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (u.includes('/video/status')) {
        return new Response(JSON.stringify({ status: 'SUCCEEDED', results: { videos: [{ url: 'https://cdn.example.com/v.mp4' }] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(new Uint8Array(65536).buffer, { status: 200, headers: { 'content-type': 'video/mp4' } })
    }) as unknown as typeof fetch

    const provider = buildProviderFromConfig(makeRow({ channel: 'video' }))
    if (!provider || provider.capability !== 'video.shot') throw new Error('应构建视频 provider')
    const result = await provider.execute({ prompt: 'p', imageUrl: 'data:image/png;base64,xx' }, ctx)
    expect(result.mime).toBe('video/mp4')
    expect(calls[0]).toBe('https://api.example.com/v1/video/submit')
    expect(calls[1]).toContain('/video/status?requestId=req-1')
    expect(calls[2]).toBe('https://cdn.example.com/v.mp4')
  })

  it('视频：submit 成功但无 requestId → 明确报不兼容（供降级判定）', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ foo: 'bar' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch
    const provider = buildProviderFromConfig(makeRow({ channel: 'video' }))
    if (!provider || provider.capability !== 'video.shot') throw new Error('应构建视频 provider')
    await expect(provider.execute({ prompt: 'p', imageUrl: 'data:' }, ctx)).rejects.toThrow(/不兼容|requestId/)
  })
})
