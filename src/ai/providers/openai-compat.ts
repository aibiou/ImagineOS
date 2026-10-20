// OpenAI 兼容接口 Provider Adapter（ADR-0004 / M1.5 Phase B 解锁）
// 由「设置 → 模型服务」的配置行工厂化生成，插入 Model Router 候选链（自定义优先 → z-ai 兜底）。
// 覆盖能力：text.plan（chat/completions）/ image.shot（images/generations）
//          / audio.tts（audio/speech）/ video.shot（双协议：SiliconFlow submit/status + Agnes OpenAI-Videos）
// 纯 fetch 实现——不引入任何 SDK 依赖，密钥只在请求头出现。

import {
  joinUrl,
  parseExtra,
  type ProviderConfigRow,
} from '@/ai/router/provider-config'
import type {
  AudioTTSPayload,
  AudioTTSProvider,
  AudioTTSResult,
  ImageShotPayload,
  ImageShotProvider,
  ImageShotResult,
  ProviderCallContext,
  TextPlanPayload,
  TextPlanProvider,
  TextPlanResult,
  VideoShotPayload,
  VideoShotProvider,
  VideoShotResult,
} from '@/ai/router/types'

// ---------- 公共请求 ----------

interface RequestOutcome {
  ok: boolean
  status: number
  /** JSON 响应体（可为 null：二进制/空响应） */
  json: unknown
  /** 二进制响应体（音频/图像等） */
  bytes: Buffer | null
  contentType: string
  error?: string
}

async function request(
  method: 'GET' | 'POST',
  url: string,
  apiKey: string,
  body?: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<RequestOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    })
    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300)
      return {
        ok: false,
        status: res.status,
        json: null,
        bytes: null,
        contentType,
        error: `HTTP ${res.status}：${text || '无返回内容'}`,
      }
    }
    if (contentType.includes('application/json')) {
      return { ok: true, status: res.status, json: await res.json(), bytes: null, contentType }
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    return { ok: true, status: res.status, json: null, bytes: buffer, contentType }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      status: 0,
      json: null,
      bytes: null,
      contentType: '',
      error: msg.includes('abort') ? `超时（>${timeoutMs}ms）` : msg,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 提取 JSON 错误信息（OpenAI 兼容形态 {error:{message}} / {message} / 裸文本） */
function extractJsonError(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  const err = j.error
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  if (typeof err === 'string') return err
  if (typeof j.message === 'string') return j.message
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 媒体下载（图像/视频产物）：先裸下载（S3 预签名 URL 等自证链接，附加 Authorization 头会破坏签名
 * —— Agnes 实测：带鉴权头 → 401 XML 报错），401/403 时再带 Bearer 重试（部分网关需要）。
 */
async function downloadMedia(url: string, apiKey: string, timeoutMs: number): Promise<{ bytes: Buffer; contentType: string }> {
  let lastError = '未知错误'
  for (const withAuth of [false, true]) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        headers: withAuth ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: controller.signal,
      })
      if (res.ok) {
        const contentType = res.headers.get('content-type') ?? ''
        const bytes = Buffer.from(await res.arrayBuffer())
        return { bytes, contentType }
      }
      lastError = `HTTP ${res.status}`
      // 仅 401/403 值得带鉴权重试；其他状态码直接返回错误
      if (res.status !== 401 && res.status !== 403) break
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      if (lastError.includes('abort')) lastError = `超时（>${timeoutMs}ms）`
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`下载失败（${lastError}）`)
}

// ---------- text.plan（chat/completions） ----------

function extractContent(raw: unknown): string {
  const res = raw as { choices?: Array<{ message?: { content?: unknown } }> } | null
  const content = res?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text ?? '') : ''))
      .join('')
  }
  throw new Error('LLM 返回形态无法解析（choices[0].message.content 缺失）')
}

