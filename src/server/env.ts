import { z } from 'zod'

/**
 * Environment schema (T0.4). Validated at first server-module import so a
 * misconfigured environment fails loudly instead of producing mystery 500s.
 * Alpha needs only DATABASE_URL; future provider keys land here, never
 * as ad-hoc process.env reads.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`[ImagineOS] Environment validation failed:\n${issues}`)
  }
  return parsed.data
}

export const env: Env = loadEnv()
