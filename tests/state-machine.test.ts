// 创作状态机单元测试（§51）：合法/非法跳转全量覆盖
import { describe, expect, it } from 'vitest'
import {
  CREATIVE_STATUSES,
  assertTransition,
  canTransition,
  isCreativeStatus,
  legalTransitions,
} from '@/core/content/state-machine'
import { IllegalTransitionError } from '@/core/errors'

describe('创作状态机', () => {
  it('提供全量合法跳转表且不含自环', () => {
    const edges = legalTransitions()
    expect(edges.length).toBeGreaterThan(15)
    for (const [from, to] of edges) {
      expect(from).not.toBe(to)
    }
  })

  it('主链顺序 IDEA→…→PUBLISHED 全部合法', () => {
    const chain = ['IDEA', 'INTENT', 'PLANNING', 'STORY', 'STORYBOARD', 'GENERATING', 'REVIEW', 'RENDERING', 'READY', 'PUBLISHED'] as const
    for (let i = 0; i < chain.length - 1; i++) {
      const from = chain[i]!
      const to = chain[i + 1]!
      expect(canTransition(from, to), `${from}→${to} 应合法`).toBe(true)
    }
  })

  it('修订回路存在（UX 原则二：重要创作都可继续修改）', () => {
    expect(canTransition('REVIEW', 'STORY')).toBe(true)
    expect(canTransition('READY', 'REVIEW')).toBe(true)
    expect(canTransition('STORY', 'PLANNING')).toBe(true)
    expect(canTransition('PUBLISHED', 'READY')).toBe(true) // 下线
  })

  it('禁止跨阶段前跳（IDEA 直接到 READY 必须被拒）', () => {
    for (const to of ['STORY', 'REVIEW', 'READY', 'PUBLISHED'] as const) {
      expect(canTransition('IDEA', to), `IDEA→${to} 应非法`).toBe(false)
    }
    expect(() => assertTransition('IDEA', 'READY')).toThrow(IllegalTransitionError)
  })

  it('assertTransition 非法跳转携带错误码 illegal_transition', () => {
    try {
      assertTransition('IDEA', 'PUBLISHED')
      expect.unreachable('应抛出 IllegalTransitionError')
    } catch (e) {
      expect((e as IllegalTransitionError).code).toBe('illegal_transition')
      expect((e as Error).message).toContain('IDEA')
    }
  })

  it('isCreativeStatus 拒绝未知值与脏数据', () => {
    for (const s of CREATIVE_STATUSES) expect(isCreativeStatus(s)).toBe(true)
    expect(isCreativeStatus('FAILED')).toBe(false)
    expect(isCreativeStatus('')).toBe(false)
    expect(isCreativeStatus('idea')).toBe(false) // 大小写敏感
  })
})