function makeLlmProvider(row: ProviderConfigRow): TextPlanProvider {
  const extra = parseExtra(row)
  const extraBody = (extra.body ?? {}) as Record<string, unknown>
  return {
    id: `openai-compat:${row.label}`,
    capability: 'text.plan',
    model: row.modelName,
    async execute(payload: TextPlanPayload, _ctx: ProviderCallContext): Promise<TextPlanResult> {
      const body: Record<string, unknown> = {
        model: row.modelName,
        messages: [
          { role: 'system', content: payload.system },
          { role: 'user', content: payload.user },
        ],
        ...(payload.temperature !== undefined ? { temperature: payload.temperature } : {}),
        ...(typeof extra.temperature === 'number' ? { temperature: extra.temperature } : {}),
        ...extraBody,
      }
      const out = await request('POST', joinUrl(row.baseUrl, '/chat/completions'), row.apiKey, body, 90_000)
      if (!out.ok) throw new Error(`[自定义LLM ${row.label}] ${out.error ?? extractJsonError(out.json) ?? '请求失败'}`)
      // 兼容「JSON 体 + 非 JSON 头」的服务商（蚂蚁 Ling 实测：chat/completions 返回
      // content-type: text/plain，但 body 是合法 JSON）——二进制分支回收为文本再尝试解析。
      let json: unknown = out.json
      if (json === null && out.bytes && out.bytes.length > 0) {
        const text = out.bytes.toString('utf-8').trim()
        if (text.startsWith('{') || text.startsWith('[')) {
          try { json = JSON.parse(text) } catch { /* 保持 null，走下方统一报错 */ }
        }
      }
      try {
        const text = extractContent(json)
        if (!text.trim()) throw new Error('返回空内容')
        const usage = (json as { usage?: Record<string, number> } | null)?.usage
        return {
          text,
          usage: usage
            ? {
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
                totalTokens: usage.total_tokens,
              }
            : undefined,
        }
      } catch (e) {
        // 解析失败时附带原始响应片段——定位网关形态差异（如 content:null / choices 缺失 / 错误体 200）
        const rawSnippet =
          json !== null
            ? JSON.stringify(json)?.slice(0, 400)
            : out.bytes
              ? `text:${out.bytes.toString('utf-8').slice(0, 400)}`
              : '(空响应)'
        throw new Error(
          `[自定义LLM ${row.label}] 响应解析失败：${e instanceof Error ? e.message : String(e)}｜原始响应：${rawSnippet}`,
        )
      }
    },
  }
}

// ---------- image.shot（images/generations） ----------

function makeImageProvider(row: ProviderConfigRow): ImageShotProvider {
  const extra = parseExtra(row)
  const extraBody = (extra.body ?? {}) as Record<string, unknown>
  return {
    id: `openai-compat:${row.label}`,
    capability: 'image.shot',
    model: row.modelName,
    async execute(payload: ImageShotPayload, _ctx: ProviderCallContext): Promise<ImageShotResult> {
      const body: Record<string, unknown> = {
        model: row.modelName,
        prompt: payload.prompt,
        size: typeof extra.size === 'string' ? extra.size : payload.size,
        ...extraBody,
      }
      const out = await request('POST', joinUrl(row.baseUrl, '/images/generations'), row.apiKey, body, 180_000)
      if (!out.ok) throw new Error(`[自定义图像 ${row.label}] ${out.error ?? extractJsonError(out.json) ?? '请求失败'}`)

      // 兼容多种返回形态：OpenAI data[].b64_json / zai data[].base64 / 部分服务商 images[].url
      type ImageEntry = { b64_json?: string; base64?: string; url?: string }
      const json = out.json as { data?: ImageEntry[]; images?: ImageEntry[] } | null
      const entry: ImageEntry | undefined = json?.data?.[0] ?? json?.images?.[0]
      const b64 = entry?.b64_json ?? entry?.base64
      if (typeof b64 === 'string' && b64.length > 100) {
        return { base64: b64, mime: 'image/png' }
      }
      const url = entry?.url
      if (typeof url === 'string' && /^https?:\/\//.test(url)) {
        // URL 形态 → 下载转 base64（预签名 URL 不能带鉴权头，见 downloadMedia 注释）
        try {
          const dl = await downloadMedia(url, row.apiKey, 120_000)
          return { base64: dl.bytes.toString('base64'), mime: dl.contentType.includes('jpeg') ? 'image/jpeg' : 'image/png' }
        } catch (e) {
          throw new Error(`[自定义图像 ${row.label}] 生成成功但下载失败：${e instanceof Error ? e.message : String(e)}`)
        }
      }
      throw new Error(`[自定义图像 ${row.label}] 返回中未找到图像（b64_json/base64/url 均缺失）`)
    },
  }
}

