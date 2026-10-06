// AI 层配置读取（ADR-0004 / M1.5 Phase B 解锁）
// 职责：从 core 领域服务读取配置 + 进程内短 TTL 缓存 + core 写入通知即时失效。
// 边界：ai → core 单向依赖（ESLint 边界允许）；本模块不落任何校验/CRUD 逻辑（core 所有）。
// 链构建：registry.buildChainsFromConfigs() 消费本模块输出。

import {
  onProviderConfigChanged,
  providerConfigService,
  type ProviderConfigRow,
} from '@/core/settings/provider-config-service'

export type { ProviderConfigRow }
export { parseExtra, joinUrl } from '@/core/settings/provider-config-service'

// ---------- 读取缓存（进程内共享；TTL + 写后失效） ----------

const CACHE_TTL_MS = 3_000
let cache: { at: number; rows: ProviderConfigRow[] } | null = null

// core 写入通知 → 即时失效（同一进程内 API 路由与 worker 共享模块实例）
if (onProviderConfigChanged) {
  onProviderConfigChanged(() => {
    cache = null
  })
}

/** 强制失效（跨进程兜底：TTL 3s 内也会自然过期） */
export function invalidateProviderConfigCache(): void {
  cache = null
}

/** 读取全部配置行（DB 异常时返回空并保留旧链——可用性优先） */
export async function readProviderConfigs(): Promise<ProviderConfigRow[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows
  try {
    const rows = await providerConfigService.readAll()
    cache = { at: Date.now(), rows }
    return rows
  } catch {
    return cache?.rows ?? []
  }
}
