// 火山方舟（Volcano Ark / 字节 Doubao-Seedance）视频 Provider Adapter —— honest-video-redline-029 解药分工
// 「密钥到即插即用」：产品负责人在「设置 → 模型服务」添加 providerType=volc-ark 的提供商
// （baseUrl 填 https://ark.cn-beijing.volces.com/api/v3，密钥填方舟 API Key），零代码改动
// 自动进入 video.shot 候选链。
//
// 协议（官方文档 console.volcengine.com/ark 视频生成教程，2026-10 现场核对）：
//   鉴权：Authorization: Bearer <ARK_API_KEY>（标准 API Key，控制台「API Key 管理」获取）
//   提交：POST {base}/contents/generations/tasks
//         { model, content: [{type:'text',text}, {type:'image_url',image_url:{url}}],
//           ratio, duration, watermark:false, generate_audio:false }
//         → { id }（Task ID）
//   轮询：GET {base}/contents/generations/tasks/{id}
//         → status: queued|running|succeeded|failed|cancelled
//         → succeeded 时 content.video_url（MP4 预签名链接，及时转存——下载后入 Asset）
//   首帧：image_url.url 接受公网 URL 或 data URL（Base64）；管线首帧 data URI 原样透传
//   图生视频 ratio=adaptive（官方推荐：跟随首帧图比例，i2v 场景不裁不补）
//   时长夹取 [4,12]（1.0 pro 2~12 与 2.5 4~30 的安全交集；extra.duration 显式覆盖）
// 纯 fetch 实现，不引入 SDK；密钥只在请求头出现。

import {
  downloadMedia,
  extractJsonError,
  request,
} from '@/ai/providers/openai-compat'
import { parseExtra, joinUrl } from '@/core/settings/provider-config-service'
import type {
  ProviderCallContext,
  VideoShotPayload,
  VideoShotProvider,
  VideoShotResult,
} from '@/ai/router/types'
import type { ProviderConfigRow } from '@/core/settings/provider-config-service'

// ---------- 参数映射 ----------

/** payload.durationSec → 方舟 duration 数字（4~12 安全交集；extra.duration 显式覆盖） */
export function arkDuration(durationSec: number | undefined, extra: Record<string, unknown>): number {
  if (typeof extra.duration === 'number' && extra.duration >= 1 && extra.duration <= 60) {
    return Math.round(extra.duration)
  }
  const n = Math.round(durationSec ?? 5)
  return Math.min(12, Math.max(4, n))
}

/** i2v ratio：默认 adaptive（跟随首帧图）；extra.ratio 可显式覆盖（16:9/9:16/1:1/4:3/3:4/21:9） */
export function arkRatio(extra: Record<string, unknown>): string {
  if (
    typeof extra.ratio === 'string' &&
    /^(16:9|9:16|1:1|4:3|3:4|21:9|adaptive)$/i.test(extra.ratio)
  ) {
    return extra.ratio.toLowerCase()
  }
  return 'adaptive'
}

// ---------- 执行 ----------

const ARK_POLL_INTERVAL_MS = 5_000
const ARK_POLL_MAX_ATTEMPTS = 48 // 5s × 48 = 240s（提交 60s + 下载 60s → 能力级 330s 内）

interface ArkTask {
  id?: string
  status?: string
  error?: { code?: string; message?: string } | string
  content?: { video_url?: string }
  usage?: Record<string, number>
  seed?: number
}

