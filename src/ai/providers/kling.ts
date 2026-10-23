// 可灵（Kling AI / 快手）视频 Provider Adapter —— honest-video-redline-029 解药分工
// 「密钥到即插即用」：本适配器按官方开放平台协议（2026-10 规格）实现，产品负责人在
// 「设置 → 模型服务」添加 providerType=kling 的提供商（baseUrl 填域名，密钥填 AccessKey:SecretKey）
// 后零代码改动自动进入 video.shot 候选链。
//
// 协议（官方文档 klingai.com/document-api，2026-10 现场核对）：
//   鉴权：AccessKey/SecretKey → 自签 HS256 JWT（iss=ak，exp=now+1800s，nbf=now-5s）；
//         每次请求现签（纯本地 HMAC 计算，零网络）—— Authorization: Bearer <jwt>
//   提交：POST {origin}/v1/videos/image2video
//         { model_name, image, prompt, duration: "5"|"10", mode: "std"|"pro",
//           aspect_ratio: "16:9"|"9:16"|"1:1", ...extra }
//         → { code, message, request_id, data: { task_id, task_status } }
//   轮询：GET {origin}/v1/videos/image2video/{task_id}
//         → data.task_status: submitted|processing|succeed|failed
//         → succeed 时 data.task_result.videos[0].url（官方 30 天清理——下载后入 Asset 即转存）
//   首帧：官方要求裸 Base64（不带 data: 前缀）或公网 URL——data URI 在此剥离前缀
//   镜头级调度：payload.speedFirst=false（动作镜头）→ mode=pro（高表现档）；
//               默认/速度优先 → mode=std；extra.mode 显式指定时最优先
// 纯 fetch + node:crypto 实现，不引入任何 SDK；密钥只在签名计算中出现，不打日志。

import { createHmac } from 'node:crypto'
import {
  downloadMedia,
  extractJsonError,
  request,
} from '@/ai/providers/openai-compat'
import { parseExtra } from '@/core/settings/provider-config-service'
import type {
  ProviderCallContext,
  VideoShotPayload,
  VideoShotProvider,
  VideoShotResult,
} from '@/ai/router/types'
import type { ProviderConfigRow } from '@/core/settings/provider-config-service'

// ---------- 鉴权 ----------

/** apiKey 形态解析："ak:sk"（首个冒号分隔）或 JSON {"ak":..,"sk":..} */
export function parseKlingCredential(apiKey: string): { ak: string; sk: string } {
  const trimmed = apiKey.trim()
  // JSON 形态优先（密钥内含冒号的场景不受影响）
  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed) as { ak?: unknown; sk?: unknown; accessKey?: unknown; secretKey?: unknown }
      const ak = j.ak ?? j.accessKey
      const sk = j.sk ?? j.secretKey
      if (typeof ak === 'string' && typeof sk === 'string' && ak.length > 0 && sk.length > 0) {
        return { ak, sk }
      }
    } catch {
      /* 落入冒号形态 */
    }
  }
  const i = trimmed.indexOf(':')
  if (i > 0 && i < trimmed.length - 1) {
    return { ak: trimmed.slice(0, i), sk: trimmed.slice(i + 1) }
  }
  throw new Error(
    '[可灵视频] 密钥形态无法解析：请填 "AccessKey:SecretKey"（冒号分隔）或 {"ak":"...","sk":"..."}，' +
      '密钥来自可灵开放平台（klingai.com → API 服务）',
  )
}

const b64url = (bytes: Buffer | string): string =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** 自签 HS256 JWT（iss=ak，30 分钟有效期，nbf 回拨 5s 容时钟漂移；纯本地计算） */
export function signKlingJwt(ak: string, sk: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ iss: ak, exp: now + 1800, nbf: now - 5 }))
  const sig = b64url(createHmac('sha256', sk).update(`${header}.${payload}`).digest())
  return `${header}.${payload}.${sig}`
}

// ---------- 参数映射 ----------

/** payload.durationSec → 可灵 duration 字符串（v2 系列枚举 5/10；7.5 为界） */
export function klingDuration(durationSec: number | undefined, extra: Record<string, unknown>): string {
  if (typeof extra.duration === 'string' && /^(5|10)$/.test(extra.duration)) return extra.duration
  const n = Math.round(durationSec ?? 5)
  return n >= 8 ? '10' : '5'
}

/** payload.size → 可灵 aspect_ratio（v2 系列枚举 16:9/9:16/1:1，最近似匹配） */
export function klingAspectRatio(size: string | undefined, extra: Record<string, unknown>): string {
  if (typeof extra.aspect_ratio === 'string' && /^(16:9|9:16|1:1)$/.test(extra.aspect_ratio)) return extra.aspect_ratio
  if (!size) return '9:16'
  const m = size.match(/^(\d+)x(\d+)$/)
  if (!m) return '9:16'
  const ratio = Number(m[1]) / Number(m[2])
  const table: Array<[string, number]> = [['16:9', 16 / 9], ['1:1', 1], ['9:16', 9 / 16]]
  let best = '9:16'
  let bestDiff = Infinity
  for (const [ar, v] of table) {
    const diff = Math.abs(ratio - v)
    if (diff < bestDiff) { bestDiff = diff; best = ar }
  }
  return best
}

/** 镜头级调度：动作镜头（speedFirst=false）→ pro 高表现档；速度优先 → std 标准档 */
export function klingMode(payload: VideoShotPayload, extra: Record<string, unknown>): 'std' | 'pro' {
  if (extra.mode === 'pro' || extra.mode === 'std') return extra.mode
  return payload.speedFirst === false ? 'pro' : 'std'
}

