// Model Router 类型系统（Master Brief §27–§30 / ADR-0002 边界）
// 铁律：业务层（src/app、src/core）只声明能力需求，永不出现 provider/model 名。
// provider/model 名只允许存在于：本目录、providers/、Generation/GenerationJob/Provenance 记录。

// ---------- 能力分类（§29） ----------

export const CAPABILITIES = ['text.plan', 'image.shot', 'audio.tts', 'video.compose'] as const
export type Capability = (typeof CAPABILITIES)[number]

// ---------- 调用上下文（记账与溯源用） ----------

export interface ProviderCallContext {
  contentId: string
  versionId?: string | null
  /** 本次调用的业务目的（intent.extract / directions.generate / story.generate / shot.image / narration.tts / video.compose / revision.locate） */
  purpose: string
  /** 触发者（人类用户 id；系统自动重试时仍记原触发者） */
  actorId?: string | null
}

// ---------- 各能力的 Payload / Result ----------

export interface TextPlanPayload {
  system: string
  user: string
  /** 结构化输出提示（JSON 形态说明），配合 completeJson 使用 */
  jsonHint?: string
  temperature?: number
}

export interface TextPlanResult {
  text: string
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
}

export type ImageSize =
  | '1024x1024'
  | '768x1344'
  | '864x1152'
  | '1344x768'
  | '1152x864'
  | '1440x720'
  | '720x1440'

export interface ImageShotPayload {
  prompt: string
  /** 画幅：9:16 竖屏 → '768x1344'；16:9 横屏 → '1344x768' */
  size: ImageSize
}

export interface ImageShotResult {
  base64: string
  mime: string
}

export interface AudioTTSPayload {
  text: string
  voice?: string
  speed?: number
}

export interface AudioTTSResult {
  base64: string
  mime: string
}

// video.compose 的 Payload/Result 由 src/media 合成器定义（组合式管线，ADR-0001），
// Provider 只做能力转发，此处不重复建模。

// ---------- Provider 接口 ----------

export interface BaseProvider {
  /** 注册名（执行层标识，允许出现在 Generation 记录中） */
  id: string
  capability: Capability
  /** 记账用模型名（执行层标识） */
  model: string
}

export interface TextPlanProvider extends BaseProvider {
  capability: 'text.plan'
  execute(payload: TextPlanPayload, ctx: ProviderCallContext): Promise<TextPlanResult>
}

export interface ImageShotProvider extends BaseProvider {
  capability: 'image.shot'
  execute(payload: ImageShotPayload, ctx: ProviderCallContext): Promise<ImageShotResult>
}

export interface AudioTTSProvider extends BaseProvider {
  capability: 'audio.tts'
  execute(payload: AudioTTSPayload, ctx: ProviderCallContext): Promise<AudioTTSResult>
}

export type AnyProvider = TextPlanProvider | ImageShotProvider | AudioTTSProvider

// ---------- 路由结果（带执行元数据） ----------

export interface Executed<T> {
  result: T
  /** 实际服务本次调用的 provider（fallback 后可能与首选不同） */
  providerId: string
  model: string
  latencyMs: number
  attempts: number
}

// ---------- 失败 ----------

/** 全部候选 provider 均失败（含重试耗尽） */
export class ProviderExhaustedError extends Error {
  readonly capability: Capability
  readonly attempts: Array<{ providerId: string; error: string }>
  constructor(capability: Capability, attempts: Array<{ providerId: string; error: string }>) {
    super(`[ModelRouter] 能力 ${capability} 的全部候选 Provider 失败：${attempts.map((a) => `${a.providerId}(${a.error})`).join(' → ')}`)
    this.name = 'ProviderExhaustedError'
    this.capability = capability
    this.attempts = attempts
  }
}
