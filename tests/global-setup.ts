// vitest globalSetup —— 测试库隔离（gate7-product-hardening-008，2026-10-07）
// 背景：vitest 此前与 dev server 共用 db/custom.db——测试数据污染线上库（实证：GenerationJob
// error='x' 为 tests/generation-failure.test.ts 写入），且测试遗留的 queued job 会被生产 worker
// 认领真实执行（实证：2026-10-07 08:31「配方中没有镜头」被 worker 无退避重试 3 轮耗尽）。
// 方案：独立 db/test.db，每轮 vitest 删库重建（干净起点）；生产 worker 只扫 custom.db，彻底隔离。
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const TEST_DB = '/home/z/my-project/db/test.db'
const TEST_STORAGE = '/home/z/my-project/storage-test'

export default function setup(): void {
  process.env.DATABASE_URL = `file:${TEST_DB}`
  // 存储隔离（gate7-foundation-share-012）：测试写的真实文件每轮清空，不残留不泄漏到生产目录
  process.env.IMAGINEOS_STORAGE_DIR = TEST_STORAGE
  // 每轮从零建库（测试自建数据，无跨轮依赖；删库失败=首轮不存在，忽略）
  try {
    rmSync(TEST_DB)
  } catch {
    /* 首轮或已被清理 */
  }
  try {
    rmSync(TEST_STORAGE, { recursive: true, force: true })
  } catch {
    /* 首轮或已被清理 */
  }
  execSync('node_modules/.bin/prisma db push --skip-generate', {
    cwd: '/home/z/my-project',
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  console.log(`[vitest-global-setup] 测试库就绪：${TEST_DB}（与生产库 db/custom.db 隔离）；测试存储就绪：${TEST_STORAGE}（与生产 storage/assets 隔离）`)
}
