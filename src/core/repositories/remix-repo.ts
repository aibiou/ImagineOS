// Remix 仓储（§35：血缘三件套）
import type { DbClient, Remix } from './types'

export const remixRepo = {
  create(
    db: DbClient,
    data: {
      derivativeContentId: string
      derivativeVersionId: string
      sourceContentId: string
      sourceVersionId: string
      remixerId: string
    },
  ): Promise<Remix> {
    return db.remix.create({ data })
  },

  findByDerivative(db: DbClient, derivativeContentId: string): Promise<Remix | null> {
    return db.remix.findUnique({ where: { derivativeContentId }, include: { sourceContent: true, remixer: true } })
  },

  listBySource(db: DbClient, sourceContentId: string) {
    return db.remix.findMany({
      where: { sourceContentId },
      orderBy: { createdAt: 'desc' },
      include: {
        derivativeContent: { select: { id: true, title: true, status: true, visibility: true } },
        remixer: { select: { id: true, displayName: true, handle: true } },
      },
    })
  },
}
