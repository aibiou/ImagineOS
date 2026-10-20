import { runHttpCommand } from '@/server/http'

/** Thin binding (ADR-002): no business logic lives in route files. */
export async function GET() {
  return runHttpCommand('system.health', {})
}
