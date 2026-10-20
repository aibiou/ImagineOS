'use client'
// INTENTIONAL boundary violation — self-test fixture (ignored by main lint).
// Violated rule: UI must reach the server through HTTP only.
import { executeCommand } from '@/server/commands'

export function BadComponent() {
  void executeCommand
  return null
}
