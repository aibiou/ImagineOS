// 镜头质量门纯函数回归测试（quality-repro-023，2026-10-10，设计 docs/design/quality-reproduction.md §2）
// 锁定语义：
//   1. verdict 解析容错（围栏/脏 JSON → null，绝不抛错阻塞管线）
//   2. 综合分权重 + 水印一票否决
//   3. 择优保留（best-of-N 核心：分高者胜，无证据排后，全无证据 → 最后一次 + skipped）
//   4. 重抽判定（有确凿不合格证据才重抽；预算边界）
//   5. 变体 prompt（问题清单注入 + 构图 nudge）
//   6. gateFactsFor 与 shot-prompt 同源（锚点事实提取）
//   7. 评审不可用（VLM 失败）→ reviewImage 返回 null（诚实降级 skipped，绝不冒充通过）
// 铁律：fake provider 注入，绝不触网。
import { describe, it, expect, afterEach } from 'vitest'
import {
  GATE_VERDICT_SCHEMA,
  compositeScore,
  gateFactsFor,
  pickBestAttempt,
  shouldRegenerate,
  variantImagePrompt,
  EXEMPLAR_THRESHOLD,
  type GateAttempt,
  type GateVerdict,
} from '@/core/quality/shot-gate'
import { parseGateVerdict, reviewImage } from '@/ai/quality/vision-review'
import { registerProvider, clearRegistry, resetRegistry } from '@/ai/router/registry'
import type { VisionReviewProvider, ProviderCallContext } from '@/ai/router/types'
import { VersionStructureSchema, ShotSnapshotSchema, type ShotSnapshot, type VersionStructure } from '@/core/content/schemas'

const verdict = (over: Partial<GateVerdict> = {}): GateVerdict =>
  GATE_VERDICT_SCHEMA.parse({
    pass: true,
    scores: { character: 9, scene: 9, style: 9, technical: 9 },
    watermark: false,
    issues: [],
    summary: '好',
    ...over,
  })

const attempt = (v: GateVerdict | null, tag = 'img'): GateAttempt => ({
  imageBase64: tag,
  mime: 'image/png',
  verdict: v,
})

afterEach(() => resetRegistry())

describe('parseGateVerdict（解析容错：质量门绝不能因 VLM 输出形态翻车）', () => {
  it('合法 JSON 直过；markdown 围栏剥离', () => {
    const v = verdict({ pass: false, issues: ['人物年龄漂移'] })
    expect(parseGateVerdict(JSON.stringify(v))?.pass).toBe(false)
    expect(parseGateVerdict('```json\n' + JSON.stringify(v) + '\n```')?.pass).toBe(false)
  })

  it('缺字段/越界分数/非 JSON → null（调用方降级 skipped）', () => {
    expect(parseGateVerdict('{"pass":true}')).toBeNull() // scores 缺失
    expect(parseGateVerdict('{"pass":true,"scores":{"character":15,"scene":9,"style":9,"technical":9},"watermark":false}')).toBeNull() // 越界
    expect(parseGateVerdict('这不是 JSON')).toBeNull()
    expect(parseGateVerdict('')).toBeNull()
  })
})

describe('compositeScore（权重 + 水印一票否决）', () => {
  it('权重口径：character 0.30 / scene 0.25 / style 0.25 / technical 0.20', () => {
    expect(compositeScore(verdict({ scores: { character: 10, scene: 0, style: 0, technical: 0 } }))).toBeCloseTo(3.0)
    expect(compositeScore(verdict({ scores: { character: 0, scene: 10, style: 0, technical: 0 } }))).toBeCloseTo(2.5)
    expect(compositeScore(verdict({ scores: { character: 0, scene: 0, style: 10, technical: 0 } }))).toBeCloseTo(2.5)
    expect(compositeScore(verdict({ scores: { character: 0, scene: 0, style: 0, technical: 10 } }))).toBeCloseTo(2.0)
    expect(compositeScore(verdict())).toBeCloseTo(9.0)
  })

  it('水印一票否决：满分也归零', () => {
    expect(compositeScore(verdict({ watermark: true }))).toBe(0)
  })
})

describe('pickBestAttempt（择优保留 = 有界 best-of-N）', () => {
  it('分高者胜（保留重抽后更优的尝试）', () => {
    const bad = verdict({ pass: false, scores: { character: 3, scene: 3, style: 3, technical: 3 } })
    const good = verdict()
    const { best, skipped } = pickBestAttempt([attempt(bad, 'first'), attempt(good, 'second')])
    expect(best.imageBase64).toBe('second')
    expect(skipped).toBe(false)
  })

  it('评审无证据的尝试排在有证据者之后；全无证据 → 最后一次 + skipped=true', () => {
    const { best, skipped } = pickBestAttempt([attempt(null, 'a'), attempt(null, 'b')])
    expect(best.imageBase64).toBe('b')
    expect(skipped).toBe(true)
    // 有证据 vs 无证据：有证据胜（无证据 = 未评审，不能靠默认信任压过确凿低分？——反之亦然：
    // 低分证据排在无证据之后会惩罚诚实评审，故无证据恒排后，由 skipped 诚实标注）
    const low = verdict({ pass: false, scores: { character: 2, scene: 2, style: 2, technical: 2 } })
    const mixed = pickBestAttempt([attempt(low, 'scored'), attempt(null, 'unscored')])
    expect(mixed.best.imageBase64).toBe('scored')
    expect(mixed.skipped).toBe(false)
  })
})

