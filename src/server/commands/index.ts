/**
 * Command registry entry. Import side effects register commands (same pattern
 * as a route table); API routes, the orchestrator and tests import from here —
 * never from individual command files.
 */
import './system'
export { defineCommand, executeCommand, listCommands } from './registry'
export { AppError } from './types'
export type { CommandActor, CommandContext, CommandDef } from './types'
