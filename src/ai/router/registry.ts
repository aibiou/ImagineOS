// Model Router 注册表与执行器（§28–§30 / §88）
// Application → AI Orchestrator → Model Router → Provider Adapter → Model
//
// 职责：
//   1. 能力 → 候选 provider 链的注册与选择
//   2. 失败处理：单 provider 指数退避重试（≤3 次）→ 同能力 fallback → 全链耗尽抛 ProviderExhaustedError
//   3. 每次尝试（成功/失败）写 Generation 记账（provider/model 只在这里合法出现）
//
// 测试注入口：registerProvider() 允许用 fake provider 整链替换，绝不触网。

import { generationLog } from '@/ai/router/generation-log'
import { zaiLlmProvider } from '@/ai/providers/zai-llm'
import { zaiImageProvider } from '@/ai/providers/zai-image'
import { zaiTtsProvider } from '@/ai/providers/zai-tts'
import { zaiVideoProvider } from '@/ai/providers/zai-video'
import { readProviderConfigs, type ProviderConfigRow } from '@/ai/router/provider-config'
import { buildProviderFromConfig } from '@/ai/providers/openai-compat'
import {
  ProviderExhaustedError,
  type AudioTTSPayload,
  type AudioTTSProvider,
  type AudioTTSResult,
  type ImageShotPayload,
  type ImageShotProvider,
  type ImageShotResult,
  type ProviderCallContext,
  type TextPlanPayload,
  type TextPlanProvider,
  type TextPlanResult,
  type VideoShotPayload,
  type VideoShotProvider,
  type VideoShotResult,
} from '@/ai/router/types'

// ---------- 注册表 ----------

const textPlanChain: TextPlanProvider[] = [zaiLlmProvider]
const imageShotChain: ImageShotProvider[] = [zaiImageProvider]
const audioTtsChain: AudioTTSProvider[] = [zaiTtsProvider]
// video.shot（M1.5 Gate 6）：原生视频链；未注册任何 provider 时管线回落组合式（Ken Burns）
const videoShotChain: VideoShotProvider[] = [zaiVideoProvider]

/** 测试/扩展用：向能力链注册 provider（不指定位置则置为候选首位） */
export function registerProvider(provider: TextPlanProvider, opts?: { prepend?: boolean }): void
export function registerProvider(provider: ImageShotProvider, opts?: { prepend?: boolean }): void
export function registerProvider(provider: AudioTTSProvider, opts?: { prepend?: boolean }): void
export function registerProvider(provider: VideoShotProvider, opts?: { prepend?: boolean }): void
export function registerProvider(
  provider: TextPlanProvider | ImageShotProvider | AudioTTSProvider | VideoShotProvider,
  opts?: { prepend?: boolean },
): void {
  const prepend = opts?.prepend ?? true
  switch (provider.capability) {
    case 'text.plan': {
      const i = textPlanChain.findIndex((p) => p.id === provider.id)
      if (i >= 0) textPlanChain[i] = provider
      else if (prepend) textPlanChain.unshift(provider)
      else textPlanChain.push(provider)
      break
    }
    case 'image.shot': {
      const i = imageShotChain.findIndex((p) => p.id === provider.id)
      if (i >= 0) imageShotChain[i] = provider
      else if (prepend) imageShotChain.unshift(provider)
      else imageShotChain.push(provider)
      break
    }
    case 'audio.tts': {
      const i = audioTtsChain.findIndex((p) => p.id === provider.id)
      if (i >= 0) audioTtsChain[i] = provider
      else if (prepend) audioTtsChain.unshift(provider)
      else audioTtsChain.push(provider)
      break
    }
    case 'video.shot': {
      const i = videoShotChain.findIndex((p) => p.id === provider.id)
      if (i >= 0) videoShotChain[i] = provider
      else if (prepend) videoShotChain.unshift(provider)
      else videoShotChain.push(provider)
      break
    }
  }
}

/** 测试用：清空全部注册（还原为生产链） */
export function resetRegistry(): void {
  textPlanChain.length = 0
  textPlanChain.push(zaiLlmProvider)
  imageShotChain.length = 0
  imageShotChain.push(zaiImageProvider)
  audioTtsChain.length = 0
  audioTtsChain.push(zaiTtsProvider)
  videoShotChain.length = 0
  videoShotChain.push(zaiVideoProvider)
  clearRateState()
}

