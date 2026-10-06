// Fork / Remix 原语（§35 / §79 / 不变量 I2）
// Remix = 复制原作品的可授权创作结构 + 建立血缘三件套 + 原作零改动
// Alpha 语义：新作者从源作品的创作阶段继续，进入自己的创作循环
import { db, SQLITE_TX_TIMEOUT } from '@/lib/db'
import { DomainValidationError, NotFoundError, RemixNotAllowedError } from '@/core/errors'
import { contentRepo } from '@/core/repositories/content-repo'
import { versionRepo } from '@/core/repositories/version-repo'
import { provenanceRepo } from '@/core/repositories/provenance-repo'
import { remixRepo } from '@/core/repositories/remix-repo'
import type { Content, ContentVersion, Remix } from '@/core/repositories/types'

export interface ForkResult {
  content: Content
  version: ContentVersion
  remix: Remix
}

export const forkService = {
  async forkContent(input: { sourceContentId: string; newOwnerId: string; sourceVersionId?: string }): Promise<ForkResult> {
    const { sourceContentId, newOwnerId, sourceVersionId } = input

    return db.$transaction(async (tx) => {
      const source = await contentRepo.findById(tx, sourceContentId)
      if (!source) throw new NotFoundError('作品', sourceContentId)

      // Remix 授权检查（§32 Remix Permission）
      if (source.remixPermission !== 'allow') throw new RemixNotAllowedError(sourceContentId)
      if (source.ownerId === newOwnerId) {
        throw new DomainValidationError('不能 Remix 自己的作品（修订请用版本系统）')
      }

      // 源版本：显式指定 > 当前版本 > 最新版本
      const sourceVersion = sourceVersionId
        ? await versionRepo.findById(tx, sourceVersionId)
        : source.currentVersionId
          ? await versionRepo.findById(tx, source.currentVersionId)
          : await versionRepo.listByContent(tx, sourceContentId).then((vs) => vs[0] ?? null)
      if (!sourceVersion || sourceVersion.contentId !== sourceContentId) {
        throw new DomainValidationError('源作品还没有可 Remix 的版本（先完成一次创作）')
      }

      // ---- 新 Content（不修改源作任何字段）----
      const newContent = await contentRepo.create(tx, {
        ownerId: newOwnerId,
        title: `${source.title} · Remix`,
        description: source.description ?? undefined,
        status: source.status === 'PUBLISHED' ? 'READY' : source.status, // 新作者从可再发布位继续
      })

      // ---- 新 Version（method=remix，配方完整复制）----
      const newVersion = await versionRepo.create(tx, {
        contentId: newContent.id,
        versionNumber: 1,
        parentVersionId: null, // 跨作品血缘记录在 Remix 表；版本链从自己重新开始
        createdBy: newOwnerId,
        creationMethod: 'remix',
        changelog: `Remix 自《${source.title}》v${sourceVersion.versionNumber}`,
        structureJson: sourceVersion.structureJson ?? undefined,
      })
      await contentRepo.update(tx, newContent.id, { currentVersionId: newVersion.id })

      // ---- 血缘三件套（§35）----
      const remix = await remixRepo.create(tx, {
        derivativeContentId: newContent.id,
        derivativeVersionId: newVersion.id,
        sourceContentId: source.id,
        sourceVersionId: sourceVersion.id,
        remixerId: newOwnerId,
      })

      // ---- 溯源（两侧都记录；源作的内容与版本行零改动）----
      await provenanceRepo.append(tx, {
        contentId: source.id,
        versionId: sourceVersion.id,
        eventType: 'remixed',
        actorType: 'human',
        actorId: newOwnerId,
        payload: { derivativeContentId: newContent.id, derivativeVersionId: newVersion.id },
      })
      await provenanceRepo.append(tx, {
        contentId: newContent.id,
        versionId: newVersion.id,
        eventType: 'remix_received',
        actorType: 'system',
        payload: {
          sourceContentId: source.id,
          sourceVersionId: sourceVersion.id,
          sourceTitle: source.title,
          sourceVersionNumber: sourceVersion.versionNumber,
        },
      })

      // 复制 Intent 原始表达（新作者的起点语境，结构化 Intent 由其后的流程重建）
      const sourceIntent = await tx.intent.findFirst({ where: { contentId: source.id }, orderBy: { createdAt: 'asc' } })
      if (sourceIntent) {
        await tx.intent.create({
          data: { contentId: newContent.id, rawExpression: sourceIntent.rawExpression },
        })
      }

      return { content: newContent, version: newVersion, remix }
    }, SQLITE_TX_TIMEOUT)
  },
}
