// 版本系统服务（§24–§25）
// 核心不变量：修订永不覆盖旧版本；restore = 创建指向被恢复内容的新版本
import { db } from '@/lib/db'
import { DomainValidationError, NotFoundError } from '@/core/errors'
import { versionRepo } from '@/core/repositories/version-repo'
import { contentRepo } from '@/core/repositories/content-repo'
import { provenanceRepo } from '@/core/repositories/provenance-repo'
import { parseStructure, serializeStructure, type VersionStructureInput } from '@/core/content/schemas'
import type { ContentVersion } from '@/core/repositories/types'

export const versionService = {
  /**
   * 创建新版本（initial / revision / regenerate）
   * - structure 未提供时继承当前版本结构（配方延续）
   * - parentVersionId = 当前版本（血缘链）
   */
  async createVersion(
    contentId: string,
    actorId: string,
    input: {
      method: 'initial' | 'revision' | 'regenerate'
      changelog?: string
      structure?: VersionStructureInput
      title?: string
    },
  ): Promise<ContentVersion> {
    return db.$transaction(async (tx) => {
      const content = await contentRepo.findById(tx, contentId)
      if (!content) throw new NotFoundError('作品', contentId)
      if (content.ownerId !== actorId) throw new DomainValidationError('只有作者可以创建新版本')

      const current = content.currentVersionId
        ? await versionRepo.findById(tx, content.currentVersionId)
        : null

      // 配方延续：未提供 structure 时继承上一版（§24 修订语义）
      const structure = input.structure ?? (current ? parseStructure(current.structureJson) : undefined)
      const structureJson = structure ? serializeStructure(structure) : undefined

      const versionNumber = await versionRepo.nextVersionNumber(tx, contentId)
      const version = await versionRepo.create(tx, {
        contentId,
        versionNumber,
        parentVersionId: current?.id ?? null,
        createdBy: actorId,
        creationMethod: input.method,
        changelog: input.changelog,
        structureJson,
      })

      // 现势指针前移（不变量 I6）；标题可随版本微调
      await contentRepo.update(tx, contentId, {
        currentVersionId: version.id,
        ...(input.title ? { title: input.title } : {}),
      })

      await provenanceRepo.append(tx, {
        contentId,
        versionId: version.id,
        eventType: 'version_created',
        actorType: 'human',
        actorId,
        payload: { versionNumber, method: input.method, changelog: input.changelog ?? null },
      })
      return version
    })
  },

  /**
   * 恢复历史版本（§25）：恢复也是"创建新版本"——血缘不撒谎
   * v1→v2→v3 之后 restore v1 ⇒ v4(parent=v3, 内容=v1)
   */
  async restoreVersion(contentId: string, targetVersionId: string, actorId: string): Promise<ContentVersion> {
    return db.$transaction(async (tx) => {
      const content = await contentRepo.findById(tx, contentId)
      if (!content) throw new NotFoundError('作品', contentId)
      if (content.ownerId !== actorId) throw new DomainValidationError('只有作者可以恢复版本')

      const target = await versionRepo.findById(tx, targetVersionId)
      if (!target || target.contentId !== contentId) {
        throw new NotFoundError('版本', targetVersionId)
      }
      if (content.currentVersionId === target.id) {
        throw new DomainValidationError('该版本已是当前版本')
      }

      const structure = parseStructure(target.structureJson)
      const versionNumber = await versionRepo.nextVersionNumber(tx, contentId)
      const version = await versionRepo.create(tx, {
        contentId,
        versionNumber,
        parentVersionId: content.currentVersionId,
        createdBy: actorId,
        creationMethod: 'restore',
        changelog: `恢复自 v${target.versionNumber}`,
        structureJson: target.structureJson ?? serializeStructure(structure),
      })
      await contentRepo.update(tx, contentId, { currentVersionId: version.id })
      await provenanceRepo.append(tx, {
        contentId,
        versionId: version.id,
        eventType: 'version_restored',
        actorType: 'human',
        actorId,
        payload: { restoredFromVersionNumber: target.versionNumber, newVersionNumber: versionNumber },
      })
      return version
    })
  },

  /** 当前版本（含密封配方；修订定位等读取场景用） */
  async getCurrentVersion(contentId: string): Promise<ContentVersion | null> {
    const content = await contentRepo.findById(db, contentId)
    if (!content?.currentVersionId) return null
    return versionRepo.findById(db, content.currentVersionId)
  },

  /** 版本时间线（查看/继续编辑/恢复的数据源） */
  async listTimeline(contentId: string) {
    const versions = await versionRepo.listByContent(db, contentId)
    const content = await contentRepo.findById(db, contentId)
    return versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      parentVersionId: v.parentVersionId,
      creationMethod: v.creationMethod,
      changelog: v.changelog,
      createdAt: v.createdAt,
      isCurrent: v.id === content?.currentVersionId,
    }))
  },
}
