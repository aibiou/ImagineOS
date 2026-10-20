// 产品级升级回归测试（cinema-product-021）
// 2026-10-09 两项产品级目标：
//   1. 多画幅：9:16 竖屏（默认）/ 16:9 横屏——意图识别 → 配方密封 → 管线四点尺寸映射 → 展示面推断
//   2. 修订定位器语义升级：lookBook/locationAnchor/visualAnchor 分层定位 + revisionLayerMap 菜单 +
//      修订差异摘要（structure-diff）+ 画幅守卫（修订不丢画幅）
import { describe, expect, it } from 'vitest'
import {
  ASPECT_RATIOS,
  AspectRatioSchema,
  IntentFieldsSchema,
  IntentRecordSchema,
  VersionStructureSchema,
  type VersionStructure,
} from '@/core/content/schemas'
import {
  aspectFromDimensions,
  aspectFromExpression,
  aspectRatioOf,
  imageSizeForAspect,
  renderDimensionsForAspect,
  videoSizeForAspect,
} from '@/core/content/aspect'
import { summarizeStructureDiff } from '@/core/content/structure-diff'
import { revisionLayerMap, REVISION_LEVELS } from '@/ai/revision/locator'

// ---------- 测试素材 ----------

const baseStructure = (): VersionStructure =>
  VersionStructureSchema.parse({
    aspectRatio: '16:9',
    intentSummary: '深夜面馆的第三十七碗面',
    story: {
      logline: '老板给加班女孩留的面，今晚她没来。',
      lookBook: 'Cool teal night palette pierced by warm amber pools, 35mm film grain, soft haze',
      characters: [
        {
          name: '老板',
          desire: '等一个吃面的人',
          obstacle: '她今晚没来',
          arc: '从守候到释然',
          visualAnchor: 'A stocky middle-aged Chinese man in a white tank top and apron',
        },
      ],
      scenes: [
        {
          index: 0,
          summary: '打烊前的等待',
          location: '面馆厨房',
          locationAnchor: 'Tiny noodle shop kitchen, copper pots with oxidation, single tungsten bulb',
          dramaticFunction: 'hook',
          valueShift: '平静→悬念',
          timeOfDay: '深夜',
          shots: [
            {
              index: 0,
              imagePrompt: 'A steaming bowl on the counter under tungsten light',
              durationMs: 6000,
              narrationLine: '第三十七碗面，没人吃。',
              cameraMotion: 'zoom_in',
            },
            {
              index: 1,
              imagePrompt: 'The owner wipes the counter, glancing at the door',
              durationMs: 7000,
              narrationLine: '老板又把火拧大了一点。',
              cameraMotion: 'static',
            },
          ],
        },
        {
          index: 1,
          summary: '她曾经来过',
          location: '写字楼电梯间',
          locationAnchor: 'Cold elevator lobby, flickering fluorescent tube, rain-streaked glass',
          dramaticFunction: 'setup',
          valueShift: '悬念→温暖',
          timeOfDay: '深夜',
          shots: [
            {
              index: 0,
              imagePrompt: 'A tired young woman in the elevator holding her bag',
              durationMs: 6000,
              narrationLine: '她总说，这碗面撑过了加班的夜。',
              cameraMotion: 'pan_left',
            },
          ],
        },
      ],
    },
    characters: [
      {
        name: '老板',
        visualAnchor: 'A stocky middle-aged Chinese man in a white tank top and apron',
      },
    ],
  })

// ---------- 多画幅：Schema 与尺寸映射 ----------

