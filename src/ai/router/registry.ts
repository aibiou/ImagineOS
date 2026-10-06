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
}

/** 测试用：完全清空（阻断一切真实调用） */
export function clearRegistry(): void {
  textPlanChain.length = 0
  imageShotChain.length = 0
  audioTtsChain.length = 0
  videoShotChain.length = 0
}

/** 测试/评估用：当前 video.shot 链是否有可用 provider（无则管线回落组合式） */
export function hasVideoShotProvider(): boolean {
  return videoShotChain.length > 0
}

// ---------- 重试与超时 ----------

const MAX_ATTEMPTS_PER_PROVIDER = 3
const BASE_BACKOFF_MS = 600

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`超时（>${ms}ms）：${label}`)), ms)),
  ])
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
        error: message,
        latencyMs,
      })
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
    if (textPlanChain.length === 0) throw new ProviderExhaustedError('text.plan', [{ providerId: '(none)', error: '无注册 provider（测试环境？）' }])
    const attempts: Array<{ providerId: string; error: string }> = []
    for (const provider of [...textPlanChain]) {
      try {
        const result = await runWithRetry('text.plan', provider, payload, ctx)
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
    if (imageShotChain.length === 0) throw new ProviderExhaustedError('image.shot', [{ providerId: '(none)', error: '无注册 provider' }])
    const attempts: Array<{ providerId: string; error: string }> = []
    for (const provider of [...imageShotChain]) {
      try {
        const result = await runWithRetry('image.shot', provider, payload, ctx)
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
    if (audioTtsChain.length === 0) throw new ProviderExhaustedError('audio.tts', [{ providerId: '(none)', error: '无注册 provider' }])
    const attempts: Array<{ providerId: string; error: string }> = []
    for (const provider of [...audioTtsChain]) {
      try {
        const result = await runWithRetry('audio.tts', provider, payload, ctx)
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
    if (videoShotChain.length === 0) throw new ProviderExhaustedError('video.shot', [{ providerId: '(none)', error: '无注册 provider' }])
    const attempts: Array<{ providerId: string; error: string }> = []
    for (const provider of [...videoShotChain]) {
      try {
        const result = await runWithRetry('video.shot', provider, payload, ctx)
        return { result, providerId: provider.id, model: provider.model }
      } catch (e) {
        attempts.push({ providerId: provider.id, error: e instanceof Error ? e.message : String(e) })
      }
    }
    throw new ProviderExhaustedError('video.shot', attempts)
  },
}