/** 测试用：完全清空（阻断一切真实调用） */
export function clearRegistry(): void {
  textPlanChain.length = 0
  imageShotChain.length = 0
  audioTtsChain.length = 0
  videoShotChain.length = 0
  clearRateState()
}

/** 测试/评估用：当前 video.shot 链是否有可用 provider（无则管线回落组合式） */
export function hasVideoShotProvider(): boolean {
  return videoShotChain.length > 0
}

// ---------- 动态链同步（ADR-0004：配置驱动的自定义 Provider） ----------

// 纯函数：由配置行构建四条候选链（自定义优先级升序 → z-ai 内置兜底）。
// 导出仅用于单测；生产链经 ensureChainsFresh() 写入下方四个 chain 数组。
// groups：同通道同优先级且有效的自定义 provider ≥2 个 → 轮转组（限速感知调度，见下方策略说明）。
export function buildChainsFromConfigs(rows: ProviderConfigRow[]): {
  text: TextPlanProvider[]
  image: ImageShotProvider[]
  audio: AudioTTSProvider[]
  video: VideoShotProvider[]
  groups: { text: string[][]; image: string[][]; audio: string[][]; video: string[][] }
} {
  const text: TextPlanProvider[] = []
  const image: ImageShotProvider[] = []
  const audio: AudioTTSProvider[] = []
  const video: VideoShotProvider[] = []
  const byPriority: Record<string, Map<number, string[]>> = {
    llm: new Map(), image: new Map(), tts: new Map(), video: new Map(),
  }
  // 自身保证 priority 升序（不信任调用方排序；次序为 createdAt 稳定兜底）
  const sorted = [...rows].sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime())
  for (const row of sorted) {
    const provider = buildProviderFromConfig(row)
    if (!provider) continue
    const bucket = byPriority[row.channel]
    if (bucket) {
      const ids = bucket.get(row.priority) ?? []
      ids.push(provider.id)
      bucket.set(row.priority, ids)
    }
    switch (provider.capability) {
      case 'text.plan': text.push(provider as TextPlanProvider); break
      case 'image.shot': image.push(provider as ImageShotProvider); break
      case 'audio.tts': audio.push(provider as AudioTTSProvider); break
      case 'video.shot': video.push(provider as VideoShotProvider); break
    }
  }
  const groupsOf = (channel: string): string[][] =>
    [...(byPriority[channel]?.values() ?? [])].filter((ids) => ids.length >= 2)
  return {
    text, image, audio, video,
    groups: {
      text: groupsOf('llm'),
      image: groupsOf('image'),
      audio: groupsOf('tts'),
      video: groupsOf('video'),
    },
  }
}

/** 签名：配置变更检测（id+updatedAt+enabled+priority） */
function configSignature(rows: ProviderConfigRow[]): string {
  return rows.map((r) => `${r.id}:${r.updatedAt.toISOString()}:${r.enabled ? 1 : 0}:${r.priority}`).join('|')
}

// 测试环境（NODE_ENV=test）显式控制注册表，动态同步关闭——避免测试触 DB / 意外重建被 clearRegistry() 清空的链
const DYNAMIC_CHAIN_SYNC = process.env.NODE_ENV !== 'test'

let chainSyncState: { sig: string; at: number } | null = null
const CHAIN_SYNC_TTL_MS = 3_000
let chainSyncInflight: Promise<void> | null = null

/** 同优先级轮转组（限速感知调度）：ensureChainsFresh 维护；测试环境不注入（保持链序确定性） */
const rotationGroups: Record<string, string[][]> = {}

/** 每次路由调用前调用：TTL 内零开销；超时或签名变化时重建链（自定义 → z-ai 兜底） */
async function ensureChainsFresh(): Promise<void> {
  if (!DYNAMIC_CHAIN_SYNC) return
  const now = Date.now()
  if (chainSyncState && now - chainSyncState.at < CHAIN_SYNC_TTL_MS) return
  if (chainSyncInflight) return chainSyncInflight
  chainSyncInflight = (async () => {
    try {
      const rows = await readProviderConfigs()
      const sig = configSignature(rows)
      if (chainSyncState?.sig === sig) {
        chainSyncState = { sig, at: now }
        return
      }
      const built = buildChainsFromConfigs(rows)
      textPlanChain.length = 0
      textPlanChain.push(...built.text, zaiLlmProvider)
      imageShotChain.length = 0
      imageShotChain.push(...built.image, zaiImageProvider)
      audioTtsChain.length = 0
      audioTtsChain.push(...built.audio, zaiTtsProvider)
      videoShotChain.length = 0
      videoShotChain.push(...built.video, zaiVideoProvider)
      rotationGroups.text = built.groups.text
      rotationGroups.image = built.groups.image
      rotationGroups.audio = built.groups.audio
      rotationGroups.video = built.groups.video
      chainSyncState = { sig, at: now }
    } finally {
      chainSyncInflight = null
    }
  })()
  return chainSyncInflight
}

