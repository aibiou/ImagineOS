// Content 仓储（§48）
// 注意：不提供裸 status 更新——状态跳转必须经 content-service（先过状态机断言）
import type { Content, DbClient } from './types'

export const CONTENT_VISIBILITIES = ['private', 'unlisted', 'public'] as const
export const REMIX_PERMISSIONS = ['allow', 'deny'] as const

export const contentRepo = {
  create(
    db: DbClient,
    data: { ownerId: string; title: string; description?: string; projectId?: string; status?: string },
  ): Promise<Content> {
    return db.content.create({
      data: {
        ownerId: data.ownerId,
        title: data.title,
        description: data.description,
        projectId: data.projectId,
        status: data.status ?? 'IDEA',
      },
    })
  },

  findById(db: DbClient, id: string): Promise<Content | null> {
    return db.content.findUnique({ where: { id } })
  },

  findByIdWithDetail(db: DbClient, id: string) {
    return db.content.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, displayName: true, handle: true, avatarUrl: true } },
        currentVersion: true,
        remixOf: { include: { sourceContent: { select: { id: true, title: true } } } },
        _count: { select: { versions: true, remixSources: true, interactions: true } },
      },
    })
  },

  listByOwner(db: DbClient, ownerId: string, limit = 50) {
    return db.content.findMany({
      where: { ownerId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: {
        currentVersion: { select: { id: true, versionNumber: true, changelog: true, createdAt: true } },
        _count: { select: { versions: true, remixSources: true } },
      },
    })
  },

  /** Explore：公开已发布（§39 Alpha 基础版） */
  listPublic(db: DbClient, limit = 30) {
    return db.content.findMany({
      where: { visibility: 'public', status: 'PUBLISHED' },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: {
        owner: { select: { id: true, displayName: true, handle: true, avatarUrl: true } },
        currentVersion: { select: { id: true, versionNumber: true } },
        remixOf: { include: { sourceContent: { select: { id: true, title: true } } } },
        _count: { select: { versions: true, remixSources: true, interactions: true } },
      },
    })
  },

  update(
    db: DbClient,
    id: string,
    data: Partial<Pick<Content, 'title' | 'description' | 'status' | 'visibility' | 'remixPermission' | 'currentVersionId' | 'lastErrorJson'>>,
  ): Promise<Content> {
    return db.content.update({ where: { id }, data })
  },
}
