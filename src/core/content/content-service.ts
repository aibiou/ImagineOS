// Content 生命周期服务（§48 / §51 / §63 前段）
// 边界纪律：本文件不 import 任何模型 SDK（ADR-0002 lint 守卫）
import { db } from '@/lib/db'
import { DomainValidationError, IllegalTransitionError, NotFoundError } from '@/core/errors'
import { contentRepo } from '@/core/repositories/content-repo'
import { provenanceRepo } from '@/core/repositories/provenance-repo'
import { remixRepo } from '@/core/repositories/remix-repo'
import { assertTransition, isCreativeStatus } from '@/core/content/state-machine'
import type { Content } from '@/core/repositories/types'
import type { StartCreationInput } from '@/core/content/schemas'

/** 从自然语言表达推导初始标题（用户后续可改，UX 原则六） */
export function deriveTitle(rawExpression: string): string {
  const cleaned = rawExpression.replace(/\s+/g, ' ').trim()
  return cleaned.length > 24 ? `${cleaned.slice(0, 24)}…` : cleaned
}

export const contentService = {
  /**
   * 主链第一环：Human Intent 的原始表达落地为 Content Object 雏形（IDEA 态）
   * Intent Engine（E3/M1）随后把 rawExpression 编译为结构化 Intent
   */
  async startCreation(input: StartCreationInput & { ownerId: string; projectId?: string }): Promise<Content> {
    const title = deriveTitle(input.text)
    return db.$transaction(async (tx) => {
      const content = await contentRepo.create(tx, {
        ownerId: input.ownerId,
        title,
        projectId: input.projectId,
        status: 'IDEA',
      })
      await tx.intent.create({ data: { contentId: content.id, rawExpression: input.text } })
      await provenanceRepo.append(tx, {
        contentId: content.id,
        eventType: 'content_created',
        actorType: 'human',
        actorId: input.ownerId,
        payload: { rawExpressionChars: input.text.length, initialStatus: 'IDEA' },
      })
      return content
    })
  },

  async getOwnedOrVisibleContent(contentId: string, viewerId: string | null) {
    const content = await contentRepo.findByIdWithDetail(db, contentId)
    if (!content) throw new NotFoundError('作品', contentId)
    const isOwner = viewerId !== null && content.ownerId === viewerId
    const isPubliclyVisible = content.visibility === 'public' || content.visibility === 'unlisted'
    if (!isOwner && !isPubliclyVisible) {
      // 不可见时与不存在同语义，避免枚举探测
      throw new NotFoundError('作品', contentId)
    }
    return { content, isOwner }
  },

  /** 状态机推进（唯一合法入口：先断言跳转再落库） */
  async advanceStatus(contentId: string, to: string, actorId: string): Promise<Content> {
    if (!isCreativeStatus(to)) {
      throw new DomainValidationError(`未知状态：${to}（合法值见 CREATIVE_STATUSES）`)
    }
    return db.$transaction(async (tx) => {
      const content = await contentRepo.findById(tx, contentId)
      if (!content) throw new NotFoundError('作品', contentId)
      const from = content.status
      if (!isCreativeStatus(from)) {
        throw new DomainValidationError(`作品状态脏数据：${from}`)
      }
      assertTransition(from, to) // 非法跳转抛 IllegalTransitionError
      const updated = await contentRepo.update(tx, contentId, { status: to })
      await provenanceRepo.append(tx, {
        contentId,
        eventType: 'status_changed',
        actorType: 'human',
        actorId,
        payload: { from, to },
      })
      return updated
    })
  },

  async setMetadata(
    contentId: string,
    actorId: string,
    data: { title?: string; description?: string; remixPermission?: 'allow' | 'deny' },
  ): Promise<Content> {
    return db.$transaction(async (tx) => {
      const content = await contentRepo.findById(tx, contentId)
      if (!content) throw new NotFoundError('作品', contentId)
      if (content.ownerId !== actorId) {
        throw new DomainValidationError('只有作者可以修改作品元数据')
      }
      return contentRepo.update(tx, contentId, data)
    })
  },

  /** 最小发布（完整发布表单/封面选择属 E10/M3；此处打通状态+Publication+可见性） */
  async publishMinimal(
    contentId: string,
    actorId: string,
    input: { visibility: 'private' | 'unlisted' | 'public'; description?: string },
  ): Promise<Content> {
    return db.$transaction(async (tx) => {
      const content = await contentRepo.findById(tx, contentId)
      if (!content) throw new NotFoundError('作品', contentId)
      if (content.ownerId !== actorId) throw new DomainValidationError('只有作者可以发布作品')
      if (content.status !== 'READY') {
        throw new IllegalTransitionError(content.status, 'PUBLISHED')
      }
      const updated = await contentRepo.update(tx, contentId, { status: 'PUBLISHED', visibility: input.visibility })
      const existing = await tx.publication.findUnique({ where: { contentId } })
      if (existing) {
        await tx.publication.update({
          where: { contentId },
          data: { visibility: input.visibility, description: input.description ?? existing.description, unpublishedAt: null },
        })
      } else {
        await tx.publication.create({
          data: {
            contentId,
            title: content.title,
            description: input.description,
            visibility: input.visibility,
            remixPermission: content.remixPermission,
          },
        })
      }
      await provenanceRepo.append(tx, {
        contentId,
        eventType: 'published',
        actorType: 'human',
        actorId,
        payload: { visibility: input.visibility },
      })
      return updated
    })
  },

  listMyContents(ownerId: string) {
    return contentRepo.listByOwner(db, ownerId)
  },

  listExplore() {
    return contentRepo.listPublic(db)
  },

  /** 详情聚合：作品 + 溯源尾部 + 衍生树（API 层不直触 DB） */
  async getContentBundle(contentId: string, viewerId: string | null) {
    const { content, isOwner } = await this.getOwnedOrVisibleContent(contentId, viewerId)
    const provenance = await provenanceRepo.listByContent(db, contentId, 20)
    const remixes = await remixRepo.listBySource(db, contentId)
    return {
      content,
      isOwner,
      provenance,
      remixes: remixes.map((r) => ({
        id: r.id,
        derivative: r.derivativeContent,
        remixerName: r.remixer.displayName,
        createdAt: r.createdAt,
      })),
    }
  },
}
