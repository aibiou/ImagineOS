// LLM Provider Adapter（z-ai chat.completions）
// 能力：text.plan —— 意图抽取 / 创作方向 / 故事分镜 / 修订定位 共用
import { getZai } from '@/ai/router/zai-client'
import type { ProviderCallContext, TextPlanPayload, TextPlanResult, TextPlanProvider } from '@/ai/router/types'

interface ChatCompletionLike {
  choices?: Array<{ message?: { content?: unknown } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

/** 从任意 SDK 返回形态中稳取出文本（choices[].message.content 可能是 string / parts 数组） */
function extractContent(raw: unknown): string {
  const res = raw as ChatCompletionLike | null
  const content = res?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text ?? '') : ''))
      .join('')
  }
  throw new Error(`LLM 返回形态无法解析（choices[0].message.content 缺失）`)
}

export const zaiLlmProvider: TextPlanProvider = {
  id: 'zai-chat',
  capability: 'text.plan',
  model: 'zai-chat-default',
  async execute(payload: TextPlanPayload, _ctx: ProviderCallContext): Promise<TextPlanResult> {
    const zai = await getZai()
    const raw = (await zai.chat.completions.create({
      messages: [
        { role: 'system', content: payload.system },
        { role: 'user', content: payload.user },
      ],
      thinking: { type: 'disabled' },
      ...(payload.temperature !== undefined ? { temperature: payload.temperature } : {}),
    })) as ChatCompletionLike

    const text = extractContent(raw)
    if (!text.trim()) throw new Error('LLM 返回空内容')
    const usage = raw?.usage
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
  },
}