export function executeVolcArkVideo(row: ProviderConfigRow, payload: VideoShotPayload): Promise<VideoShotResult> {
  const extra = parseExtra(row)
  const extraBody = (extra.body ?? {}) as Record<string, unknown>
  const duration = arkDuration(payload.durationSec, extra)
  const ratio = arkRatio(extra)

  // content 数组（官方形态）：text 运动提示词 + image_url 首帧（data URI 原样）
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: payload.prompt.slice(0, 2500) },
    { type: 'image_url', image_url: { url: payload.imageUrl } },
  ]
  const body: Record<string, unknown> = {
    model: row.modelName,
    content,
    ratio,
    duration,
    watermark: false, // 产品画面不带平台水印（发布页已有 AI 生成标识）
    generate_audio: false, // 产品管线 TTS 旁白，不消费原生音频
    ...extraBody,
  }
  const repro: Record<string, unknown> = { provider: 'volc-ark', duration, ratio }

  return (async (): Promise<VideoShotResult> => {
    // 1. 提交（401/403 = 密钥错误确定性失败；配额/审核错误原样透传）
    const submit = await request('POST', joinUrl(row.baseUrl, '/contents/generations/tasks'), row.apiKey, body, 60_000)
    if (!submit.ok) {
      throw new Error(
        `[方舟视频 ${row.label}] 提交失败：${submit.error ?? extractJsonError(submit.json) ?? '请求失败'}`,
      )
    }
    const taskId = (submit.json as ArkTask | null)?.id
    if (!taskId) {
      throw new Error(
        `[方舟视频 ${row.label}] 提交成功但未返回任务 id（协议形态可能变化）：${JSON.stringify(submit.json).slice(0, 200)}`,
      )
    }
    repro.taskId = taskId

    // 2. 轮询（queued/running → 继续；succeeded → video_url；failed/cancelled → error.message）
    for (let attempt = 1; attempt <= ARK_POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, ARK_POLL_INTERVAL_MS))
      const status = await request(
        'GET',
        joinUrl(row.baseUrl, `/contents/generations/tasks/${encodeURIComponent(taskId)}`),
        row.apiKey,
        undefined,
        30_000,
      )
      if (!status.ok) continue // 瞬时失败继续轮询
      const task = status.json as ArkTask | null
      const s = (task?.status ?? '').toLowerCase()
      if (s === 'succeeded') {
        const videoUrl = task?.content?.video_url
        if (typeof videoUrl !== 'string' || !/^https?:\/\//.test(videoUrl)) {
          throw new Error(`[方舟视频 ${row.label}] 状态成功但未返回视频地址`)
        }
        if (typeof task?.seed === 'number') repro.seed = task.seed
        if (task?.usage && typeof task.usage.total_tokens === 'number') repro.totalTokens = task.usage.total_tokens
        // 3. 下载（TOS 预签名链接，裸下载；带鉴权头反而破坏签名）
        const dl = await downloadMedia(videoUrl, '', 120_000)
        if (dl.bytes.length < 10_000) {
          throw new Error(`[方舟视频 ${row.label}] 视频内容过短（${dl.bytes.length} 字节）`)
        }
        return { base64: dl.bytes.toString('base64'), mime: 'video/mp4', repro }
      }
      if (s === 'failed' || s === 'cancelled' || s === 'canceled') {
        const errMsg =
          extractJsonError(task) ??
          (typeof task?.error === 'string' ? task.error : task?.error?.message) ??
          JSON.stringify(task).slice(0, 200)
        throw new Error(`[方舟视频 ${row.label}] 生成失败：${errMsg}`)
      }
      // queued / running / 空 → 继续轮询
    }
    throw new Error(`[方舟视频 ${row.label}] 轮询超时（>${(ARK_POLL_MAX_ATTEMPTS * ARK_POLL_INTERVAL_MS) / 1000}s）`)
  })()
}

// ---------- 工厂 ----------

/** 方舟适配器：仅 video 通道（Ark 的 llm 通道走 openai-compat 形态已有先例；本适配器专职 Seedance 视频） */
export function buildVolcArkProvider(row: ProviderConfigRow): VideoShotProvider | null {
  if (row.channel !== 'video') return null
  return {
    id: `volc-ark:${row.label}`,
    capability: 'video.shot',
    model: row.modelName,
    execute(payload: VideoShotPayload, _ctx: ProviderCallContext): Promise<VideoShotResult> {
      return executeVolcArkVideo(row, payload)
    },
  }
}
