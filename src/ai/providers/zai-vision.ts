// 视觉评审 Provider Adapter（z-ai chat.completions.createVision，质量门 in-loop 通道）
// 能力：vision.review —— 多模态快审（待审镜头图 + 参考帧 + 评审指令 → 评审文本）。
// 与离线盲评脚本（scripts/m15/vlm-*.mjs）同一调用形态，进 Router 后自动获得：
//   重试/冷却语义 + Generation 记账（type=vision.review）+ 未来自定义 VLM provider 的可插拔位。
// 评审文本的 JSON verdict 解析由调用方（src/core/quality/shot-gate.ts）负责——Provider 保持薄转发。
import { getZai } from '@/ai/router/zai-client'
import type {
  ProviderCallContext,
  VisionReviewPayload,
  VisionReviewProvider,
  VisionReviewResult,
} from '@/ai/router/types'

export const zaiVisionProvider: VisionReviewProvider = {
  id: 'zai-vision',
  capability: 'vision.review',
  model: 'glm-4.5v',
  async execute(payload: VisionReviewPayload, _ctx: ProviderCallContext): Promise<VisionReviewResult> {
    const zai = await getZai()
    const content: Array<{ type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string }> = [
      ...payload.images.map((im) => ({
        type: 'image_url' as const,
        image_url: { url: `data:${im.mime ?? 'image/png'};base64,${im.base64}` },
      })),
      { type: 'text' as const, text: `${payload.system}\n\n${payload.user}` },
    ]
    // 与离线盲评脚本/SDK CLI 同一调用形态：不显式指定 model（服务端默认视觉模型），
    // body 仅在类型层满足 SDK 签名（CreateChatCompletionVisionBody.model 为必填的过严声明）
    const res = (await zai.chat.completions.createVision({
      messages: [{ role: 'user', content }],
      thinking: { type: 'disabled' },
    } as Parameters<typeof zai.chat.completions.createVision>[0])) as { choices?: Array<{ message?: { content?: unknown } }> }
    const text = res?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) throw new Error('视觉评审返回空内容')
    return { text }
  },
}
