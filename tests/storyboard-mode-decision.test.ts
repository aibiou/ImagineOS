// storyboardModeDecision / motionModeFor 回归测试
// 2026-10-07 ADR-0001 Rev.3：产品默认翻转 native-first（产品负责人指令「我要 AI 视频，不是 AI 图片播放」）
// 决策优先级：FORCE_NATIVE > FORCE_COMPOSITION > 配方 motion 显式值 > 产品默认 native
// 产物口径以 computeGenerationMode（shotAssets）为准，与本模块差异 = 回落证据（mode.decision 事件）。
import { describe, expect, it } from 'vitest'
import { motionModeFor, storyboardModeDecision } from '@/core/content/storyboard-mode'

const shot = (motion?: 'composition' | 'native') => ({ motion })

describe('motionModeFor（逐镜头判定：单一事实源）', () => {
  it('产品默认：motion 未写 → native（Rev.3 翻转；Rev.2 前为 composition）', () => {
    expect(motionModeFor(shot())).toBe('native')
    expect(motionModeFor({})).toBe('native')
  })

  it('配方显式值优先于产品默认：motion=composition → composition', () => {
    expect(motionModeFor(shot('composition'))).toBe('composition')
    expect(motionModeFor(shot('native'))).toBe('native')
  })

  it('环境开关优先于配方字段：forceNative / forceComposition 双向压制', () => {
    expect(motionModeFor(shot('composition'), { forceNative: true })).toBe('native')
    expect(motionModeFor(shot('native'), { forceComposition: true })).toBe('composition')
    expect(motionModeFor(shot(), { forceNative: true, forceComposition: true })).toBe('native') // native 开关位阶更高
  })
})

describe('storyboardModeDecision（Job 级模式意图快照）', () => {
  it('真实用户作品形态：无开关 + motion 全 undefined → native（产品默认全镜 AI 视频）', () => {
    expect(storyboardModeDecision([shot(), shot(), shot(), shot(), shot()], false)).toEqual({
      mode: 'native', forceNative: false, forceComposition: false, nativeShots: 5, totalShots: 5,
    })
  })

  it('评估开关：FORCE_NATIVE=1 → native（无视配方字段）', () => {
    expect(storyboardModeDecision([shot('composition'), shot()], true)).toEqual({
      mode: 'native', forceNative: true, forceComposition: false, nativeShots: 2, totalShots: 2,
    })
  })

  it('运维逃生阀：FORCE_COMPOSITION=1 → composition（无视配方字段）', () => {
    expect(storyboardModeDecision([shot('native'), shot('native')], false, true)).toEqual({
      mode: 'composition', forceNative: false, forceComposition: true, nativeShots: 0, totalShots: 2,
    })
  })

  it('配方显式 composition 混入默认 native → hybrid（未来 LLM 写入点的混合形态）', () => {
    expect(storyboardModeDecision([shot('composition'), shot(), shot(), shot(), shot()], false)).toEqual({
      mode: 'hybrid', forceNative: false, forceComposition: false, nativeShots: 4, totalShots: 5,
    })
  })

  it('全部镜头 motion=composition（显式）→ composition', () => {
    expect(storyboardModeDecision([shot('composition'), shot('composition')], false)).toEqual({
      mode: 'composition', forceNative: false, forceComposition: false, nativeShots: 0, totalShots: 2,
    })
  })

  it('空镜头数组 → composition（totalShots=0；上游 shots.length===0 已 fail-fast，此为纯函数边界）', () => {
    expect(storyboardModeDecision([], false)).toEqual({
      mode: 'composition', forceNative: false, forceComposition: false, nativeShots: 0, totalShots: 0,
    })
  })
})
