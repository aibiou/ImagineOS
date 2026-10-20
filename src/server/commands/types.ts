import type { z } from 'zod'

/**
 * Command types (ADR-002). Every user-visible capability is a command:
 * HTTP API, the Imagine orchestrator, integration tests and the Phase 17
 * golden regression all drive the SAME registry — the FigCraft lesson.
 */

export type AppErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'DEPENDENCY'
  | 'INTERNAL'

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly status: number = 400,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/** Authenticated actor. Alpha ships a single demo actor; the shape keeps RBAC honest from day one. */
export interface CommandActor {
  id: string
  role: 'user' | 'system'
}

export interface CommandContext {
  actor: CommandActor
  requestId: string
  /** ISO timestamp — single source of truth for "now" (provenance needs it). */
  now: Date
}

export interface CommandDef<S extends z.ZodType = z.ZodType> {
  /** Dotted name, e.g. 'system.health'. Stable API surface — never rename, deprecate instead. */
  name: string
  description: string
  input: S
  /** RBAC seed; 'authenticated' commands require a non-system actor. */
  permission: 'public' | 'authenticated'
  handler: (input: z.infer<S>, ctx: CommandContext) => Promise<unknown>
}
