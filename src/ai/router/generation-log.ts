// Generation 记账（§62 成本可观测）
// 每一次真实 provider 调用（含失败）都落 Generation 表——这是不变量 I4 的白名单区。
import { db } from '@/lib/db'

export interface GenerationLogInput {
  contentId: string
  versionId?: string | null
  type: string // text.plan | image.shot | audio.tts | video.compose
  provider: string
  model: string
  status: 'succeeded' | 'failed'
  purpose?: string
  inputSummary?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
  latencyMs?: number
  cost?: Record<string, unknown>
}

export const generationLog = {
  /** 记账失败绝不影响主链路（观测性让位于可用性） */
  async append(input: GenerationLogInput): Promise<void> {
    try {
      await db.generation.create({
        data: {
          contentId: input.contentId,
          versionId: input.versionId ?? null,
          type: input.type,
          provider: input.provider,
          model: input.model,
          status: input.status,
          inputJson: JSON.stringify({
            purpose: input.purpose,
            ...(input.inputSummary ?? {}),
          }),
          outputJson: input.output ? JSON.stringify(input.output) : null,
          costJson: input.cost ? JSON.stringify(input.cost) : null,
          latencyMs: input.latencyMs ?? null,
        },
      })
    } catch (e) {
      console.warn('[generation-log] 记账失败（不影响主链路）：', e instanceof Error ? e.message : e)
    }
  },

  /** 当前版本最近一次成功产物（video.compose → finalAssetId 映射的数据源） */
  async latestSucceeded(contentId: string, versionId: string | null | undefined, type: string) {
    const rows = await db.generation.findMany({
      where: { contentId, type, status: 'succeeded', ...(versionId ? { versionId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })
    return rows[0] ?? null
  },
}