describe('shouldRegenerate（重抽判定）', () => {
  it('确凿不合格（pass=false 或综合分 <7）且预算内 → 重抽', () => {
    const fail = verdict({ pass: false })
    const lowScore = verdict({ pass: true, scores: { character: 6, scene: 6, style: 6, technical: 6 } })
    expect(shouldRegenerate([attempt(fail)])).toBe(true)
    expect(shouldRegenerate([attempt(lowScore)])).toBe(true) // 6×0.2+... = 6 < 7
  })

  it('合格（≥7 且 pass）→ 不重抽；无证据 → 不重抽（可用性优先）', () => {
    expect(shouldRegenerate([attempt(verdict())])).toBe(false)
    expect(shouldRegenerate([attempt(null)])).toBe(false)
  })

  it('预算边界：尝试数超过 MAX_IMAGE_REGENS → 停（有界 best-of-3，供给不失控）', () => {
    const fail = verdict({ pass: false })
    expect(shouldRegenerate([attempt(fail), attempt(fail), attempt(fail)])).toBe(false)
  })
})

describe('variantImagePrompt（变体重抽）', () => {
  it('问题清单注入 + 构图 nudge；attempt 递进换 nudge', () => {
    const base = 'A quiet alley at dusk'
    const v1 = variantImagePrompt(base, ['人物年龄漂移', '背景空泛'], 1)
    expect(v1.startsWith(base)).toBe(true)
    expect(v1).toContain('人物年龄漂移')
    expect(v1).toContain('Recompose')
    const v2 = variantImagePrompt(base, [], 2)
    expect(v2).toContain('Adjust lighting')
  })
})

describe('gateFactsFor（评审上下文与 shot-prompt 同源）', () => {
  const shot: ShotSnapshot = ShotSnapshotSchema.parse({
    index: 0,
    visualDescription: '老巷口，父亲扶着自行车后座',
    imagePrompt: 'A father steadying a bicycle at dusk',
    cameraMotion: 'zoom_in',
    durationMs: 6000,
    shotSize: 'closeup',
    charactersInShot: ['父亲'],
  })
  const structure: VersionStructure = VersionStructureSchema.parse({
    concept: { name: '旧路上的风', oneLiner: '一辆旧自行车的视角重走父子路', visualDirection: '黄昏暖调' },
    characters: [
      {
        name: '父亲',
        description: '沉默的退伍工人',
        wardrobe: '洗旧的藏蓝衬衫',
        visualAnchor: 'A lean Chinese father in his 40s, faded navy shirt',
      },
    ],
    story: {
      logline: '松手那一下。',
      lookBook: 'teal night + amber pools, film grain',
      characters: [],
      scenes: [
        {
          index: 0,
          summary: '巷口学车',
          timeOfDay: '黄昏',
          locationAnchor: 'narrow old alley, cracked brick wall, late 1990s Chinese town',
          shots: [shot],
        },
      ],
    },
  })

  it('锚点/lookBook/景别/时段提取齐全（VLM 拿到与生成侧同一套事实）', () => {
    const facts = gateFactsFor(shot, structure)
    expect(facts.sceneAnchor).toContain('narrow old alley')
    expect(facts.lookBook).toContain('teal night')
    expect(facts.timeOfDay).toBe('黄昏')
    expect(facts.shotSize).toContain('close-up')
    expect(facts.characters).toEqual([
      { name: '父亲', visualAnchor: 'A lean Chinese father in his 40s, faded navy shirt' },
    ])
  })

  it('不在场人物不入评审事实（charactersInShot 过滤）', () => {
    const facts = gateFactsFor({ ...shot, charactersInShot: [] }, structure)
    expect(facts.characters).toEqual([])
  })
})

describe('reviewImage（编排壳：VLM 不可用 → null 诚实降级）', () => {
  const ctx: ProviderCallContext = { contentId: 'test-content', versionId: null, purpose: 'gate.image' }
  const facts = gateFactsFor(
    ShotSnapshotSchema.parse({ index: 0, visualDescription: 'x', imagePrompt: 'x', cameraMotion: 'zoom_in', durationMs: 6000 }),
    VersionStructureSchema.parse({ concept: { name: 'n', oneLiner: 'l', visualDirection: 'v' }, characters: [], story: { logline: 'l', characters: [], scenes: [] } }),
  )

  it('fake vision 返回合法 verdict → 解析成功', async () => {
    clearRegistry()
    registerProvider({
      id: 'fake-vision',
      capability: 'vision.review',
      model: 'fake-vision-model',
      async execute() {
        return { text: JSON.stringify(verdict({ pass: false, issues: ['光照矛盾'] })) }
      },
    } satisfies VisionReviewProvider)
    const v = await reviewImage('aGk=', 'image/png', facts, null, ctx)
    expect(v?.pass).toBe(false)
    expect(v?.issues).toEqual(['光照矛盾'])
  })

  it('fake vision 抛错（模拟 VLM 不可用）→ null（不抛出、不冒充通过）', async () => {
    clearRegistry()
    registerProvider({
      id: 'fake-vision-dead',
      capability: 'vision.review',
      model: 'fake-vision-model',
      async execute() {
        throw new Error('VLM 服务不可用')
      },
    } satisfies VisionReviewProvider)
    const v = await reviewImage('aGk=', 'image/png', facts, null, ctx)
    expect(v).toBeNull()
  })

  it('范例入库阈值口径锁定（8.0）', () => {
    expect(EXEMPLAR_THRESHOLD).toBe(8.0)
  })
})
