// 分镜生成模式路由决策（ADR-0001 双路径 / Video Pipeline Audit R3 观测性补齐，2026-10-07）
// 纯函数：配方镜头 + 强制开关 → 本次 storyboard Job 的模式「意图」快照。
// 产物口径（实际结果）以 computeGenerationMode（job-service，shotAssets → composition/native/hybrid）为准；
// 本函数记录的是「决策」——两者出现差异即是回落发生的证据（Provenance mode.decision 事件）。
// 背景：composition 路径此前零路由记录（审计 R3），产物形态只能靠零记账反推。

import type { ShotSnapshot } from './schemas'

export interface StoryboardModeDecision {
  mode: 'composition' | 'native' | 'hybrid'
  forceNative: boolean
  motionShots: number
  totalShots: number
}

/** 与 workers/pipeline-executor.ts motionModeFor 同一口径的 Job 级快照 */
export function storyboardModeDecision(
  shots: Array<Pick<ShotSnapshot, 'motion'>>,
  forceNative: boolean,
): StoryboardModeDecision {
  const totalShots = shots.length
  const motionShots = shots.filter((s) => s.motion === 'native').length
  let mode: StoryboardModeDecision['mode']
  if (forceNative) mode = 'native'
  else if (motionShots === 0) mode = 'composition'
  else if (motionShots === totalShots) mode = 'native'
  else mode = 'hybrid'
  return { mode, forceNative, motionShots, totalShots }
}
