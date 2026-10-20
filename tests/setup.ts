// Vitest setup: provide the environment the server modules expect.
// (cast: Next's type augmentation makes NODE_ENV readonly at the type level)
process.env.DATABASE_URL ??= 'file:/home/z/my-project/db/custom.db'
;(process.env as Record<string, string | undefined>).NODE_ENV ??= 'test'
