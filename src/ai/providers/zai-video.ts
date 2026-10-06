// 原生视频 Provider Adapter（z-ai video.generations，M1.5 Gate 6 / ADR-0001 修订）
// 能力：video.shot —— 镜头级图生视频（首帧 = 分镜图像 + 运动提示词）
// 语义：提交异步任务 → 轮询 task_status → 下载 MP4 → base64 返回
// 与组合式管线（Ken Burns + xfade）互补：两条路径由管线按镜头配方 motion 字段调度，
// 落入同一 Generation 记账 / Evaluation Framework（不变量 I4 白名单区）。
import { getZai } from '@/ai/router/zai-client'
import type { VideoShotPayload, VideoShotResult, VideoShotProvider, ProviderCallContext } from '@/ai/router/types'

const POLL_INTERVAL_MS = 6_000
const POLL_DEADLINE_MS = 300_000 // 单镜头 5 分钟上限（quality=speed 实测 ~60s）

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export const zaiVideoProvider: VideoShotProvider = {
  id: 'zai-video',
  capability: 'video.shot',
  model: 'cogvideox-3',
  async execute(payload: VideoShotPayload, _ctx: ProviderCallContext): Promise<VideoShotResult> {
    const zai = await getZai()

    // ---- 1. 提交图生视频任务 ----
    const created = (await zai.video.generations.create({
      prompt: payload.prompt,
      image_url: payload.imageUrl,
      quality: payload.speedFirst === false ? 'quality' : 'speed',
      with_audio: false, // 音轨由组合层统一编排（TTS 旁白时间线）
      watermark_enabled: false,
      ...(payload.size ? { size: payload.size } : {}),
      ...(payload.durationSec ? { duration: payload.durationSec } : {}),
    })) as { id?: string; task_status?: string }

    const taskId = created?.id
    if (!taskId) throw new Error('视频生成任务提交失败（未返回任务 id）')

    // ---- 2. 轮询任务状态 ----
    const deadline = Date.now() + POLL_DEADLINE_MS
    for (;;) {
      await sleep(POLL_INTERVAL_MS)
      const status = (await zai.async.result.query(taskId)) as {
        task_status?: string
        video_result?: Array<{ url?: string }>
        video_url?: string
        url?: string
      }
      if (status?.task_status === 'FAIL') throw new Error('视频生成任务失败（provider 返回 FAIL）')
      if (status?.task_status === 'SUCCESS') {
        const url = status.video_result?.[0]?.url ?? status.video_url ?? status.url
        if (!url) throw new Error('视频生成成功但未返回下载地址')
        // ---- 3. 下载 MP4 ----
        const res = await fetch(url)
        if (!res.ok) throw new Error(`视频下载失败：HTTP ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length < 10_000) throw new Error('视频下载内容过小（疑似无效响应）')
        return { base64: buf.toString('base64'), mime: 'video/mp4' }
      }
      if (Date.now() > deadline) throw new Error(`视频生成轮询超时（>${POLL_DEADLINE_MS}ms，任务 ${taskId}）`)
    }
  },
}
