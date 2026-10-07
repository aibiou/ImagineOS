// 分镜生成模式路由决策（ADR-0001 Rev.3：native-first 产品默认，2026-10-07 产品负责人指令）
// 纯函数：配方镜头 + 环境开关 → 逐镜头 / Job 级的模式「意图」快照。
// 产物口径（实际结果）以 computeGenerationMode（job-service，shotAssets → composition/native/hybrid）为准；
// 本模块记录的是「决策」——两者出现差异即是回落发生的证据（Provenance mode.decision 事件）。
// 决策优先级（高 → 低）：
//   1. IMAGINEOS_FORCE_NATIVE=1（评估开关，Gate 6b）→ 全镜强制 native
//   2. IMAGINEOS_FORCE_COMPOSITION=1（运维逃生阀：视频 provider 全挂/长时限速时强制合成路径）
//   3. 镜头配方 motion 字段显式值（未来 LLM 产品化写入点，预留）
//   4. 产品默认 native（AI 视频模型逐镜生成真实运动；不可用时管线层 hasVideoShotProvider 门控自动回落合成）
// 历史背景：Rev.2 之前默认 composition（native 通道成功率 1/28 时代的保守选择）；
// 2026-10-07 双站点 data URI 首帧推理层验证通过（report §0.5.9）后，产品负责人裁决翻转默认。

import type { ShotSnapshot } from './schemas'

export interface StoryboardModeDecision {
  mode: 'composition' | 'native' | 'hybrid'
  forceNative: boolean
  forceComposition: boolean
  /** 生效口径的 native 镜头数（含产品默认；非配方显式字段计数） */
  nativeShots: number
  totalShots: number
}

export interface MotionModeEnv {
  forceNative?: boolean
  forceComposition?: boolean
}

/** 逐镜头运动路径判定（pipeline-executor 的唯一事实源；无视频 provider 时由调用方门控回落合成） */
export function motionModeFor(shot: Pick<ShotSnapshot, 'motion'>, env: MotionModeEnv = {}): 'composition' | 'native' {
  if (env.forceNative) return 'native'
  if (env.forceComposition) return 'composition'
  return shot.motion ?? 'native'
}

/** Job 级模式意图快照（Provenance mode.decision 事件载荷；与 motionModeFor 同一口径） */
export function storyboardModeDecision(
  shots: Array<Pick<ShotSnapshot, 'motion'>>,
  forceNative: boolean,
  forceComposition = false,
): StoryboardModeDecision {
  const totalShots = shots.length
  const env: MotionModeEnv = { forceNative, forceComposition }
  const nativeShots = shots.filter((s) => motionModeFor(s, env) === 'native').length
  let mode: StoryboardModeDecision['mode']
  if (forceNative) mode = 'native'
  else if (forceComposition) mode = 'composition'
  else if (nativeShots === 0) mode = 'composition'
  else if (nativeShots === totalShots) mode = 'native'
  else mode = 'hybrid'
  return { mode, forceNative, forceComposition, nativeShots, totalShots }
}
