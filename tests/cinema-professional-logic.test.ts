// 影视专业性逻辑回归测试（cinema-professional-logic）
// 2026-10-08 业务升级：三幕微结构 / 人物小传（欲望-障碍-弧光）/ 景别语法 / 人物视觉锚点代码注入。
// 锚点注入是本升级的核心承诺：跨镜人物一致性从「prompt 规则祈祷」升级为「执行层代码保证」。
import { describe, expect, it } from 'vitest'
import {
  CharacterSheetSchema,
  SceneSnapshotSchema,
  SHOT_SIZES,
  ShotSnapshotSchema,
  StorySnapshotSchema,
  VersionStructureSchema,
  type ShotSnapshot,
  type VersionStructure,
} from '@/core/content/schemas'
import { charactersForShot, imagePromptFor, videoPromptFor } from '@/core/content/shot-prompt'
import { reconcileShotDurations } from '@/ai/planning/story'

const character = {
  name: '父亲',
  description: '沉默的退伍工人',
  desire: '让儿子学会骑车',
  obstacle: '不忍心松手',
  arc: '从不敢放手到目送',
  wardrobe: '洗旧的藏蓝衬衫',
  visualAnchor: 'A lean Chinese father in his 40s, short graying hair, faded navy shirt',
}

const shot = (over: Partial<ShotSnapshot> = {}): ShotSnapshot =>
  ShotSnapshotSchema.parse({
    index: 0,
    visualDescription: '黄昏老巷口，父亲扶着自行车后座',
    imagePrompt: 'A father steadying the back of an old bicycle at dusk in a narrow alley',
    cameraMotion: 'zoom_in',
    durationMs: 8000,
    ...over,
  })

const structure = (over: { characters?: VersionStructure['characters']; story?: VersionStructure['story'] } = {}): VersionStructure =>
  VersionStructureSchema.parse({
    concept: { name: '旧路上的风', oneLiner: '一辆旧自行车的视角重走父子路', visualDirection: '黄昏暖调、胶片颗粒' },
    story: {
      logline: '父亲扶了一夏天后座，只为松手那一下。',
      characters: [character],
      scenes: [{ index: 0, summary: '巷口学车', dramaticFunction: 'hook', valueShift: '平静→忐忑', timeOfDay: '黄昏', shots: [shot()] }],
    },
    characters: [character],
    ...over,
  })

describe('Schema：影视专业字段（三幕微结构/人物小传/景别）', () => {
  it('人物小传全字段（欲望/障碍/弧光/视觉锚点）可校验解析', () => {
    const parsed = CharacterSheetSchema.parse(character)
    expect(parsed.desire).toBe('让儿子学会骑车')
    expect(parsed.obstacle).toBe('不忍心松手')
    expect(parsed.arc).toBe('从不敢放手到目送')
    expect(parsed.visualAnchor).toContain('navy shirt')
  })

  it('场景戏剧功能/价值转变/时刻 + 镜头景别/转场/在场人物可解析', () => {
    const scene = SceneSnapshotSchema.parse({
      index: 2,
      summary: '回头才发现父亲早已站在远处',
      dramaticFunction: 'turn',
      valueShift: '安心→震动',
      timeOfDay: '暮色',
      shots: [shot({ shotSize: 'closeup', transition: 'dissolve', charactersInShot: ['我'] })],
    })
    expect(scene.dramaticFunction).toBe('turn')
    expect(scene.valueShift).toBe('安心→震动')
    expect(scene.shots[0]?.shotSize).toBe('closeup')
    expect(scene.shots[0]?.transition).toBe('dissolve')
    expect(scene.shots[0]?.charactersInShot).toEqual(['我'])
  })

  it('景别枚举覆盖五级语法；非法景别被拒（防 LLM 幻觉值入库）', () => {
    expect(SHOT_SIZES).toEqual(['extreme_wide', 'wide', 'medium', 'closeup', 'extreme_closeup'])
    expect(() => ShotSnapshotSchema.parse({ index: 0, shotSize: '半身' })).toThrow()
    expect(() => ShotSnapshotSchema.parse({ index: 0, transition: '旋转' })).toThrow()
  })

  it('StorySnapshot.characters / VersionStructure.characters 双层透传（旧配方无新字段零报错）', () => {
    const story = StorySnapshotSchema.parse({ logline: 'x', characters: [character], scenes: [] })
    expect(story.characters?.[0]?.desire).toBe('让儿子学会骑车')
    const versioned = VersionStructureSchema.parse({ story })
    expect(versioned.characters).toEqual([]) // 顶层缺省为空数组（向后兼容）
    // 旧配方（无任何新字段）仍可解析——存量版本密封件不受影响
    expect(() => VersionStructureSchema.parse({ story: { logline: '旧配方', scenes: [{ index: 0, shots: [] }] } })).not.toThrow()
  })
})