// ---------- 重试与超时 ----------

const MAX_ATTEMPTS_PER_PROVIDER = 3
const BASE_BACKOFF_MS = 600

/** 确定性失败（密钥/参数错误）不重试——立即切换下一候选，省去指数退避等待 */
function isNonRetryable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /\b(40[0134])\b|invalid.?api.?key|unauthorized|forbidden|未返回 requestId|不兼容/i.test(msg)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------- 限速感知调度（双免费额度动态利用，2026-10-07） ----------
// 官方限速（wiki.agnes-ai.com tokenplan.md，免费 default 用户，文本 RPM 已减半）：
//   文本实际 RPM 10；图片 1K 档 RPM 10（768x1344 自动归一到 1K/9:16）；视频 RPM 1 + 每日秒数配额；
//   429 官方处置口径 = 等待 1 分钟。agnes-com / agnes-cn 双站点额度独立 → 轮转 + 冷却把
//   有效吞吐翻倍并避开 429 风暴（§0.5.5 P0 的根因之一正是 image 429 重试耗尽）。
// 三层策略：
//   1) 同优先级自定义 provider 逐调用轮转（round-robin）——均匀消耗两家免费额度；
//   2) 命中 429/限流/队列满 → 该 provider 冷却（默认 60s，IMAGINEOS_RATE_COOLDOWN_MS 可调），
//      冷却者排链尾（仍可作最后手段，不作弊式拉黑）；
//   3) 非末位候选命中限速 → 立即让位下一候选（不烧 3 次指数退避加重限流）；
//      末位候选保留原退避重试（单链场景等待恢复）。

const RATE_COOLDOWN_MS = Number(process.env.IMAGINEOS_RATE_COOLDOWN_MS ?? 60_000)
const rateCooldowns = new Map<string, number>() // providerId → 冷却截止 epoch ms
const rotationOffsets: Record<string, number> = {} // capability → 调用计数（轮转偏移取模）

/** 动态读取冷却窗口（模块级 RATE_COOLDOWN_MS 常量仅供调度排序；重试等待读动态值，测试可运行时覆盖） */
function dynamicCooldownMs(): number {
  const env = Number(process.env.IMAGINEOS_RATE_COOLDOWN_MS)
  return Number.isFinite(env) && env > 0 ? env : RATE_COOLDOWN_MS
}

function isRateLimited(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /\b429\b|rate.?limit|too many requests|video_queue_full|队列满|限流/i.test(msg)
}

export interface CandidateOrdering {
  /** 同优先级轮转组（每组 ≥2 个 provider id） */
  rotationGroups?: string[][]
  /** 轮转偏移（按调用计数传入） */
  rotationOffset?: number
  /** providerId → 冷却截止 epoch ms */
  cooldowns?: Map<string, number>
  now?: number
}

/** 纯函数（导出供单测）：轮转 + 冷却重排候选链。轮转仅重排组内相对次序，不越过组外位置。 */
export function orderCandidates<T extends { id: string }>(chain: T[], opts: CandidateOrdering = {}): T[] {
  let ordered = [...chain]
  for (const group of opts.rotationGroups ?? []) {
    if (group.length < 2) continue
    const ids = new Set(group)
    const members = ordered.filter((p) => ids.has(p.id))
    if (members.length < 2) continue
    const offset = Math.abs(opts.rotationOffset ?? 0) % members.length
    if (offset === 0) continue
    const rotated = [...members.slice(offset), ...members.slice(0, offset)]
    let i = 0
    ordered = ordered.map((p) => (ids.has(p.id) ? rotated[i++]! : p))
  }
  const now = opts.now ?? Date.now()
  const cd = opts.cooldowns
  if (cd && cd.size > 0) {
    const cooling = ordered.filter((p) => (cd.get(p.id) ?? 0) > now)
    if (cooling.length > 0 && cooling.length < ordered.length) {
      ordered = [...ordered.filter((p) => (cd.get(p.id) ?? 0) <= now), ...cooling]
    }
  }
  return ordered
}

