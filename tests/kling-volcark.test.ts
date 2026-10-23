// 可灵 / 火山方舟视频 Provider 适配器测试（honest-video-redline-029 解药 · video-supply-030）
// 覆盖：JWT 鉴权签名 / 密钥形态解析 / 提交 body 形态（协议字段逐项断言）
//      / 轮询终态（succeed→下载 / failed→task_status_msg）/ 链构建（providerType 分发）
//      / 镜头级调度（isActionShot + klingMode pro 档）/ 参数夹取（duration/ratio/aspect_ratio）。
// 铁律：全部 mock fetch（vi.stubGlobal），绝不触网；轮询等待用 fake timers 推进。
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { buildChainsFromConfigs } from '@/ai/router/registry'
import { buildProviderFromConfig } from '@/ai/providers/openai-compat'
import {
  parseKlingCredential,
  signKlingJwt,
  klingDuration,
  klingAspectRatio,
  klingMode,
} from '@/ai/providers/kling'
import { arkDuration, arkRatio } from '@/ai/providers/volc-ark'
import { isActionShot } from '@/core/content/shot-prompt'
import type { ProviderConfigRow } from '@/core/settings/provider-config-service'
import type { ProviderCallContext, VideoShotPayload, VideoShotProvider } from '@/ai/router/types'

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
    createdAt: new Date('2026-10-24T00:00:00Z'),
    updatedAt: new Date('2026-10-24T00:00:00Z'),
    ...overrides,
  }
}

const payloadOf = (over: Partial<VideoShotPayload> = {}): VideoShotPayload => ({
  prompt: '女孩奔跑穿过麦田',
  imageUrl: 'data:image/png;base64,QUJDRA==',
  size: '1280x720',
  durationSec: 5,
  ...over,
})

// ---------- mock fetch 基建 ----------

interface Recorded {
  url: string
  method: string
  auth?: string
  body?: Record<string, unknown>
}

let recorded: Recorded[] = []
const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const videoBytes = Buffer.alloc(20_000, 7)