/** 首帧参数：data URI → 裸 Base64（官方要求不带前缀）；http(s) URL → 原样 */
function klingImage(imageUrl: string): string {
  const m = /^data:[^,]*;base64,([\s\S]*)$/.exec(imageUrl)
  if (m) return m[1]!
  return imageUrl
}

// ---------- 执行 ----------

const KLING_POLL_INTERVAL_MS = 4_000
const KLING_POLL_MAX_ATTEMPTS = 55 // 4s × 55 = 220s（提交 60s + 下载 60s → 能力级 330s 内）

interface KlingData {
  task_id?: string
  task_status?: string
  task_status_msg?: string
  task_result?: { videos?: Array<{ id?: string; url?: string; duration?: string }> }
  created_at?: number
}

/** baseUrl → API origin（用户可能按 openai-compat 习惯多填路径；端点路径固定 /v1/...） */
function klingOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin
  } catch {
    return baseUrl.replace(/\/[^/]*$/, '') // 容错：截掉最后一段当作 origin
  }
}

export function executeKlingVideo(row: ProviderConfigRow, payload: VideoShotPayload): Promise<VideoShotResult> {
  const extra = parseExtra(row)
  const extraBody = (extra.body ?? {}) as Record<string, unknown>
  const origin = klingOrigin(row.baseUrl)
  const duration = klingDuration(payload.durationSec, extra)
  const aspectRatio = klingAspectRatio(payload.size, extra)
  const mode = klingMode(payload, extra)

  const repro: Record<string, unknown> = { provider: 'kling', duration, mode, aspect_ratio: aspectRatio }

  return (async (): Promise<VideoShotResult> => {
    // 密钥解析在 async 内（错误成为 rejected promise 而非同步 throw——统一错误传播形态）
    const { ak, sk } = parseKlingCredential(row.apiKey)
    const bearer = () => signKlingJwt(ak, sk)
    const body: Record<string, unknown> = {
      model_name: row.modelName,
      image: klingImage(payload.imageUrl),
      prompt: payload.prompt.slice(0, 2500),
      duration,
      mode,
      aspect_ratio: aspectRatio,
      ...extraBody,
    }
    // 1. 提交（401/403 = 密钥错误，确定性失败；额度不足/审核拒绝原样透传）
    const submit = await request('POST', `${origin}/v1/videos/image2video`, bearer(), body, 60_000)
    if (!submit.ok) {
      throw new Error(
        `[可灵视频 ${row.label}] 提交失败：${submit.error ?? extractJsonError(submit.json) ?? '请求失败'}`,
      )
    }
    const submitData = (submit.json as { data?: KlingData } | null)?.data
    const taskId = submitData?.task_id
    if (!taskId) {
      throw new Error(
        `[可灵视频 ${row.label}] 提交成功但未返回 task_id（协议形态可能变化）：${JSON.stringify(submit.json).slice(0, 200)}`,
      )
    }
    repro.taskId = taskId

    // 2. 轮询（submitted/processing → 继续；succeed → 取 URL；failed → task_status_msg）
    for (let attempt = 1; attempt <= KLING_POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, KLING_POLL_INTERVAL_MS))
      const status = await request('GET', `${origin}/v1/videos/image2video/${encodeURIComponent(taskId)}`, bearer(), undefined, 30_000)
      if (!status.ok) continue // 瞬时失败继续轮询
      const data = (status.json as { data?: KlingData } | null)?.data
      const s = (data?.task_status ?? '').toLowerCase()
      if (s === 'succeed' || s === 'succeeded' || s === 'success') {
        const videoUrl = data?.task_result?.videos?.[0]?.url
        if (typeof videoUrl !== 'string' || !/^https?:\/\//.test(videoUrl)) {
          throw new Error(`[可灵视频 ${row.label}] 状态成功但未返回视频地址`)
        }
        const videoId = data?.task_result?.videos?.[0]?.id
        if (typeof videoId === 'string') repro.videoId = videoId
        // 3. 下载（官方 URL 为 CDN 链接，预签名形态裸下载；JWT 无须随下载发送）
        const dl = await downloadMedia(videoUrl, '', 120_000)
        if (dl.bytes.length < 10_000) {
          throw new Error(`[可灵视频 ${row.label}] 视频内容过短（${dl.bytes.length} 字节）`)
        }
        return { base64: dl.bytes.toString('base64'), mime: 'video/mp4', repro }
      }
      if (s === 'failed' || s === 'error' || s === 'canceled' || s === 'cancelled') {
        const errMsg = data?.task_status_msg ?? extractJsonError(data) ?? JSON.stringify(data).slice(0, 200)
        throw new Error(`[可灵视频 ${row.label}] 生成失败：${errMsg}`)
      }
      // submitted / processing / 空 → 继续轮询
    }
    throw new Error(`[可灵视频 ${row.label}] 轮询超时（>${(KLING_POLL_MAX_ATTEMPTS * KLING_POLL_INTERVAL_MS) / 1000}s）`)
  })()
}

// ---------- 工厂 ----------

/** 可灵适配器：仅 video 通道（llm/image/tts 官方另有 API，属后续范围） */
export function buildKlingProvider(row: ProviderConfigRow): VideoShotProvider | null {
  if (row.channel !== 'video') return null
  return {
    id: `kling:${row.label}`,
    capability: 'video.shot',
    model: row.modelName,
    execute(payload: VideoShotPayload, _ctx: ProviderCallContext): Promise<VideoShotResult> {
      return executeKlingVideo(row, payload)
    },
  }
}
