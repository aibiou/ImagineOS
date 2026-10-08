import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    // 集成测试共享单个 SQLite 文件，串行执行避免写锁竞争（R4 缓解）
    fileParallelism: false,
    // 测试库隔离（gate7-product-hardening-008）：vitest 与 dev server 生产库彻底分离，
    // 防测试数据污染线上库 + 生产 worker 误执行测试遗留 job（两者均有实证）
    // 存储隔离（gate7-foundation-share-012，2026-10-08）：assetService.save 写真实文件，
    // 若不隔离会漏进生产 storage/assets（实证：27 字节测试 PNG 在生产目录残留）
    env: {
      DATABASE_URL: 'file:/home/z/my-project/db/test.db',
      IMAGINEOS_STORAGE_DIR: '/home/z/my-project/storage-test',
    },
    globalSetup: 'tests/global-setup.ts',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