/** 组装一次调用的候选次序（轮转偏移随每次调用递增 → 双额度交替消耗） */
function candidatesFor<T extends { id: string }>(capability: string, chain: T[]): T[] {
  const ordered = orderCandidates([...chain], {
    rotationGroups: rotationGroups[capability],
    rotationOffset: rotationOffsets[capability] ?? 0,
    cooldowns: rateCooldowns,
  })
  rotationOffsets[capability] = (rotationOffsets[capability] ?? 0) + 1
  return ordered
}

/** 运维/测试可观测：当前仍在冷却的 provider 快照 */
export function rateCooldownSnapshot(): Array<{ providerId: string; untilEpochMs: number }> {
  const now = Date.now()
  return [...rateCooldowns.entries()]
    .filter(([, until]) => until > now)
    .map(([providerId, untilEpochMs]) => ({ providerId, untilEpochMs }))
}

/** 还原限速调度状态（resetRegistry/clearRegistry 调用，防测试间污染） */
function clearRateState(): void {
  rateCooldowns.clear()
  for (const k of Object.keys(rotationOffsets)) delete rotationOffsets[k]
  for (const k of Object.keys(rotationGroups)) delete rotationGroups[k]
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`超时（>${ms}ms）：${label}`)), ms)),
  ])
}

/** 账本输入摘要：提取 payload.prompt（截断 4000 字）+ payload.size（画幅尺寸声明）——
 *  世界一致性注入与画幅声明是否真的发生在调用时刻的直接证据 */
function promptSummaryOf(payload: unknown): Record<string, unknown> | undefined {
  if (typeof payload === 'object' && payload !== null && 'prompt' in payload) {
    const summary: Record<string, unknown> = {}
    const v = (payload as { prompt?: unknown }).prompt
    if (typeof v === 'string' && v.length > 0) summary.prompt = v.length > 4000 ? `${v.slice(0, 4000)}…` : v
    const s = (payload as { size?: unknown }).size
    if (typeof s === 'string' && s.length > 0) summary.size = s
    return Object.keys(summary).length > 0 ? summary : undefined
  }
  return undefined
}

// 能力级超时熔断（毫秒）
const TIMEOUTS: Record<string, number> = {
  'text.plan': 90_000,
  'image.shot': 180_000,
  'audio.tts': 120_000,
  'video.shot': 330_000, // 含提交+轮询+下载（provider 内部 5min 轮询上限 + 余量）
}

