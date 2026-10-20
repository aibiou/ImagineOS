// ContentVersion 仓储 —— 不变量 I1：版本不可变
// 刻意【不提供】update 方法：修订 = 新建版本（§24），旧版本永远保留（§25）
import type { ContentVersion, DbClient } from './types'

export const versionRepo = {
  async nextVersionNumber(db: DbClient, contentId: string): Promise<number> {
    const last = await db.contentVersion.findFirst({
      where: { contentId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    })
    return (last?.versionNumber ?? 0) + 1
  },

  create(
    db: DbClient,
    data: {
      contentId: string
      versionNumber: number
      parentVersionId: string | null
      createdBy: string
      creationMethod: string
      changelog?: string
      structureJson?: string
    },
  ): Promise<ContentVersion> {
    return db.contentVersion.create({ data })
  },

  findById(db: DbClient, id: string): Promise<ContentVersion | null> {
    return db.contentVersion.findUnique({ where: { id } })
  },

  findByNumber(db: DbClient, contentId: string, versionNumber: number): Promise<ContentVersion | null> {
    return db.contentVersion.findUnique({ where: { contentId_versionNumber: { contentId, versionNumber } } })
  },

  listByContent(db: DbClient, contentId: string): Promise<ContentVersion[]> {
    return db.contentVersion.findMany({ where: { contentId }, orderBy: { versionNumber: 'desc' } })
  },
}

// 结构性自检：仓储面不暴露任何变更/删除方法（测试断言用）
export const VERSION_REPO_MUTATORS: string[] = []
