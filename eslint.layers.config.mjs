import tsParser from '@typescript-eslint/parser'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Standalone layering check (FigCraft `cargo xtask layers` equivalent).
 * Contains ONLY the ImagineOS boundary rules — no style rules — so
 * `bun run layers` answers one question: do the architecture boundaries hold?
 */
const serverInternals = { group: ['@/server/**'], message: 'UI must reach the server through HTTP only (ADR-002 thin bindings).' }
const nonCommandServer = {
  regex: '^@/server/(?!commands(/|$)|http$|env$).*$',
  message: 'API routes are thin bindings: import commands/http/env only (ADR-002).',
}
const sdkOnlyInAdapters = {
  group: ['z-ai-web-dev-sdk', 'z-ai-web-dev-sdk/**'],
  message: 'Provider SDKs are only allowed inside src/server/ai/adapters/** (Brief §28).',
}
const dbServerOnly = { group: ['@/lib/db'], message: 'The Prisma client is server-side only.' }

const same = (files, ignores, patterns) => ({ files, ...(ignores ? { ignores } : {}), rules: { 'no-restricted-imports': ['error', { patterns }] } })

// Boundary rules — must stay in sync with eslint.config.mjs.
// Each rule also claims its self-test fixture (tests/eslint-fixtures/*) so the
// boundary test can prove the rules actually fire; the main config ignores
// fixtures globally (they are intentional violations, not product code).
const config = [
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'examples/**', 'skills/**', 'mini-services/**', 'upload/**', 'docs/**', 'download/**', '.zscripts/**'],
  },
  { files: ['**/*.{ts,tsx,mjs,js}'], languageOptions: { parser: tsParser } },
  same(
    ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}', 'tests/eslint-fixtures/ui-imports-server.tsx'],
    ['src/app/api/**'],
    [serverInternals, dbServerOnly, sdkOnlyInAdapters],
  ),
  same(
    ['src/app/api/**/*.ts', 'tests/eslint-fixtures/api-imports-domain.ts'],
    undefined,
    [nonCommandServer, dbServerOnly, sdkOnlyInAdapters],
  ),
  same(
    ['src/server/**/*.{ts,tsx}', 'tests/eslint-fixtures/server-imports-sdk.ts'],
    ['src/server/ai/adapters/**'],
    [sdkOnlyInAdapters],
  ),
  same(['src/server/ai/**/*.{ts,tsx}'], ['src/server/ai/README.md'], [{
    group: ['@/server/content/**', '@/server/intent/**', '@/server/planner/**', '@/server/jobs/**', '@/server/media/**', '@/server/commands/**', '@/server/http'],
    message: 'Model Router is infrastructure: it must not depend on product layers (Brief §87).',
  }]),
  same(['src/server/content/**/*.{ts,tsx}'], undefined, [{
    group: ['@/server/intent/**', '@/server/planner/**', '@/server/jobs/**', '@/server/media/**', '@/server/ai/**', '@/server/commands/**', '@/server/http'],
    message: 'content is the domain core: only db/env may sit beneath it (ADR-001).',
  }]),
]

export default config
