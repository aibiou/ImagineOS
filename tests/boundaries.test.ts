import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'

/**
 * Layering self-test (FigCraft `cargo xtask layers` equivalent): proves the
 * boundary rules actually fire, and that the real source tree passes them.
 * If someone deletes or weakens a rule, this file fails before the
 * architecture quietly rots.
 */
const root = fileURLToPath(new URL('..', import.meta.url))

async function lint(paths: string[]): Promise<number> {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: 'eslint.layers.config.mjs' })
  const results = await eslint.lintFiles(paths)
  return results.reduce((n, r) => n + r.errorCount, 0)
}

describe('layering boundaries (T0.3)', () => {
  it('flags a UI file importing server internals', async () => {
    expect(await lint(['tests/eslint-fixtures/ui-imports-server.tsx'])).toBeGreaterThan(0)
  })

  it('flags an API route importing domain modules instead of commands', async () => {
    expect(await lint(['tests/eslint-fixtures/api-imports-domain.ts'])).toBeGreaterThan(0)
  })

  it('flags a server file importing the provider SDK outside adapters', async () => {
    expect(await lint(['tests/eslint-fixtures/server-imports-sdk.ts'])).toBeGreaterThan(0)
  })

  it('the real source tree passes every boundary rule', async () => {
    expect(await lint(['src/**/*.{ts,tsx}'])).toBe(0)
  })
})
