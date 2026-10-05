// API 层会话与错误映射辅助（依赖 next/headers，故置于 app 内、不入 core）
import { cookies } from 'next/headers'
import { ensureSessionUser, resolveUserFromToken, SESSION_COOKIE } from '@/core/auth/session'
import { isDomainError } from '@/core/errors'
import type { SessionContext } from '@/core/auth/session'
import type { User } from '@/core/repositories/types'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** 只读会话（GET 场景）：无会话返回 null，不创建用户 */
export async function getSessionUser(): Promise<User | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value ?? null
  return resolveUserFromToken(token)
}

/** 写会话（POST 场景）：无会话自动创建匿名用户并落 cookie（ADR-0003） */
export async function requireSessionUser(): Promise<SessionContext> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value ?? null
  const ctx = await ensureSessionUser(token)
  if (ctx.isNew) {
    jar.set(SESSION_COOKIE, ctx.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE,
    })
  }
  return ctx
}

/** 领域错误 → HTTP 语义 */
export function domainErrorToResponse(e: unknown): Response {
  if (isDomainError(e)) {
    const status =
      e.code === 'not_found'
        ? 404
        : e.code === 'permission_denied' || e.code === 'remix_not_allowed'
          ? 403
          : e.code === 'illegal_transition' || e.code === 'domain_validation'
            ? 422
            : 400
    return Response.json({ error: e.code, message: e.message }, { status })
  }
  console.error('[api] unexpected error:', e)
  return Response.json({ error: 'internal', message: '服务器开小差了，请稍后再试' }, { status: 500 })
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}
