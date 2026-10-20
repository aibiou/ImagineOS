// ImagineOS 领域错误体系
// API 层依据 code 映射 HTTP 状态码；测试断言错误路径使用同一套 code。

export class DomainError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}

/** 创作状态机非法跳转（§51） */
export class IllegalTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super('illegal_transition', `不允许从 ${from} 跳转到 ${to}`)
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super('not_found', `${resource} 不存在：${id}`)
  }
}

export class PermissionDeniedError extends DomainError {
  constructor(message: string) {
    super('permission_denied', message)
  }
}

/** 原作品关闭了 Remix 授权（§35） */
export class RemixNotAllowedError extends DomainError {
  constructor(contentId: string) {
    super('remix_not_allowed', `作品 ${contentId} 未开放 Remix`)
  }
}

/** 领域输入校验失败（Zod 之外的语义校验） */
export class DomainValidationError extends DomainError {
  constructor(message: string) {
    super('domain_validation', message)
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError
}
