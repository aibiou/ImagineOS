// storyboardModeDecision（路由决策快照）回归测试，2026-10-07
// 背景：Video Pipeline Audit R3——composition 路径此前零路由记录，真实产物形态
// 只能靠「零 video.shot 记账」反推。决策必须落 Provenance mode.decision 事件。
// 口径与 workers/pipeline-executor.ts motionModeFor 逐镜头判定一致。
import { describe, expect, it } from 'vitest'
import { storyboardModeDecision } from '@/core/content/storyboard-mode'

const shot = (motion?: 'composition' | 'native') => ({ motion })

describe('storyboardModeDecision（纯函数：配方 + 强制开关 → 模式意图）', () => {
  it('真实用户作品形态：无强制 + motion 全 undefined → composition', () => {
    expect(storyboardModeDecision([shot(), shot(), shot(), shot(), shot()], false)).toEqual({
      mode: 'composition', forceNative: false, motionShots: 0, totalShots: 5,
    })
  })

  it('Gate 6b 评估开关：FORCE_NATIVE=1 → native（无视配方字段）', () => {
    expect(storyboardModeDecision([shot(), shot()], true)).toEqual({
      mode: 'native', forceNative: true, motionShots: 0, totalShots: 2,
    })
  })

  it('部分镜头 motion=native → hybrid（Native Golden 的混合形态意图）', () => {
    expect(storyboardModeDecision([shot('native'), shot(), shot(), shot(), shot()], false)).toEqual({
      mode: 'hybrid', forceNative: false, motionShots: 1, totalShots: 5,
    })
  })

  it('全部镜头 motion=native → native', () => {
    expect(storyboardModeDecision([shot('native'), shot('native')], false)).toEqual({
      mode: 'native', forceNative: false, motionShots: 2, totalShots: 2,
    })
  })

  it('motion=composition 显式值不计入 native 镜头数', () => {
    expect(storyboardModeDecision([shot('composition'), shot('composition')], false)).toEqual({
      mode: 'composition', forceNative: false, motionShots: 0, totalShots: 2,
    })
  })

  it('空镜头数组 → composition（totalShots=0，与 motionModeFor 默认值一致）', () => {
    expect(storyboardModeDecision([], false)).toEqual({
      mode: 'composition', forceNative: false, motionShots: 0, totalShots: 0,
    })
  })
})