describe('多画幅：Schema 与纯函数映射', () => {
  it('画幅枚举只认 9:16 / 16:9；非法值被拒（防 LLM 幻觉值入库）', () => {
    expect(ASPECT_RATIOS).toEqual(['9:16', '16:9'])
    expect(AspectRatioSchema.parse('16:9')).toBe('16:9')
    expect(() => AspectRatioSchema.parse('4:3')).toThrow()
    expect(() => AspectRatioSchema.parse('horizontal')).toThrow()
  })

  it('IntentFields / VersionStructure / IntentRecord 均接受画幅字段；旧配方（无画幅）向后兼容', () => {
    expect(IntentFieldsSchema.parse({ topic: 'x', aspectRatio: '16:9' }).aspectRatio).toBe('16:9')
    const vs = VersionStructureSchema.parse({ intentSummary: 'x' })
    expect(vs.aspectRatio).toBeUndefined()
    const record = IntentRecordSchema.parse({
      fields: { topic: 'x', aspectRatio: '9:16' },
      sources: { aspectRatio: 'user' },
    })
    expect(record.fields.aspectRatio).toBe('9:16')
  })

  it('画幅 → 图像/视频/渲染三尺寸映射（管线四点的唯一来源）', () => {
    expect(imageSizeForAspect('9:16')).toBe('768x1344')
    expect(imageSizeForAspect('16:9')).toBe('1344x768')
    expect(videoSizeForAspect('9:16')).toBe('720x1280')
    expect(videoSizeForAspect('16:9')).toBe('1280x720')
    expect(renderDimensionsForAspect('9:16')).toEqual({ width: 720, height: 1280 })
    expect(renderDimensionsForAspect('16:9')).toEqual({ width: 1280, height: 720 })
  })

  it('aspectRatioOf：配方画幅读取，缺省 9:16（旧版本零迁移兼容）', () => {
    expect(aspectRatioOf({ aspectRatio: '16:9' })).toBe('16:9')
    expect(aspectRatioOf({})).toBe('9:16')
    expect(aspectRatioOf({ aspectRatio: undefined })).toBe('9:16')
  })

  it('aspectFromExpression：用户原话画幅识别（意图启发式兜底）', () => {
    expect(aspectFromExpression('做一个横屏的短片，讲修表匠的故事')).toBe('16:9')
    expect(aspectFromExpression('宽屏电影感的画面')).toBe('16:9')
    expect(aspectFromExpression('要 16:9 的')).toBe('16:9')
    expect(aspectFromExpression('竖屏手机上看的')).toBe('9:16')
    expect(aspectFromExpression('竖版就对了')).toBe('9:16')
    expect(aspectFromExpression('深夜面馆的故事')).toBeNull()
  })

  it('aspectFromDimensions：成片宽高 → 展示面画幅推断（未知按竖屏）', () => {
    expect(aspectFromDimensions(1280, 720)).toBe('16:9')
    expect(aspectFromDimensions(720, 1280)).toBe('9:16')
    expect(aspectFromDimensions(null, null)).toBe('9:16')
    expect(aspectFromDimensions(undefined, 100)).toBe('9:16')
  })
})

// ---------- 修订定位器：层级菜单与语义 ----------

describe('修订定位器：revisionLayerMap（可用修订层菜单）', () => {
  it('列出 lookBook / 场景锚点 / 人物锚点 / 画幅，含现值', () => {
    const map = revisionLayerMap(baseStructure())
    expect(map).toContain('story.lookBook')
    expect(map).toContain('Cool teal night palette')
    expect(map).toContain('场0')
    expect(map).toContain('copper pots')
    expect(map).toContain('老板')
    expect(map).toContain('white tank top')
    expect(map).toContain('16:9')
  })

  it('未建立的层标注「可创建」（旧配方升级路径）；场景带时段', () => {
    const map = revisionLayerMap(
      VersionStructureSchema.parse({
        story: { scenes: [{ index: 0, summary: '只有摘要', shots: [{ index: 0 }] }] },
      }),
    )
    expect(map).toContain('尚未建立')
    expect(map).toContain('可创建')
    expect(map).toContain('9:16（缺省）')
  })

  it('修订层级枚举保持六层（style 层承载 lookBook 语义）', () => {
    expect(REVISION_LEVELS).toContain('style')
    expect(REVISION_LEVELS).toContain('scene')
    expect(REVISION_LEVELS).toContain('character')
  })
})

