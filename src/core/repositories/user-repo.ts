// User / Identity 仓储（ADR-0003：最小会话认证，实体按完整体系预留）
import { randomUUID } from 'node:crypto'
import type { DbClient, Identity, User } from './types'

function randomHandle(): string {
  const hex = randomUUID().replace(/-/g, '').slice(0, 4)
  return `旅人-${hex}`
}

function randomDisplayName(): string {
  const hex = randomUUID().replace(/-/g, '').slice(0, 4)
  return `旅人 ${hex}`
}

export const userRepo = {
  findById(db: DbClient, id: string): Promise<User | null> {
    return db.user.findUnique({ where: { id } })
  },

  findByHandle(db: DbClient, handle: string): Promise<User | null> {
    return db.user.findUnique({ where: { handle } })
  },

  findSessionIdentity(db: DbClient, token: string) {
    return db.identity.findFirst({ where: { type: 'session', secret: token }, include: { user: true } })
  },

  /** 创建匿名会话用户（无注册墙，D3） */
  async createSessionUser(
    db: DbClient,
    opts: { displayName?: string; handle?: string } = {},
  ): Promise<{ user: User; token: string }> {
    const token = randomUUID()
    let handle = opts.handle ?? randomHandle()
    // handle 冲突重试（极小概率）
    for (let i = 0; i < 3 && (await this.findByHandle(db, handle)); i++) {
      handle = randomHandle()
    }
    const user = await db.user.create({
      data: {
        handle,
        displayName: opts.displayName ?? randomDisplayName(),
        identities: { create: { type: 'session', secret: token } },
      },
    })
    return { user, token }
  },

  updateProfile(
    db: DbClient,
    userId: string,
    data: { displayName?: string; avatarUrl?: string; bio?: string },
  ): Promise<User> {
    return db.user.update({ where: { id: userId }, data })
  },

  touchIdentity(db: DbClient, identityId: string) {
    return db.identity.update({ where: { id: identityId }, data: { lastSeenAt: new Date() } })
  },
}
