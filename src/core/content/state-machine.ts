// 创作状态机（Master Brief §51）
// 状态：IDEA → INTENT → PLANNING → STORY → STORYBOARD → GENERATING → REVIEW → RENDERING → READY → PUBLISHED
// 设计要点：
//   - 失败不回滚到起点：失败记在 Content.lastErrorJson + GenerationJob，状态机位置保持
//   - 允许"回到上一创作阶段"的边（修订循环），不允许跨阶段前跳
//   - 纯函数实现，无 IO，可表驱动全量测试

import { IllegalTransitionError } from '@/core/errors'

export const CREATIVE_STATUSES = [
  'IDEA',
  'INTENT',
  'PLANNING',
  'STORY',
  'STORYBOARD',
  'GENERATING',
  'REVIEW',
  'RENDERING',
  'READY',
  'PUBLISHED',
] as const

export type CreativeStatus = (typeof CREATIVE_STATUSES)[number]

const TRANSITIONS: Readonly<Record<CreativeStatus, readonly CreativeStatus[]>> = {
  IDEA: ['INTENT'],
  INTENT: ['PLANNING', 'IDEA'],
  PLANNING: ['STORY', 'INTENT'],
  STORY: ['STORYBOARD', 'PLANNING', 'INTENT'],
  STORYBOARD: ['GENERATING', 'STORY'],
  GENERATING: ['REVIEW', 'STORYBOARD'],
  REVIEW: ['RENDERING', 'GENERATING', 'STORY', 'STORYBOARD'],
  RENDERING: ['READY', 'GENERATING'],
  READY: ['PUBLISHED', 'REVIEW'],
  PUBLISHED: ['READY'], // 下线 → 回到 READY（可再次发布）
}

export function isCreativeStatus(value: string): value is CreativeStatus {
  return (CREATIVE_STATUSES as readonly string[]).includes(value)
}

export function canTransition(from: CreativeStatus, to: CreativeStatus): boolean {
  const targets = TRANSITIONS[from]
  if (!targets) return false
  return targets.includes(to)
}

export function assertTransition(from: CreativeStatus, to: CreativeStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to)
  }
}

/** 全量合法跳转表（供测试与前端状态图生成） */
export function legalTransitions(): ReadonlyArray<readonly [CreativeStatus, CreativeStatus]> {
  const out: Array<readonly [CreativeStatus, CreativeStatus]> = []
  for (const from of CREATIVE_STATUSES) {
    for (const to of TRANSITIONS[from] ?? []) {
      out.push([from, to] as const)
    }
  }
  return out
}