// ---------- audio.tts（audio/speech） ----------

function mimeFromContentType(ct: string): string {
  const lower = ct.toLowerCase()
  if (lower.includes('mpeg')) return 'audio/mpeg'
  if (lower.includes('wav')) return 'audio/wav'
  if (lower.includes('ogg')) return 'audio/ogg'
  return 'audio/mpeg'
}

function makeTtsProvider(row: ProviderConfigRow): AudioTTSProvider {
  const extra = parseExtra(row)
  const extraBody = (extra.body ?? {}) as Record<string, unknown>
  return {
    id: `openai-compat:${row.label}`,
    capability: 'audio.tts',
    model: row.modelName,
    async execute(payload: AudioTTSPayload, _ctx: ProviderCallContext): Promise<AudioTTSResult> {
      const body: Record<string, unknown> = {
        model: row.modelName,
        input: payload.text,
        voice: payload.voice ?? (typeof extra.voice === 'string' ? extra.voice : 'alloy'),
        response_format: typeof extra.response_format === 'string' ? extra.response_format : 'wav',
        ...(payload.speed !== undefined ? { speed: payload.speed } : {}),
        ...extraBody,
      }
      const out = await request('POST', joinUrl(row.baseUrl, '/audio/speech'), row.apiKey, body, 120_000)
      if (!out.ok || !out.bytes) {
        throw new Error(`[自定义配音 ${row.label}] ${out.error ?? extractJsonError(out.json) ?? '请求失败'}`)
      }
      if (out.bytes.length < 256) {
        throw new Error(`[自定义配音 ${row.label}] 返回音频过短（${out.bytes.length} 字节）`)
      }
      return { base64: out.bytes.toString('base64'), mime: mimeFromContentType(out.contentType) }
    },
  }
}

// ---------- video.shot（双协议：SiliconFlow submit/status + Agnes OpenAI-Videos） ----------

const VIDEO_POLL_INTERVAL_MS = 5_000
const VIDEO_POLL_MAX_ATTEMPTS = 60 // 5s × 60 = 5min 上限（与能力级超时 330s 匹配）

interface VideoSubmitResponse {
  requestId?: string
  id?: string
}

interface VideoStatusResponse {
  status?: string
  /** SiliconFlow 形态：results.videos[0].url */
  results?: { videos?: Array<{ url?: string }> }
  /** 兜底形态：直接给 URL */
  videoUrl?: string
  output?: { video_url?: string }
  error?: unknown
}

// ---- 协议 B：Agnes OpenAI-Videos（POST /videos + GET {origin}/agnesapi） ----
// 官方文档（wiki.agnes-ai.com/en/docs/agnes-video-25-flash.md）：
//   提交：POST /v1/videos { model, prompt, mode: 'keyframe', first_frame, seconds: '4'-'12', size: '720P', aspect_ratio }
//   轮询：GET {origin}/agnesapi?video_id=…&model_name=…（注意在根路径，非 /v1 下）→ status/url
//   首帧：公网 URL 或 data URI（实测 data URI 通过；图片边长须 256-5760）
//   Flash 限制：size 只接受 '720P'，输出分辨率由 aspect_ratio 决定

const AGNES_POLL_INTERVAL_MS = 3_000
const AGNES_POLL_MAX_ATTEMPTS = 80 // 3s × 80 = 4min 轮询上限（提交重试 40s 余量 → 能力级 330s 内）
const AGNES_QUEUE_RETRIES = 3
const AGNES_QUEUE_BACKOFF_MS = 20_000

interface AgnesVideoStatus {
  status?: string
  url?: string
  error?: unknown
  message?: string
  progress?: number
}