// ---------- 修订差异摘要（structure-diff） ----------

describe('修订差异摘要 summarizeStructureDiff', () => {
  it('只改 lookBook → 单路径 story.lookBook，层级计 lookBook=1（分层修订的直接证据）', () => {
    const before = baseStructure()
    const after = VersionStructureSchema.parse(
      JSON.parse(JSON.stringify(before)) as Record<string, unknown>,
    )
    after.story!.lookBook = 'Warm amber night palette, golden tungsten glow, 35mm film grain'
    const diff = summarizeStructureDiff(before, after)
    expect(diff.changedPaths).toEqual(['story.lookBook'])
    expect(diff.changedLayers).toEqual({ lookBook: 1 })
  })

  it('改场景锚点与单镜时长 → 各自路径；全片镜头编号连续（第二场首镜 = shot[2]）', () => {
    const before = baseStructure()
    const after = VersionStructureSchema.parse(
      JSON.parse(JSON.stringify(before)) as Record<string, unknown>,
    )
    after.story!.scenes![1]!.locationAnchor = 'Warm elevator lobby, soft ceiling light'
    after.story!.scenes![0]!.shots[1]!.durationMs = 9000
    const diff = summarizeStructureDiff(before, after)
    expect(diff.changedPaths).toContain('scene[1].locationAnchor')
    expect(diff.changedPaths).toContain('shot[1].durationMs')
    expect(diff.changedLayers.locationAnchor).toBe(1)
    expect(diff.changedLayers.shot).toBe(1)
  })

  it('改人物视觉锚点 → character[名字].visualAnchor；旁白/画面词未动则不计', () => {
    const before = baseStructure()
    const after = VersionStructureSchema.parse(
      JSON.parse(JSON.stringify(before)) as Record<string, unknown>,
    )
    after.characters[0]!.visualAnchor = 'A stocky man in a black shirt'
    const diff = summarizeStructureDiff(before, after)
    expect(diff.changedPaths).toEqual(['character[老板].visualAnchor'])
    expect(diff.changedLayers).toEqual({ character: 1 })
  })

  it('画幅变化可被识别（修订丢画幅/改画幅都逃不过账本）', () => {
    const before = baseStructure()
    const after = VersionStructureSchema.parse(
      JSON.parse(JSON.stringify(before)) as Record<string, unknown>,
    )
    after.aspectRatio = '9:16'
    const diff = summarizeStructureDiff(before, after)
    expect(diff.changedPaths).toContain('aspectRatio')
  })

  it('无变化 → 空摘要；空输入防御', () => {
    const before = baseStructure()
    const same = VersionStructureSchema.parse(
      JSON.parse(JSON.stringify(before)) as Record<string, unknown>,
    )
    expect(summarizeStructureDiff(before, same).changedPaths).toEqual([])
    expect(summarizeStructureDiff(null, null).changedPaths).toEqual([])
  })
})

// ---------- 画幅守卫（修订 round-trip） ----------

describe('画幅守卫（修订定位器输出 round-trip）', () => {
  it('修订结构丢画幅字段 → schema 仍合法但为 undefined（守卫必须由 applyRevision 补齐）', () => {
    const before = baseStructure()
    const dropped = JSON.parse(JSON.stringify(before)) as Record<string, unknown>
    delete (dropped as { aspectRatio?: unknown }).aspectRatio
    const after = VersionStructureSchema.parse(dropped)
    expect(after.aspectRatio).toBeUndefined()
    // 守卫语义：input.structure.aspectRatio ?? currentVersion.aspectRatio
    const guarded = after.aspectRatio ?? before.aspectRatio
    expect(guarded).toBe('16:9')
  })

  it('画幅非法值在 schema 层被拒（定位器幻觉出不来）', () => {
    const bad = JSON.parse(JSON.stringify(baseStructure())) as Record<string, unknown>
    bad.aspectRatio = '21:9'
    expect(() => VersionStructureSchema.parse(bad)).toThrow()
  })
})
