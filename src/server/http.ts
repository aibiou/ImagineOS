import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { executeCommand, AppError, type CommandActor } from '@/server/commands'
import { env } from '@/server/env'

/**
 * HTTP binding layer (ADR-002): parse → executeCommand → serialize.
 * Route handlers must contain zero business logic; this file is the only
 * place that maps commands onto the HTTP transport.
 *
 * Alpha actor resolution: a single demo user, upserted idempotently, so the
 * actor shape (id + role) is real from day one. NextAuth swaps in later
 * without touching command signatures.
 */
async function resolveActor(): Promise<CommandActor> {
  const user = await db.user.upsert({
    where: { email: 'demo@imagineos.dev' },
    update: {},
    create: { email: 'demo@imagineos.dev', name: 'ImagineOS Demo Creator' },
  })
  return { id: user.id, role: 'user' }
}

export async function runHttpCommand(
  name: string,
  input: unknown,
  init?: { actor?: CommandActor },
): Promise<NextResponse> {
  const requestId = randomUUID()
  const started = Date.now()
  try {
    // env is validated on the first request through the server layer;
    // a broken environment fails loudly here, not as mystery 500s.
    void env
    const actor = init?.actor ?? (await resolveActor())
    const data = await executeCommand(name, input, {
      actor,
      requestId,
      now: new Date(),
    })
    console.log(JSON.stringify({ level: 'info', msg: 'command.ok', name, requestId, ms: Date.now() - started }))
    return NextResponse.json({ ok: true, requestId, data })
  } catch (err) {
    const appErr =
      err instanceof AppError
        ? err
        : new AppError('INTERNAL', 'Unexpected server error', 500, { cause: String(err) })
    console.log(
      JSON.stringify({
        level: 'error',
        msg: 'command.failed',
        name,
        requestId,
        code: appErr.code,
        ms: Date.now() - started,
      }),
    )
    return NextResponse.json(
      { ok: false, requestId, error: { code: appErr.code, message: appErr.message, details: appErr.details } },
      { status: appErr.status },
    )
  }
}
