// 自定义模型服务配置测试（ADR-0004 / M1.5 Phase B 解锁）
// 覆盖：链构建（优先级/停用排除/z-ai 兜底）/ 掩码工具 / OpenAI 兼容适配器请求形态
//      / 模型列表拉取 / 分通道模型真实验证 / 模型目录排序。
// 铁律：全部 mock fetch，绝不触网。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildChainsFromConfigs } from '@/ai/router/registry'
import {
  joinUrl,
  maskApiKey,
  isMaskedKey,
  fetchAvailableModels,
  verifyModelForChannel,
} from '@/core/settings/provider-config-service'
import { sortModelsForChannel } from '@/lib/model-catalog'
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

describe('模型列表拉取 fetchAvailableModels（mock fetch）', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('解析 {data:[{id}]} 与字符串数组两种形态', async () => {
    let call = 0
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      call++
      if (call === 1) {
        return new Response(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ data: ['m3', 'm4'] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    const r1 = await fetchAvailableModels({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-1234567890' })
    expect(r1.ok).toBe(true)
    expect(r1.models).toEqual(['m1', 'm2'])
    expect(String((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toBe('https://api.example.com/v1/models')

    const r2 = await fetchAvailableModels({ baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-test-1234567890' })
    expect(r2.models).toEqual(['m3', 'm4'])
  })

  it('401 → 密钥无效；404 → 提示手填；请求头带 Bearer', async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401, headers: { 'content-type': 'application/json' } }))
    globalThis.fetch = spy as unknown as typeof fetch
    const r1 = await fetchAvailableModels({ baseUrl: 'https://a.com/v1', apiKey: 'sk-test-1234567890' })
    expect(r1.ok).toBe(false)
    expect(r1.message).toContain('密钥无效')

    globalThis.fetch = vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch
    const r2 = await fetchAvailableModels({ baseUrl: 'https://a.com/v1', apiKey: 'sk-test-1234567890' })
    expect(r2.ok).toBe(false)
    expect(r2.message).toContain('手动填写')

    const calls = spy.mock.calls as unknown as Array<[string, RequestInit]>
    const [, init] = calls[0] ?? ['', {} as RequestInit]
    expect((init?.headers as Record<string, string>)['Authorization']).toMatch(/^Bearer sk-/)
  })
})

describe('模型真实验证 verifyModelForChannel（mock fetch）', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  const base = { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-1234567890', modelName: 'test-model', extraJson: null }

  it('llm：POST /chat/completions 真实对话，max_tokens 极小，解析回复', async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    globalThis.fetch = spy as unknown as typeof fetch
    const r = await verifyModelForChannel('llm', base)
    expect(r.ok).toBe(true)
    expect(r.detail).toContain('真实对话成功')
    expect(r.detail).toContain('OK')
    const calls = spy.mock.calls as unknown as Array<[string, RequestInit]>
    const [url, init] = calls[0] ?? ['', {} as RequestInit]
    expect(String(url)).toBe('https://api.example.com/v1/chat/completions')
    const body = JSON.parse(String(init?.body))
    expect(body.model).toBe('test-model')
    expect(body.max_tokens).toBeLessThanOrEqual(16)
  })

  it('llm 404 → 明确「模型不存在或不可用」', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    const r = await verifyModelForChannel('llm', base)
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('模型不存在')
    expect(r.detail).toContain('model not found')
  })

  it('tts：POST /audio/speech 二进制音频 → 字节数回报', async () => {
    const spy = vi.fn(async () =>
      new Response(new Uint8Array(4096).buffer, { status: 200, headers: { 'content-type': 'audio/wav' } }))
    globalThis.fetch = spy as unknown as typeof fetch
    const r = await verifyModelForChannel('tts', base)
    expect(r.ok).toBe(true)
    expect(r.detail).toContain('4096 字节')
    const calls = spy.mock.calls as unknown as Array<[string, RequestInit]>
    expect(String(calls[0]?.[0])).toBe('https://api.example.com/v1/audio/speech')
  })

  it('tts 返回过短 → 判失败', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(new Uint8Array(100).buffer, { status: 200, headers: { 'content-type': 'audio/wav' } })) as unknown as typeof fetch
    const r = await verifyModelForChannel('tts', base)
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('音频异常')
  })

  it('image：POST /images/generations 真实生图 → 消耗提示', async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ b64_json: 'x'.repeat(200) }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    globalThis.fetch = spy as unknown as typeof fetch
    const r = await verifyModelForChannel('image', base)
    expect(r.ok).toBe(true)
    expect(r.detail).toContain('真实生成成功')
    expect(r.detail).toContain('消耗')
    const calls = spy.mock.calls as unknown as Array<[string, RequestInit]>
    expect(String(calls[0]?.[0])).toBe('https://api.example.com/v1/images/generations')
    expect(JSON.parse(String(calls[0]?.[1]?.body)).model).toBe('test-model')
  })

  it('image：200 但无图像数据 → 判失败（模型不支持生图）', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{}] }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    const r = await verifyModelForChannel('image', base)
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('不支持生图')
  })

  it('video：不做真实生成（仅一次 /models 调用都不发起），按列表存在性说明', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    globalThis.fetch = spy
    const videoBase = { ...base, modelName: 'Wan2.2-T2V-A14B' }
    const rIn = await verifyModelForChannel('video', videoBase, ['Wan2.2-T2V-A14B'])
    expect(rIn.ok).toBe(true)
    expect(rIn.detail).toContain('模型在服务列表中')
    const rOut = await verifyModelForChannel('video', base, ['other-model'])
    expect(rOut.ok).toBe(true)
    expect(rOut.detail).toContain('未见该模型')
    const rNoList = await verifyModelForChannel('video', base, [])
    expect(rNoList.ok).toBe(true)
    expect(rNoList.detail).toContain('跳过实调')
    // 全程零真实生成请求
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('模型目录排序 sortModelsForChannel', () => {
  it('image 通道：生图模型进推荐组，对话模型归其他', () => {
    const g = sortModelsForChannel('image', ['deepseek-chat', 'Kwai-Kolors/Kolors', 'text-embedding-3-large', 'cogview-3-flash'])
    expect(g.recommended).toContain('Kwai-Kolors/Kolors')
    expect(g.recommended).toContain('cogview-3-flash')
    expect(g.others).toContain('deepseek-chat')
    expect(g.others).toContain('text-embedding-3-large')
  })

  it('llm 通道：对话模型推荐；嵌入/TTS/生图被排除到其他（含 gpt-image 误匹配防护）', () => {
    const g = sortModelsForChannel('llm', ['deepseek-chat', 'gpt-4o-mini', 'text-embedding-3-large', 'gpt-image-1', 'gpt-4o-mini-tts', 'Qwen/Qwen2.5-72B-Instruct'])
    expect(g.recommended).toContain('deepseek-chat')
    expect(g.recommended).toContain('gpt-4o-mini')
    expect(g.recommended).toContain('Qwen/Qwen2.5-72B-Instruct')
    expect(g.others).toContain('text-embedding-3-large')
    expect(g.others).toContain('gpt-image-1')
    expect(g.others).toContain('gpt-4o-mini-tts')
  })

  it('tts / video 通道分组；未知通道全部归其他', () => {
    const t = sortModelsForChannel('tts', ['gpt-4o-mini-tts', 'FunAudioLLM/CosyVoice2-0.5B', 'deepseek-chat'])
    expect(t.recommended).toHaveLength(2)
    const v = sortModelsForChannel('video', ['Wan2.2-T2V-A14B', 'cogvideox-3', 'deepseek-chat'])
    expect(v.recommended).toHaveLength(2)
    const u = sortModelsForChannel('unknown', ['a', 'b'])
    expect(u.recommended).toHaveLength(0)
    expect(u.others).toHaveLength(2)
  })
})
