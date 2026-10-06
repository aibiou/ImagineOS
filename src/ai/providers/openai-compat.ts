// OpenAI 兼容接口 Provider Adapter（ADR-0004 / M1.5 Phase B 解锁）
// 由「设置 → 模型服务」的配置行工厂化生成，插入 Model Router 候选链（自定义优先 → z-ai 兜底）。
// 覆盖能力：text.plan（chat/completions）/ image.shot（images/generations）
//          / audio.tts（audio/speech）/ video.shot（video/submit + video/status，实验性）
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
      try {
        const text = extractContent(out.json)
        if (!text.trim()) throw new Error('返回空内容')
        const usage = (out.json as { usage?: Record<string, number> })?.usage
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
        throw new Error(`[自定义LLM ${row.label}] 响应解析失败：${e instanceof Error ? e.message : String(e)}`)
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
        // URL 形态 → 下载转 base64
        const dl = await request('GET', url, row.apiKey, undefined, 120_000)
        if (!dl.ok || !dl.bytes) throw new Error(`[自定义图像 ${row.label}] 生成成功但下载失败：${dl.error}`)
        return { base64: dl.bytes.toString('base64'), mime: dl.contentType.includes('jpeg') ? 'image/jpeg' : 'image/png' }
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

// ---------- video.shot（video/submit + video/status 轮询，实验性） ----------

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

function makeVideoProvider(row: ProviderConfigRow): VideoShotProvider {
  const extra = parseExtra(row)
  const extraBody = (extra.body ?? {}) as Record<string, unknown>
  return {
    id: `openai-compat:${row.label}`,
    capability: 'video.shot',
    model: row.modelName,
    async execute(payload: VideoShotPayload, _ctx: ProviderCallContext): Promise<VideoShotResult> {
      // 1. 提交任务（图生视频：首帧 + 运动提示）
      const submitBody: Record<string, unknown> = {
        model: row.modelName,
        prompt: payload.prompt,
        image_url: payload.imageUrl,
        ...(payload.size ? { size: payload.size } : {}),
        ...(payload.durationSec ? { duration: payload.durationSec } : {}),
        ...extraBody,
      }
      const submit = await request('POST', joinUrl(row.baseUrl, '/video/submit'), row.apiKey, submitBody, 60_000)
      if (!submit.ok) throw new Error(`[自定义视频 ${row.label}] 提交失败：${submit.error ?? extractJsonError(submit.json) ?? '请求失败'}`)
      const requestId =
        (submit.json as VideoSubmitResponse | null)?.requestId ??
        (submit.json as VideoSubmitResponse | null)?.id
      if (!requestId) {
        throw new Error(`[自定义视频 ${row.label}] 提交成功但未返回 requestId（该服务商可能不兼容 submit/status 协议）`)
      }

      // 2. 轮询状态
      for (let attempt = 1; attempt <= VIDEO_POLL_MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS))
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
          const dl = await request('GET', videoUrl, row.apiKey, undefined, 240_000)
          if (!dl.ok || !dl.bytes) throw new Error(`[自定义视频 ${row.label}] 视频下载失败：${dl.error}`)
          if (dl.bytes.length < 10_000) throw new Error(`[自定义视频 ${row.label}] 视频内容过短（${dl.bytes.length} 字节）`)
          return { base64: dl.bytes.toString('base64'), mime: 'video/mp4' }
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
