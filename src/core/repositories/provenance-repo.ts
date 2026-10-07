// Provenance 仓储 —— 不变量 I3：只追加，不更新不删除（§34）
import type { DbClient, Provenance } from './types'

export const PROVENANCE_EVENT_TYPES = [
  'content_created',
  'version_created',
  'version_restored',
  'status_changed',
  'remixed',
  'remix_received',
  'published',
  'unpublished',
  'ai_generated',
  'generation_failed',
] as const

export const provenanceRepo = {
  append(
    db: DbClient,
    data: {
      contentId: string
      versionId?: string | null
      eventType: (typeof PROVENANCE_EVENT_TYPES)[number]
      actorType: 'human' | 'ai' | 'system'
      actorId?: string
      provider?: string
      model?: string
      payload?: Record<string, unknown>
    },
  ): Promise<Provenance> {
    return db.provenance.create({
      data: {
        contentId: data.contentId,
        versionId: data.versionId ?? undefined,
        eventType: data.eventType,
        actorType: data.actorType,
        actorId: data.actorId,
        provider: data.provider,
        model: data.model,
        payloadJson: data.payload ? JSON.stringify(data.payload) : undefined,
      },
    })
  },

  listByContent(db: DbClient, contentId: string, limit = 50): Promise<Provenance[]> {
    return db.provenance.findMany({ where: { contentId }, orderBy: { createdAt: 'desc' }, take: limit })
  },
}

// 结构性自检：不暴露 update/delete（测试断言用）
export const PROVENANCE_REPO_MUTATORS: string[] = []