/** payload.size（如 '720x1280'）→ Agnes aspect_ratio（最近似匹配） */
function agnesAspectRatio(size?: string): string {
  if (!size) return '9:16'
  const m = size.match(/^(\d+)x(\d+)$/)
  if (!m) return '9:16'
  const ratio = Number(m[1]) / Number(m[2])
  const table: Array<[string, number]> = [
    ['21:9', 21 / 9], ['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['3:4', 3 / 4], ['9:16', 9 / 16],
  ]
  let best = '9:16'
  let bestDiff = Infinity
  for (const [ar, v] of table) {
    const diff = Math.abs(ratio - v)
    if (diff < bestDiff) { bestDiff = diff; best = ar }
  }
  return best
}

/** durationSec → seconds 字符串（4-12 夹取，Agnes 只接受字符串） */
function agnesSeconds(durationSec?: number): string {
  const n = Math.round(durationSec ?? 5)
  return String(Math.min(12, Math.max(4, n)))
}

interface AgnesSubmitResponse {
  video_id?: string
  id?: string
  task_id?: string
}

async function executeVideoAgnes(
  row: ProviderConfigRow,
  payload: VideoShotPayload,
  extraBody: Record<string, unknown>,
): Promise<VideoShotResult> {
  const body: Record<string, unknown> = {
    model: row.modelName,
    mode: 'keyframe',
    prompt: payload.prompt,
    first_frame: payload.imageUrl,
    seconds: agnesSeconds(payload.durationSec),
    size: '720P',
    aspect_ratio: agnesAspectRatio(payload.size),
    ...extraBody,
  }

  // 1. 提交（video_queue_full → 退避重试）
  let submitJson: AgnesSubmitResponse | null = null
  let lastError = ''
  for (let attempt = 1; attempt <= AGNES_QUEUE_RETRIES; attempt++) {
    const out = await request('POST', joinUrl(row.baseUrl, '/videos'), row.apiKey, body, 60_000)
    if (out.ok) { submitJson = out.json as AgnesSubmitResponse; break }
    lastError = out.error ?? extractJsonError(out.json) ?? '请求失败'
    if (/queue[_ ]?full/i.test(lastError) && attempt < AGNES_QUEUE_RETRIES) {
      await sleep(AGNES_QUEUE_BACKOFF_MS)
      continue
    }
    throw new Error(`[自定义视频 ${row.label}] 提交失败：${lastError}`)
  }
  const videoId = submitJson?.video_id ?? submitJson?.id ?? submitJson?.task_id
  if (!videoId) throw new Error(`[自定义视频 ${row.label}] 提交成功但未返回 video_id（协议形态可能变化）`)
  // 复现参数（seed 位）：video_id + 提交参数——落 Generation.output，供重放/对账
  const repro: Record<string, unknown> = {
    videoId,
    seconds: agnesSeconds(payload.durationSec),
    aspect_ratio: agnesAspectRatio(payload.size),
    mode: 'keyframe',
  }

  // 2. 轮询（GET {origin}/agnesapi?video_id=…&model_name=…）
  let origin = ''
  try { origin = new URL(row.baseUrl).origin } catch { origin = row.baseUrl.replace(/\/v1\/?$/, '') }
  const pollUrl = `${origin}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(row.modelName)}`
  for (let attempt = 1; attempt <= AGNES_POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(AGNES_POLL_INTERVAL_MS)
    const status = await request('GET', pollUrl, row.apiKey, undefined, 30_000)
    if (!status.ok) continue // 瞬时失败继续轮询
    const sj = status.json as AgnesVideoStatus | null
    const s = (sj?.status ?? '').toUpperCase()
    if (s === 'COMPLETED' || s === 'SUCCEEDED' || s === 'SUCCESS') {
      const videoUrl = sj?.url
      if (typeof videoUrl !== 'string' || !/^https?:\/\//.test(videoUrl)) {
        throw new Error(`[自定义视频 ${row.label}] 状态成功但未返回视频地址`)
      }
      const dl = await downloadMedia(videoUrl, row.apiKey, 240_000)
      if (dl.bytes.length < 10_000) throw new Error(`[自定义视频 ${row.label}] 视频内容过短（${dl.bytes.length} 字节）`)
      return { base64: dl.bytes.toString('base64'), mime: 'video/mp4', repro }
    }
    if (s === 'FAILED' || s === 'ERROR' || s === 'CANCELED') {
      const errMsg = extractJsonError(sj) ?? sj?.message ?? (typeof sj?.error === 'string' ? sj.error : JSON.stringify(sj).slice(0, 200))
      throw new Error(`[自定义视频 ${row.label}] 生成失败：${errMsg}`)
    }
    // RUNNING / PENDING / QUEUED / 空 → 继续轮询
  }
  throw new Error(`[自定义视频 ${row.label}] 轮询超时（>${AGNES_POLL_MAX_ATTEMPTS * AGNES_POLL_INTERVAL_MS / 1000}s）`)
}

function makeVideoProvider(row: ProviderConfigRow): VideoShotProvider {
  const extra = parseExtra(row)
  const extraBody = (extra.body ?? {}) as Record<string, unknown>
  return {
    id: `openai-compat:${row.label}`,
    capability: 'video.shot',
    model: row.modelName,
    async execute(payload: VideoShotPayload, _ctx: ProviderCallContext): Promise<VideoShotResult> {
      // 协议 A：SiliconFlow 风格 POST /video/submit（404 = 该服务商不支持 → 转协议 B）
      const submitBody: Record<string, unknown> = {
        model: row.modelName,
        prompt: payload.prompt,
        image_url: payload.imageUrl,
        ...(payload.size ? { size: payload.size } : {}),
        ...(payload.durationSec ? { duration: payload.durationSec } : {}),
        ...extraBody,
      }
      const submit = await request('POST', joinUrl(row.baseUrl, '/video/submit'), row.apiKey, submitBody, 60_000)
      if (submit.status === 404) {
        return executeVideoAgnes(row, payload, extraBody)
      }
      if (!submit.ok) throw new Error(`[自定义视频 ${row.label}] 提交失败：${submit.error ?? extractJsonError(submit.json) ?? '请求失败'}`)
      const requestId =
        (submit.json as VideoSubmitResponse | null)?.requestId ??
        (submit.json as VideoSubmitResponse | null)?.id
      if (!requestId) {
        throw new Error(`[自定义视频 ${row.label}] 提交成功但未返回 requestId（该服务商可能不兼容 submit/status 协议）`)
      }

      // 2. 轮询状态
      for (let attempt = 1; attempt <= VIDEO_POLL_MAX_ATTEMPTS; attempt++) {
        await sleep(VIDEO_POLL_INTERVAL_MS)
        const status = await request(
          'GET',
          `${joinUrl(row.baseUrl, '/video/status')}?requestId=${encodeURIComponent(requestId)}`,
          row.apiKey,
          undefined,
          30_000,
        )
        if (!status.ok) continue // 瞬时失败继续轮询
        const sj = status.json as VideoStatusResponse | null
        const s = (sj?.status ?? '').toUpperCase()
        if (s === 'SUCCEEDED' || s === 'SUCCESS' || s === 'COMPLETED') {
          const videoUrl = sj?.results?.videos?.[0]?.url ?? sj?.videoUrl ?? sj?.output?.video_url
          if (typeof videoUrl !== 'string' || !/^https?:\/\//.test(videoUrl)) {
            throw new Error(`[自定义视频 ${row.label}] 状态成功但未返回视频地址`)
          }
          const dl = await downloadMedia(videoUrl, row.apiKey, 240_000)
          if (dl.bytes.length < 10_000) throw new Error(`[自定义视频 ${row.label}] 视频内容过短（${dl.bytes.length} 字节）`)
          return { base64: dl.bytes.toString('base64'), mime: 'video/mp4', repro: { requestId } }
        }
        if (s === 'FAILED' || s === 'ERROR' || s === 'CANCELED') {
          const errMsg = extractJsonError(sj) ?? (typeof sj?.error === 'string' ? sj.error : JSON.stringify(sj).slice(0, 200))
          throw new Error(`[自定义视频 ${row.label}] 生成失败：${errMsg}`)
        }
        // RUNNING / PENDING / 空 → 继续轮询
      }
      throw new Error(`[自定义视频 ${row.label}] 轮询超时（>${VIDEO_POLL_MAX_ATTEMPTS * VIDEO_POLL_INTERVAL_MS / 1000}s）`)
    },
  }
}

// ---------- 工厂 ----------

export function buildProviderFromConfig(row: ProviderConfigRow):
  | TextPlanProvider
  | ImageShotProvider
  | AudioTTSProvider
  | VideoShotProvider
  | null {
  if (!row.enabled) return null
  switch (row.channel) {
    case 'llm': return makeLlmProvider(row)
    case 'image': return makeImageProvider(row)
    case 'tts': return makeTtsProvider(row)
    case 'video': return makeVideoProvider(row)
    default: return null
  }
}