function stubFetch(handler: (rec: Recorded, callIndex: number) => Response | Promise<Response>) {
  recorded = []
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const rec: Recorded = {
      url: String(url),
      method: (init?.method ?? 'GET') as string,
      auth: (init?.headers as Record<string, string>)?.Authorization,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
    }
    recorded.push(rec)
    return handler(rec, recorded.length - 1)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ---------- 可灵：纯函数 ----------

describe('可灵密钥解析与 JWT 签名', () => {
  it('ak:sk 冒号形态（首个冒号分隔；sk 内含冒号不受影响）', () => {
    expect(parseKlingCredential('ak123:sk456:extra')).toEqual({ ak: 'ak123', sk: 'sk456:extra' })
  })
  it('JSON 形态 {"ak","sk"}', () => {
    expect(parseKlingCredential('{"ak":"a1","sk":"s2"}')).toEqual({ ak: 'a1', sk: 's2' })
  })
  it('无冒号/空段形态 → 明确报错（含获取指引）', () => {
    expect(() => parseKlingCredential('onlykey')).toThrow(/AccessKey:SecretKey/)
    expect(() => parseKlingCredential('bad:')).toThrow(/AccessKey:SecretKey/)
  })
  it('JWT：header HS256 / payload iss=ak / HMAC 签名可复验', () => {
    const token = signKlingJwt('ak123', 'sk456')
    const [h, p, s] = token.split('.')
    const header = JSON.parse(Buffer.from(h!, 'base64').toString()) as { alg: string; typ: string }
    const body = JSON.parse(Buffer.from(p!, 'base64').toString()) as { iss: string; exp: number; nbf: number }
    expect(header.alg).toBe('HS256')
    expect(header.typ).toBe('JWT')
    expect(body.iss).toBe('ak123')
    expect(body.exp).toBeGreaterThan(Date.now() / 1000 + 1700)
    const expectSig = Buffer.from(createHmac('sha256', 'sk456').update(`${h}.${p}`).digest())
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(s).toBe(expectSig)
  })
})

describe('可灵参数映射（纯函数）', () => {
  it('durationSec → 5/10 字符串（8s 为界；extra.duration 显式覆盖）', () => {
    expect(klingDuration(5, {})).toBe('5')
    expect(klingDuration(7, {})).toBe('5')
    expect(klingDuration(9, {})).toBe('10')
    expect(klingDuration(undefined, {})).toBe('5')
    expect(klingDuration(9, { duration: '5' })).toBe('5')
  })
  it('size → aspect_ratio 三值最近似（1280x720→16:9；720x1280→9:16；600x600→1:1）', () => {
    expect(klingAspectRatio('1280x720', {})).toBe('16:9')
    expect(klingAspectRatio('720x1280', {})).toBe('9:16')
    expect(klingAspectRatio('600x600', {})).toBe('1:1')
    expect(klingAspectRatio(undefined, {})).toBe('9:16')
    expect(klingAspectRatio('1280x720', { aspect_ratio: '1:1' })).toBe('1:1')
  })
  it('镜头级调度：speedFirst=false → pro；速度优先/缺省 → std；extra.mode 最优先', () => {
    expect(klingMode({ speedFirst: false } as VideoShotPayload, {})).toBe('pro')
    expect(klingMode({ speedFirst: true } as VideoShotPayload, {})).toBe('std')
    expect(klingMode({} as VideoShotPayload, {})).toBe('std')
    expect(klingMode({ speedFirst: false } as VideoShotPayload, { mode: 'std' })).toBe('std')
  })
})

// ---------- 可灵：执行链路（提交/轮询/下载） ----------

describe('可灵 video.shot 执行链路', () => {
  const row = makeRow({
    channel: 'video',
    providerType: 'kling',
    label: '可灵',
    baseUrl: 'https://api-beijing.klingai.com',
    apiKey: 'ak123:sk456',
    modelName: 'kling-v2-5-turbo',
  })

  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('全链成功：提交→轮询 succeed→下载；body 逐项断言（image 剥前缀/duration/mode/aspect_ratio）+ repro 落 taskId', async () => {
    let polls = 0
    stubFetch((rec) => {
      if (rec.method === 'POST' && rec.url.endsWith('/v1/videos/image2video')) {
        return jsonRes({ code: 0, data: { task_id: 'task-1', task_status: 'submitted' } })
      }
      if (rec.method === 'GET' && rec.url.includes('/v1/videos/image2video/task-1')) {
        polls += 1
        if (polls === 1) return jsonRes({ code: 0, data: { task_id: 'task-1', task_status: 'processing' } })
        return jsonRes({
          code: 0,
          data: {
            task_id: 'task-1',
            task_status: 'succeed',
            task_result: { videos: [{ id: 'v-1', url: 'https://cdn.example.com/video.mp4', duration: '5' }] },
          },
        })
      }
      if (rec.url.includes('cdn.example.com/video.mp4')) {
        return new Response(new Uint8Array(videoBytes), { status: 200, headers: { 'content-type': 'video/mp4' } })
      }
      throw new Error(`未预期的请求：${rec.method} ${rec.url}`)
    })

    const promise = (buildProviderFromConfig(row) as VideoShotProvider).execute(payloadOf({ speedFirst: false }), ctx)
    // 推进两轮轮询（4s 间隔 × 2）
    await vi.advanceTimersByTimeAsync(4_000)
    await vi.advanceTimersByTimeAsync(4_000)
    const result = await promise

    // 提交 body 断言
    const submit = recorded.find((r) => r.method === 'POST')!
    expect(submit.url).toBe('https://api-beijing.klingai.com/v1/videos/image2video')
    expect(submit.body).toMatchObject({
      model_name: 'kling-v2-5-turbo',
      image: 'QUJDRA==', // data URI 前缀已剥离（官方要求裸 Base64）
      prompt: '女孩奔跑穿过麦田',
      duration: '5',
      mode: 'pro', // speedFirst=false（动作镜头）→ pro 高表现档
      aspect_ratio: '16:9',
    })
    // 请求头为 JWT Bearer（非原始 ak:sk）
    expect(submit.auth).toMatch(/^Bearer ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)
    // 下载不带鉴权（CDN 预签名）
    const dl = recorded.find((r) => r.url.includes('cdn.example.com'))!
    expect(dl.auth).toBeUndefined()
    // 产物与 repro
    expect(result.base64).toBe(videoBytes.toString('base64'))
    expect(result.mime).toBe('video/mp4')
    expect(result.repro).toMatchObject({ taskId: 'task-1', mode: 'pro', duration: '5', aspect_ratio: '16:9' })
    expect(result.repro?.videoId).toBe('v-1')
  })

  it('task_status=failed → 透传 task_status_msg（内容审核等平台侧原因）', async () => {
    let polls = 0
    stubFetch((rec) => {
      if (rec.method === 'POST') return jsonRes({ code: 0, data: { task_id: 'task-2', task_status: 'submitted' } })
      if (rec.url.includes('/task-2')) {
        polls += 1
        return polls === 1
          ? jsonRes({ code: 0, data: { task_id: 'task-2', task_status: 'processing' } })
          : jsonRes({ code: 0, data: { task_id: 'task-2', task_status: 'failed', task_status_msg: '内容风控拦截' } })
      }
      throw new Error(`未预期的请求：${rec.method} ${rec.url}`)
    })
    const provider = buildProviderFromConfig(row) as VideoShotProvider
    // 先同步附加断言（catch handler 在位），再推进 timer——rejected promise 不跨 macrotask 边界裸奔
    const expectation = expect(provider.execute(payloadOf(), ctx)).rejects.toThrow(/\[可灵视频 可灵\] 生成失败：内容风控拦截/)
    await vi.advanceTimersByTimeAsync(4_000)
    await vi.advanceTimersByTimeAsync(4_000)
    await expectation
  })

  it('提交 401 → 密钥确定性失败（router 侧 isNonRetryable 不重试；此处断言错误文本）', async () => {
    stubFetch(() => jsonRes({ code: 401, message: 'invalid token' }, 401))
    const provider = buildProviderFromConfig(row) as VideoShotProvider
    await expect(provider.execute(payloadOf(), ctx)).rejects.toThrow(/\[可灵视频 可灵\] 提交失败/)  // 提交即失败：无 timer 推进需求
  })

  it('密钥形态无法解析 → 立即报错（不触网）', async () => {
    const badRow = makeRow({ ...row, apiKey: 'no-colon-key', id: 'cfg-bad' } as Partial<ProviderConfigRow>)
    const provider = buildProviderFromConfig(badRow) as VideoShotProvider
    await expect(provider.execute(payloadOf(), ctx)).rejects.toThrow(/AccessKey:SecretKey/)
  })
})

// ---------- 方舟：纯函数 + 执行链路 ----------

describe('方舟参数映射（纯函数）', () => {
  it('durationSec → [4,12] 安全交集夹取；extra.duration 覆盖', () => {
    expect(arkDuration(5, {})).toBe(5)
    expect(arkDuration(2, {})).toBe(4)
    expect(arkDuration(30, {})).toBe(12)
    expect(arkDuration(undefined, {})).toBe(5)
    expect(arkDuration(9, { duration: 10 })).toBe(10)
  })
  it('i2v ratio 默认 adaptive；extra.ratio 可显式指定', () => {
    expect(arkRatio({})).toBe('adaptive')
    expect(arkRatio({ ratio: '16:9' })).toBe('16:9')
    expect(arkRatio({ ratio: 'ADAPTIVE' })).toBe('adaptive')
  })
})

describe('方舟 video.shot 执行链路', () => {
  const row = makeRow({
    channel: 'video',
    providerType: 'volc-ark',
    label: '方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'ark-ey-test-key-1234567890',
    modelName: 'doubao-seedance-1-0-pro-250528',
  })

  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('全链成功：提交→succeeded→下载；body 逐项断言（content 数组/ratio=adaptive/watermark=false/generate_audio=false）+ repro', async () => {
    let polls = 0
    stubFetch((rec) => {
      if (rec.method === 'POST' && rec.url.endsWith('/contents/generations/tasks')) {
        return jsonRes({ id: 'ark-task-1' })
      }
      if (rec.method === 'GET' && rec.url.includes('/contents/generations/tasks/ark-task-1')) {
        polls += 1
        if (polls === 1) return jsonRes({ id: 'ark-task-1', status: 'running' })
        return jsonRes({
          id: 'ark-task-1',
          status: 'succeeded',
          content: { video_url: 'https://tos.example.com/out.mp4' },
          usage: { total_tokens: 246840 },
          seed: 58944,
        })
      }
      if (rec.url.includes('tos.example.com/out.mp4')) {
        return new Response(new Uint8Array(videoBytes), { status: 200, headers: { 'content-type': 'video/mp4' } })
      }
      throw new Error(`未预期的请求：${rec.method} ${rec.url}`)
    })

    const promise = (buildProviderFromConfig(row) as VideoShotProvider).execute(payloadOf(), ctx)
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    const result = await promise

    const submit = recorded.find((r) => r.method === 'POST')!
    expect(submit.url).toBe('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks')
    expect(submit.auth).toBe('Bearer ark-ey-test-key-1234567890')
    expect(submit.body).toMatchObject({
      model: 'doubao-seedance-1-0-pro-250528',
      ratio: 'adaptive',
      duration: 5,
      watermark: false,
      generate_audio: false,
    })
    expect(Array.isArray(submit.body?.content)).toBe(true)
    expect((submit.body!.content as Array<Record<string, unknown>>)[0]).toEqual({ type: 'text', text: '女孩奔跑穿过麦田' })
    expect((submit.body!.content as Array<Record<string, unknown>>)[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,QUJDRA==' }, // 方舟接受 data URL，原样透传
    })

    expect(result.repro).toMatchObject({ taskId: 'ark-task-1', duration: 5, ratio: 'adaptive' })
    expect(result.repro?.seed).toBe(58944)
    expect(result.repro?.totalTokens).toBe(246840)
    expect(result.base64).toBe(videoBytes.toString('base64'))
  })

  it('status=failed → error.message 透传', async () => {
    let polls = 0
    stubFetch((rec) => {
      if (rec.method === 'POST') return jsonRes({ id: 'ark-task-2' })
      if (rec.url.includes('/ark-task-2')) {
        polls += 1
        return polls === 1
          ? jsonRes({ id: 'ark-task-2', status: 'queued' })
          : jsonRes({ id: 'ark-task-2', status: 'failed', error: { code: 'QuotaExceeded', message: '视频生成积分不足' } })
      }
      throw new Error(`未预期的请求：${rec.method} ${rec.url}`)
    })
    const provider = buildProviderFromConfig(row) as VideoShotProvider
    const expectation = expect(provider.execute(payloadOf(), ctx)).rejects.toThrow(/\[方舟视频 方舟\] 生成失败：视频生成积分不足/)
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    await expectation
  })

  it('status=cancelled → 同失败路径', async () => {
    let polls = 0
    stubFetch((rec) => {
      if (rec.method === 'POST') return jsonRes({ id: 'ark-task-3' })
      if (rec.url.includes('/ark-task-3')) {
        polls += 1
        return polls === 1
          ? jsonRes({ id: 'ark-task-3', status: 'running' })
          : jsonRes({ id: 'ark-task-3', status: 'cancelled', error: { message: '手动取消' } })
      }
      throw new Error(`未预期的请求：${rec.method} ${rec.url}`)
    })
    const provider = buildProviderFromConfig(row) as VideoShotProvider
    const expectation = expect(provider.execute(payloadOf(), ctx)).rejects.toThrow(/手动取消/)
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    await expectation
  })
})

// ---------- 链构建：providerType 分发 ----------

describe('链构建：专有协议 providerType 进 video 链', () => {
  it('kling/volc-ark 的 video 行进入 video 链（id 前缀区分协议）；llm 行返回 null（专有协议只做视频）', () => {
    const chains = buildChainsFromConfigs([
      makeRow({
        id: 'k1', channel: 'video', providerType: 'kling', label: '可灵',
        baseUrl: 'https://api-beijing.klingai.com', apiKey: 'ak123:sk456', modelName: 'kling-v2-5-turbo', priority: 10,
      }),
      makeRow({
        id: 'a1', channel: 'video', providerType: 'volc-ark', label: '方舟',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: 'ark-key-1234567890', modelName: 'doubao-seedance-1-0-pro-250528', priority: 20,
      }),
      makeRow({ id: 'k2', channel: 'llm', providerType: 'kling', label: '可灵对话', apiKey: 'ak123:sk456', modelName: 'kling-v2-5-turbo' }),
    ])
    expect(chains.video.map((p) => p.id)).toEqual(['kling:可灵', 'volc-ark:方舟'])
    expect(chains.video[0]?.model).toBe('kling-v2-5-turbo')
    expect(buildProviderFromConfig(makeRow({ channel: 'llm', providerType: 'kling', label: '可灵对话', apiKey: 'ak123:sk456' }))).toBeNull()
    // 停用排除照旧
    expect(buildProviderFromConfig(makeRow({ channel: 'video', providerType: 'kling', label: '可灵', apiKey: 'a:b', enabled: false }))).toBeNull()
  })

  it('openai-compat 行为不变（回归）：video 通道仍走双协议适配器', () => {
    const chains = buildChainsFromConfigs([
      makeRow({ id: 'o1', channel: 'video', label: 'Agnes', modelName: 'agnes-video-2.5-flash', priority: 10 }),
    ])
    expect(chains.video.map((p) => p.id)).toEqual(['openai-compat:Agnes'])
  })
})

// ---------- 镜头级调度：isActionShot ----------

describe('isActionShot（动作镜头判定 → 可灵 pro 档）', () => {
  it('中文强动作关键词命中', () => {
    expect(isActionShot('女孩奔跑穿过麦田，裙摆飞扬')).toBe(true)
    expect(isActionShot('两人打斗，剑出鞘')).toBe(true)
    expect(isActionShot('汽车漂移过弯')).toBe(true)
  })
  it('英文强动作关键词命中（大小写不敏感）', () => {
    expect(isActionShot('A man lunges and swings at the ball')).toBe(true)
    expect(isActionShot('the horse gallops across the plain')).toBe(true)
  })
  it('静态/氛围镜头不命中（宁缺勿滥：误判只是错过 pro 加成，不产生错误产物）', () => {
    expect(isActionShot('女孩坐在火车上望着窗外，神情忧郁')).toBe(false)
    expect(isActionShot('A girl sat on the train, looking out the window, melancholic')).toBe(false)
    expect(isActionShot('')).toBe(false)
  })
})
