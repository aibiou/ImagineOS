import type { z } from 'zod'
import { AppError, type CommandContext, type CommandDef } from './types'

/**
 * Command registry (ADR-002). Thin on purpose: a Map plus a guarded executor.
 * Deliberately NOT built here (anti-over-engineering, §86): dynamic discovery,
 * plugins, capability negotiation, MCP transport — all are thin adapters over
 * this registry later (IDEA-004).
 */

const registry = new Map<string, CommandDef>()

export function defineCommand<S extends z.ZodType>(def: CommandDef<S>): void {
  if (registry.has(def.name)) {
    throw new Error(`[commands] duplicate registration: ${def.name}`)
  }
  registry.set(def.name, def as unknown as CommandDef)
}

/** Registry introspection — same idea as `figcraft-cli commands`. */
export function listCommands(): Array<Pick<CommandDef, 'name' | 'description' | 'permission'>> {
  return [...registry.values()]
    .map(({ name, description, permission }) => ({ name, description, permission }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function executeCommand(
  name: string,
  rawInput: unknown,
  ctx: CommandContext,
): Promise<unknown> {
  const cmd = registry.get(name)
  if (!cmd) throw new AppError('NOT_FOUND', `Unknown command: ${name}`, 404)

  const parsed = cmd.input.safeParse(rawInput)
  if (!parsed.success) {
    throw new AppError('VALIDATION', `Invalid input for ${name}`, 400, parsed.error.flatten())
  }

  // Guard discipline (FigCraft "never crashes"): one failed action must fail
  // alone — never the session, never the job, never the user's work.
  try {
    return await cmd.handler(parsed.data as z.infer<z.ZodType>, ctx)
  } catch (err) {
    if (err instanceof AppError) throw err
    throw new AppError('INTERNAL', `Command ${name} failed`, 500, { cause: String(err) })
  }
}