describe('shot-prompt：人物视觉锚点代码注入（一致性从祈祷到保证）', () => {
  it('charactersInShot 显式标注 → visualAnchor 注入 imagePrompt', () => {
    const out = imagePromptFor(shot({ charactersInShot: ['父亲'] }), structure())
    expect(out).toContain('keep visually consistent')
    expect(out).toContain('faded navy shirt')
    expect(out).toContain('No text, no watermark')
  })

  it('无显式标注但画面描述含人物名 → 兜底匹配注入', () => {
    const out = imagePromptFor(shot(), structure())
    expect(out).toContain('父亲: A lean Chinese father')
  })

  it('人物不在场（显式标注他人/描述不含名字）→ 零注入', () => {
    const out = imagePromptFor(
      shot({ charactersInShot: ['母亲'], visualDescription: '空巷口的自行车剪影', imagePrompt: 'An empty alley with a bicycle silhouette' }),
      structure(),
    )
    expect(out).not.toContain('keep visually consistent')
  })

  it('无人物表（人物空数组）→ 零注入零报错', () => {
    const out = imagePromptFor(shot(), structure({ characters: [], story: { logline: 'x', scenes: [] } }))
    expect(out).not.toContain('keep visually consistent')
    expect(out).toContain('Visual style')
  })

  it('story.characters 兜底源：顶层 characters 空时从故事层取（remix 旧配方路径）', () => {
    const s = structure({ characters: [] }) // 顶层空、story.characters 有
    const out = imagePromptFor(shot({ charactersInShot: ['父亲'] }), s)
    expect(out).toContain('faded navy shirt')
  })

  it('shotSize → 构图兜底短语注入（大远景/特写各自正确）', () => {
    expect(imagePromptFor(shot({ shotSize: 'extreme_wide' }), structure())).toContain('extreme wide establishing shot')
    expect(imagePromptFor(shot({ shotSize: 'extreme_closeup' }), structure())).toContain('extreme close-up')
    expect(imagePromptFor(shot({ shotSize: 'medium', charactersInShot: ['路人甲'] }), structure())).toContain('medium shot')
  })

  it('videoPromptFor：运镜映射 + 锚点注入 + 情绪（运动中人物一致性同样保证）', () => {
    const out = videoPromptFor(shot({ shotSize: 'closeup', charactersInShot: ['父亲'], emotion: '温暖' }), structure())
    expect(out).toContain('slow cinematic push in')
    expect(out).toContain('faded navy shirt')
    expect(out).toContain('overall mood: 温暖')
    expect(out).toContain('subjects move naturally')
  })

  it('charactersForShot：显式标注优先级最高；名字兜底大小写敏感（中文名原词匹配）', () => {
    const chars = [character, { ...character, name: '我', visualAnchor: 'A 10-year-old boy' }]
    expect(charactersForShot({ charactersInShot: ['我'] }, chars).map((c) => c.name)).toEqual(['我'])
    expect(charactersForShot({ visualDescription: '父亲和我' }, chars).map((c) => c.name)).toEqual(['父亲', '我'])
    expect(charactersForShot({ visualDescription: '空镜' }, chars)).toEqual([])
  })
})

describe('时长预算归一（原有行为回归）', () => {
  it('总时长偏差 >15% 时线性归一，单镜夹取 [3000,12000]', () => {
    const shots = [
      shot({ durationMs: 4000 }),
      shot({ index: 1, durationMs: 4000 }),
      shot({ index: 2, durationMs: 4000 }),
    ]
    const out = reconcileShotDurations(shots, 45) // 总 12s vs 目标 45s
    expect(out.every((s) => s.durationMs === 12000)).toBe(true)
    expect(reconcileShotDurations(shots, 12)).toEqual(shots) // 容差内零调整
  })
})