async function runWithRetry<P, R>(
  capability: string,
  provider: { id: string; model: string; execute(payload: P, ctx: ProviderCallContext): Promise<R> },
  payload: P,
  ctx: ProviderCallContext,
  opts?: { failFastOnRateLimit?: boolean },
): Promise<R> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PROVIDER; attempt++) {
    const startedAt = Date.now()
    try {
      const result = await withTimeout(
        provider.execute(payload, ctx),
        TIMEOUTS[capability] ?? 120_000,
        `${provider.id}#${attempt}`,
      )
      const latencyMs = Date.now() - startedAt
      await generationLog.append({
        contentId: ctx.contentId,
        versionId: ctx.versionId ?? null,
        type: capability,
        provider: provider.id,
        model: provider.model,
        status: 'succeeded',
        purpose: ctx.purpose,
        inputSummary: promptSummaryOf(payload),
        latencyMs,
      })
      return result
    } catch (e) {
      lastError = e
      const latencyMs = Date.now() - startedAt
      const message = e instanceof Error ? e.message : String(e)
      await generationLog.append({
        contentId: ctx.contentId,
        versionId: ctx.versionId ?? null,
        type: capability,
        provider: provider.id,
        model: provider.model,
        status: 'failed',
        purpose: ctx.purpose,
        inputSummary: promptSummaryOf(payload),
        error: message,
        latencyMs,
      })
      if (isRateLimited(e)) {
        // 限速命中：记录冷却（下一次调用起排链尾）；非末位候选立即让位，不烧退避重试加重限流
        rateCooldowns.set(provider.id, Date.now() + RATE_COOLDOWN_MS)
        if (opts?.failFastOnRateLimit) break
        // 末位候选（无候选可让位）：video.shot 等满冷却窗口再重试。
        // 实证（2026-10-08 E2E 账本）：zai key 视频并发=1，在途任务 62–75s；600ms 指数退避
        // 在 ~2s 内烧完 3 次尝试、全程落在限流窗口内，native 镜头无谓阵亡（5 镜 4 亡）。
        // 其余能力维持指数退避（TTS 实证 429 窗口 <1s，600ms 即恢复）。
        if (attempt < MAX_ATTEMPTS_PER_PROVIDER) {
          await sleep(capability === 'video.shot' ? dynamicCooldownMs() : BASE_BACKOFF_MS * 2 ** (attempt - 1))
          continue
        }
      }
      if (isNonRetryable(e)) break // 确定性失败：重试无意义，立即降级到下一候选
      if (attempt < MAX_ATTEMPTS_PER_PROVIDER) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

// ---------- 执行入口（业务侧唯一 API） ----------

export const router = {
  async text(
    payload: TextPlanPayload,
    ctx: ProviderCallContext,
  ): Promise<{ result: TextPlanResult; providerId: string; model: string; latencyMs: number }> {
    await ensureChainsFresh()
    if (textPlanChain.length === 0) throw new ProviderExhaustedError('text.plan', [{ providerId: '(none)', error: '无注册 provider（测试环境？）' }])
    const candidates = candidatesFor('text', textPlanChain)
    const attempts: Array<{ providerId: string; error: string }> = []
    for (let i = 0; i < candidates.length; i++) {
      const provider = candidates[i]!
      try {
        const result = await runWithRetry('text.plan', provider, payload, ctx, { failFastOnRateLimit: i < candidates.length - 1 })
        return { result, providerId: provider.id, model: provider.model, latencyMs: 0 }
      } catch (e) {
        attempts.push({ providerId: provider.id, error: e instanceof Error ? e.message : String(e) })
      }
    }
    throw new ProviderExhaustedError('text.plan', attempts)
  },

  async image(
    payload: ImageShotPayload,
    ctx: ProviderCallContext,
  ): Promise<{ result: ImageShotResult; providerId: string; model: string }> {
    await ensureChainsFresh()
    if (imageShotChain.length === 0) throw new ProviderExhaustedError('image.shot', [{ providerId: '(none)', error: '无注册 provider' }])
    const candidates = candidatesFor('image', imageShotChain)
    const attempts: Array<{ providerId: string; error: string }> = []
    for (let i = 0; i < candidates.length; i++) {
      const provider = candidates[i]!
      try {
        const result = await runWithRetry('image.shot', provider, payload, ctx, { failFastOnRateLimit: i < candidates.length - 1 })
        return { result, providerId: provider.id, model: provider.model }
      } catch (e) {
        attempts.push({ providerId: provider.id, error: e instanceof Error ? e.message : String(e) })
      }
    }
    throw new ProviderExhaustedError('image.shot', attempts)
  },

  async tts(
    payload: AudioTTSPayload,
    ctx: ProviderCallContext,
  ): Promise<{ result: AudioTTSResult; providerId: string; model: string }> {
    await ensureChainsFresh()
    if (audioTtsChain.length === 0) throw new ProviderExhaustedError('audio.tts', [{ providerId: '(none)', error: '无注册 provider' }])
    const candidates = candidatesFor('audio', audioTtsChain)
    const attempts: Array<{ providerId: string; error: string }> = []
    for (let i = 0; i < candidates.length; i++) {
      const provider = candidates[i]!
      try {
        const result = await runWithRetry('audio.tts', provider, payload, ctx, { failFastOnRateLimit: i < candidates.length - 1 })
        return { result, providerId: provider.id, model: provider.model }
      } catch (e) {
        attempts.push({ providerId: provider.id, error: e instanceof Error ? e.message : String(e) })
      }
    }
    throw new ProviderExhaustedError('audio.tts', attempts)
  },

  async video(
    payload: VideoShotPayload,
    ctx: ProviderCallContext,
  ): Promise<{ result: VideoShotResult; providerId: string; model: string }> {
    await ensureChainsFresh()
    if (videoShotChain.length === 0) throw new ProviderExhaustedError('video.shot', [{ providerId: '(none)', error: '无注册 provider' }])
    const candidates = candidatesFor('video', videoShotChain)
    const attempts: Array<{ providerId: string; error: string }> = []
    for (let i = 0; i < candidates.length; i++) {
      const provider = candidates[i]!
      try {
        const result = await runWithRetry('video.shot', provider, payload, ctx, { failFastOnRateLimit: i < candidates.length - 1 })
        return { result, providerId: provider.id, model: provider.model }
      } catch (e) {
        attempts.push({ providerId: provider.id, error: e instanceof Error ? e.message : String(e) })
      }
    }
    throw new ProviderExhaustedError('video.shot', attempts)
  },
}
