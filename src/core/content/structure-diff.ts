// 创作结构差异摘要（修订可观测性 / 产品级）
// 用途：applyRevision 时对比「密封前配方 vs 修订后配方」，产出变了哪些层哪些字段的机器可读摘要，
//   写入 Provenance（revision.applied 事件）——修订定位器声称改 lookBook，账本直接验证「到底改了哪层」，
//   计划（plan.targetLevel）与实际改动（changedLayers）从此互证，不再靠祈祷。
// 设计纪律：纯函数、无 IO；路径记号稳定（story.lookBook / scene[2].locationAnchor / shot[5].imagePrompt /
//   character[老板].visualAnchor / aspectRatio），供测试与账本断言。

import type { StorySnapshot, VersionStructure } from './schemas'

export interface StructureDiffSummary {
  /** 变更路径列表（稳定记号，≤80 条防账本膨胀） */
  changedPaths: string[]
  /** 层级 → 变更字段数（story/scene/shot/character/style/world/aspectRatio） */
  changedLayers: Record<string, number>
}

interface FieldSpec {
  layer: string
  get: (s: VersionStructure) => unknown
}

const TOP_FIELDS: FieldSpec[] = [
  { layer: 'aspectRatio', get: (s) => s.aspectRatio },
  { layer: 'style', get: (s) => s.style },
  { layer: 'story', get: (s) => s.intentSummary },
]

const STORY_FIELDS: Array<{ key: keyof StorySnapshot; label: string }> = [
  { key: 'logline', label: 'story.logline' },
  { key: 'narrationStyle', label: 'story.narrationStyle' },
  { key: 'lookBook', label: 'story.lookBook' },
  { key: 'emotionArc', label: 'story.emotionArc' },
]

const CHARACTER_FIELDS = ['description', 'wardrobe', 'desire', 'obstacle', 'arc', 'visualAnchor'] as const

const SCENE_FIELDS = ['summary', 'location', 'locationAnchor', 'dramaticFunction', 'valueShift', 'timeOfDay'] as const

const SHOT_FIELDS = [
  'visualDescription',
  'imagePrompt',
  'cameraMotion',
  'shotSize',
  'transition',
  'charactersInShot',
  'durationMs',
  'narrationLine',
  'emotion',
  'motion',
] as const

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function bump(layers: Record<string, number>, layer: string) {
  layers[layer] = (layers[layer] ?? 0) + 1
}

/** 全片统一镜头编号（与修订定位器 affectedShotIndexes 同口径） */
export function summarizeStructureDiff(
  before: VersionStructure | null | undefined,
  after: VersionStructure | null | undefined,
): StructureDiffSummary {
  const changedPaths: string[] = []
  const changedLayers: Record<string, number> = {}
  const push = (path: string, layer: string) => {
    if (changedPaths.length < 80) changedPaths.push(path)
    bump(changedLayers, layer)
  }

  if (!before || !after) return { changedPaths, changedLayers }

  // ---- 顶层 ----
  for (const f of TOP_FIELDS) {
    if (!eq(f.get(before), f.get(after))) push(f.layer, f.layer)
  }

  // ---- story 层 ----
  const bs = before.story
  const as_ = after.story
  for (const { key, label } of STORY_FIELDS) {
    if (!eq(bs?.[key], as_?.[key])) {
      // lookBook 单列一层（全片视觉圣经是修订定位器的核心目标层）
      push(label, key === 'lookBook' ? 'lookBook' : 'story')
    }
  }

  // ---- 人物（以名字对齐；名字集合变化也计入 character 层） ----
  const bc = [...(before.characters ?? []), ...(bs?.characters ?? [])]
  const ac = [...(after.characters ?? []), ...(as_?.characters ?? [])]
  const byName = (list: typeof bc, name: string) => list.find((c) => c.name === name)
  for (const name of new Set([...bc.map((c) => c.name), ...ac.map((c) => c.name)])) {
    const b = byName(bc, name)
    const a = byName(ac, name)
    if (!b || !a) {
      push(`character[${name}]`, 'character')
      continue
    }
    for (const field of CHARACTER_FIELDS) {
      if (!eq(b[field], a[field])) push(`character[${name}].${field}`, 'character')
    }
  }

  // ---- 场景与镜头（全片统一镜头编号） ----
  const bScenes = bs?.scenes ?? []
  const aScenes = as_?.scenes ?? []
  let globalShot = 0
  const maxScenes = Math.max(bScenes.length, aScenes.length)
  for (let i = 0; i < maxScenes; i++) {
    const bS = bScenes[i]
    const aS = aScenes[i]
    if (!bS || !aS) {
      push(`scene[${i}]`, 'scene')
      globalShot += (bS?.shots.length ?? aS?.shots.length ?? 0)
      continue
    }
    for (const field of SCENE_FIELDS) {
      if (!eq(bS[field], aS[field])) {
        push(
          `scene[${i}].${field}`,
          field === 'locationAnchor' ? 'locationAnchor' : field === 'timeOfDay' ? 'timeOfDay' : 'scene',
        )
      }
    }
    const maxShots = Math.max(bS.shots.length, aS.shots.length)
    for (let j = 0; j < maxShots; j++) {
      const bSh = bS.shots[j]
      const aSh = aS.shots[j]
      if (!bSh || !aSh) {
        push(`shot[${globalShot}]`, 'shot')
      } else {
        for (const field of SHOT_FIELDS) {
          if (!eq(bSh[field], aSh[field])) push(`shot[${globalShot}].${field}`, 'shot')
        }
      }
      globalShot++
    }
  }

  return { changedPaths, changedLayers }
}
