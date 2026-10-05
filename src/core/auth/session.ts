// 会话身份服务（ADR-0003）——纯函数域，不依赖 next/headers（可测性）
import { userRepo } from '@/core/repositories/user-repo'
import { db } from '@/lib/db'
import type { User } from '@/core/repositories/types'

export const SESSION_COOKIE = 'imagineos_sid'

export interface SessionContext {
  user: User
  token: string
  isNew: boolean
}

/** 由 token 解析用户（无效/缺失返回 null） */
export async function resolveUserFromToken(token: string | null | undefined): Promise<User | null> {
  if (!token) return null
  const identity = await userRepo.findSessionIdentity(db, token)
  if (!identity) return null
  return identity.user
}

/** 确保存在会话用户：无 token 或 token 无效则创建匿名用户（无注册墙） */
export async function ensureSessionUser(token: string | null | undefined): Promise<SessionContext> {
  const existing = await resolveUserFromToken(token)
  if (existing) return { user: existing, token: token as string, isNew: false }
  const { user, token: newToken } = await userRepo.createSessionUser(db)
  return { user, token: newToken, isNew: true }
}
