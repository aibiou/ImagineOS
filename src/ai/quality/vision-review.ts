// 镜头质量门——编排壳（触 Model Router 的部分；设计见 docs/design/quality-reproduction.md §2）
// 架构边界（§87）：core/quality 只留纯函数；本模块在 src/ai 层持有 router 依赖。
// 职责：verdict 解析（stripJsonFence + Zod）、reviewImage / reviewVideo（router.vision 多模态调用）。
// 纪律：任何异常 → null（调用方诚实降级 skipped），绝不冒充通过、绝不阻塞管线。
import { router } from '@/ai/router/registry'
import { stripJsonFence } from '@/ai/router/llm-json'
import type { ProviderCallContext } from '@/ai/router/types'
import {
  GATE_SYSTEM_PROMPT,
  GATE_VERDICT_SCHEMA,
  buildImageGateUserPrompt,
  buildVideoGateUserPrompt,
  type GateFacts,
  type GateVerdict,
} from '@/core/quality/shot-gate'

/** verdict 解析（容错：解析失败返回 null，由调用方降级 skipped） */
export function parseGateVerdict(text: string): GateVerdict | null {
  try {
    const parsed = JSON.parse(stripJsonFence(text)) as unknown
    const validated = GATE_VERDICT_SCHEMA.safeParse(parsed)
    if (validated.success) return validated.data
    return null
  } catch {
    return null
  }
}

/** 单次图像快审：调用 router.vision → 解析；任何异常 → null（VLM 不可用：诚实降级，绝不冒充通过） */
export async function reviewImage(
  imageBase64: string,
  mime: string,
  facts: GateFacts,
  reference: { base64: string; mime: string } | null,
  ctx: ProviderCallContext,
): Promise<GateVerdict | null> {
  const images: Array<{ base64: string; mime?: string }> = reference
    ? [{ base64: reference.base64, mime: reference.mime }, { base64: imageBase64, mime }]
    : [{ base64: imageBase64, mime }]
  try {
    const { result } = await router.vision(
      {
        system: GATE_SYSTEM_PROMPT,
        user: buildImageGateUserPrompt(facts, reference != null),
        images,
      },
      { ...ctx, purpose: 'gate.image' },
    )
    return parseGateVerdict(result.text)
  } catch {
    return null
  }
}

/** 视频快审（首帧 + 中点抽帧）：严格门。返回 null = 评审不可用（放行，标注 skipped） */
export async function reviewVideo(
  firstFrameBase64: string,
  midFrameBase64: string,
  facts: GateFacts,
  ctx: ProviderCallContext,
): Promise<GateVerdict | null> {
  try {
    const { result } = await router.vision(
      {
        system: GATE_SYSTEM_PROMPT,
        user: buildVideoGateUserPrompt(facts),
        images: [
          { base64: firstFrameBase64, mime: 'image/png' },
          { base64: midFrameBase64, mime: 'image/jpeg' },
        ],
      },
      { ...ctx, purpose: 'gate.video' },
    )
    return parseGateVerdict(result.text)
  } catch {
    return null
  }
}
