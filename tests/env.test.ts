import { describe, it, expect, vi } from 'vitest'

describe('env validation (T0.4)', () => {
  it('fails loudly when DATABASE_URL is missing', async () => {
    vi.resetModules()
    const original = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      await expect(import('@/server/env')).rejects.toThrow(/DATABASE_URL/)
    } finally {
      process.env.DATABASE_URL = original
      vi.resetModules()
    }
  })
})
