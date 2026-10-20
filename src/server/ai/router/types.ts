// Model Router task types (Brief §27). Alpha provider: ZAI adapter only.
export type RouterTask =
  | 'llm.chat' | 'image.generate' | 'audio.tts' | 'audio.asr'
  | 'video.generate' // 预留：替换为真视频模型时上层零改动（ADR-001）
export interface RouterResult<T> {
  data: T
  provider: string
  model: string
  latencyMs: number
  costEstimate?: number
}

