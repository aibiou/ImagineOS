// 仓储层基座：统一 DB 客户端类型（事务内外皆可传入）
import type { Prisma } from '@prisma/client'

export type DbClient = Prisma.TransactionClient

import type { Content, ContentVersion, Provenance, Remix, User, Identity, Publication, Intent } from '@prisma/client'
export type { Content, ContentVersion, Provenance, Remix, User, Identity, Publication, Intent }
