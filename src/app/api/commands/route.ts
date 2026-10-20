import { NextResponse } from 'next/server'
import { listCommands } from '@/server/commands'

/** Registry introspection — the ImagineOS equivalent of `figcraft-cli commands`. */
export async function GET() {
  return NextResponse.json({ ok: true, data: { commands: listCommands() } })
}
