import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  executeCommand,
  listCommands,
  defineCommand,
  AppError,
  type CommandContext,
} from '@/server/commands'

const ctx: CommandContext = {
  actor: { id: 'actor_test', role: 'user' },
  requestId: 'req_test',
  now: new Date('2026-10-05T00:00:00Z'),
}

describe('command registry (ADR-002)', () => {
  it('registers and lists commands', () => {
    const names = listCommands().map((c) => c.name)
    expect(names).toContain('system.health')
  })

  it('rejects duplicate registration', () => {
    expect(() =>
      defineCommand({
        name: 'system.health',
        description: 'dup',
        input: z.object({}),
        permission: 'public',
        handler: async () => ({}),
      }),
    ).toThrow(/duplicate/)
  })

  it('unknown command → typed NOT_FOUND', async () => {
    await expect(executeCommand('nope.command', {}, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
  })

  it('invalid input → typed VALIDATION with details', async () => {
    const err = (await executeCommand('system.health', { surprise: 1 }, ctx).catch((e) => e)) as AppError
    expect(err).toBeInstanceOf(AppError)
    expect(err.code).toBe('VALIDATION')
    expect(err.details).toBeTruthy()
  })

  it('guard discipline: a crashing handler fails the action alone, as INTERNAL', async () => {
    defineCommand({
      name: 'test.boom',
      description: 'throws a raw error',
      input: z.object({}),
      permission: 'public',
      handler: async () => {
        throw new Error('kaboom')
      },
    })
    const err = (await executeCommand('test.boom', {}, ctx).catch((e) => e)) as AppError
    expect(err).toBeInstanceOf(AppError)
    expect(err.code).toBe('INTERNAL')
    expect(String((err.details as { cause?: string })?.cause)).toContain('kaboom')
    // registry still alive — one failed action never kills the session
    const names = listCommands().map((c) => c.name)
    expect(names).toContain('system.health')
  })

  it('walking skeleton: system.health walks env → db → ffmpeg → registry', async () => {
    const result = (await executeCommand('system.health', {}, ctx)) as {
      status: string
      checks: Record<string, string>
      commands: number
    }
    expect(result.checks.database).toBe('ok')
    expect(result.checks.mediaPipeline).toBe('ok')
    expect(result.checks.commandRegistry).toBe('ok')
    expect(result.commands).toBeGreaterThanOrEqual(1)
    expect(result.status).toBe('ok')
  })
})
