// 季圣经的领域结构（serial-season-027 §3/§4）——纯 Zod + 纯函数，零 AI 依赖
// 架构定位（§87）：圣经是领域数据（一次规划、全集引用的唯一事实源），
//   Schema/校验闸/锚点指纹/引用取出都在领域层；LLM 生成能力在 src/ai/planning/season.ts。
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { CharacterSheetSchema, type CharacterSheet } from '@/core/content/schemas'
import type { SeasonGeometry } from '@/core/content/season-geometry'

// ---------- 圣经 Schema ----------

export const RecurringLocationSchema = z.object({
  /** 场景名（中文，集大纲引用键；如「深夜面馆」） */
  name: z.string().min(1),
  /** 场景视觉锚点（英文，≤35 词）：环境细节+光线状态+标志性道具——全季冻结 */
  locationAnchor: z.string().min(8),
  /** 该场景的常驻时段（可选；同场景光线跨集一致） */
  timeOfDay: z.string().optional(),
})
export type RecurringLocation = z.infer<typeof RecurringLocationSchema>

export const SeasonActSchema = z.object({
  index: z.number().int().min(0),
  /** 幕标题（中文，≤12 字） */
  title: z.string().min(1).max(24),
  /** 幕功能：这一章在整季里干成什么（≤30 字） */
  function: z.string().min(2).max(60),
  /** 起止集（含端点，0 基） */
  fromEpisode: z.number().int().min(0),
  toEpisode: z.number().int().min(0),
})
export type SeasonAct = z.infer<typeof SeasonActSchema>

export const EpisodeOutlineSchema = z.object({
  index: z.number().int().min(0),
  /** 集标题（中文，≤16 字） */
  title: z.string().min(1).max(32),
  /** 本集梗概（≤80 字：本集发生什么、欲望与障碍怎么碰撞） */
  synopsis: z.string().min(8).max(160),
  /** 集尾悬念（≤40 字；大结局必须为空串——悬念链到此收口） */
  cliffhanger: z.string().max(80),
  /** 本集情绪落点（一个词） */
  emotionBeat: z.string().min(1).max(12),
  /** 本集出场人物（名字必须与 characters[].name 完全一致） */
  charactersUsed: z.array(z.string()).min(1),
  /** 本集场景（名字必须与 recurringLocations[].name 完全一致） */
  locationsUsed: z.array(z.string()).min(1),
})
export type EpisodeOutline = z.infer<typeof EpisodeOutlineSchema>

export const SeasonBibleSchema = z.object({
  /** 整季一句话（含欲望与障碍的张力，≤60 字） */
  seasonLogline: z.string().min(8).max(120),
  /** 旁白风格（全季统一） */
  narrationStyle: z.string().min(1).max(24),
  /** 全季视觉圣经（英文，≤40 词）：色调+光线特质+影调质感——整季一个视觉气质 */
  lookBook: z.string().min(12).max(400),
  /** 人物表（视觉锚点全季冻结） */
  characters: z.array(CharacterSheetSchema).min(1).max(6),
  /** 场景库（锚点全季冻结） */
  recurringLocations: z.array(RecurringLocationSchema).min(1).max(8),
  /** 章节幕 */
  acts: z.array(SeasonActSchema).min(1).max(8),
  /** 逐集大纲（集数 = 几何 episodeCount） */
  episodes: z.array(EpisodeOutlineSchema).min(2).max(60),
})
export type SeasonBible = z.infer<typeof SeasonBibleSchema>

// ---------- 集生成上下文（编剧层注入用——ai 层与领域层共用的契约类型） ----------

/** 一集的生成约束：圣经 + 本集大纲 + 分集几何（serial-season-027 §4 L1） */
export interface SeasonEpisodeContext {
  bible: SeasonBible
  episode: EpisodeOutline
  geometry: SeasonGeometry
}

// ---------- 冻结与校验（纯函数） ----------

/** 锚点指纹：圣经中一切「不许漂」的字节串的联合哈希（sha256 前 16 位）。
 *  落盘一次、全集对账——任何一集的锚点与圣经不一致 = 可检测的漂移事件。 */
export function anchorHashOf(bible: Pick<SeasonBible, 'lookBook' | 'characters' | 'recurringLocations'>): string {
  const material = JSON.stringify({
    lookBook: bible.lookBook.trim(),
    characters: bible.characters.map((c) => ({ name: c.name, visualAnchor: (c.visualAnchor ?? '').trim() })),
    recurringLocations: bible.recurringLocations.map((l) => ({ name: l.name, locationAnchor: l.locationAnchor.trim() })),
  })
  return createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 16)
}

/** 引用闭合校验（纯函数）：集大纲的人物/场景引用必须能在圣经表里找到同名条目。
 *  返回违例清单（空数组 = 闭合）。这是 Zod 之外的跨字段语义校验。 */
export function referenceClosureViolations(bible: SeasonBible): string[] {
  const violations: string[] = []
  const characterNames = new Set(bible.characters.map((c) => c.name))
  const locationNames = new Set(bible.recurringLocations.map((l) => l.name))
  for (const ep of bible.episodes) {
    for (const name of ep.charactersUsed) {
      if (!characterNames.has(name)) violations.push(`第 ${ep.index + 1} 集人物「${name}」不在人物表`)
    }
    for (const name of ep.locationsUsed) {
      if (!locationNames.has(name)) violations.push(`第 ${ep.index + 1} 集场景「${name}」不在场景库`)
    }
  }
  return violations
}

/** 悬念链校验（纯函数）：非末集 cliffhanger 非空、末集必须收口（空）；集序号 0..N-1 连续。 */
export function cliffhangerChainViolations(bible: SeasonBible): string[] {
  const violations: string[] = []
  const lastIndex = bible.episodes.length - 1
  bible.episodes.forEach((ep, i) => {
    if (ep.index !== i) violations.push(`集序号不连续：期望 ${i}，得到 ${ep.index}`)
    if (i < lastIndex && !ep.cliffhanger.trim()) violations.push(`第 ${i + 1} 集缺少集尾悬念`)
    if (i === lastIndex && ep.cliffhanger.trim()) violations.push('大结局不应留悬念（应收口）')
  })
  return violations
}

/** 几何对账（纯函数）：集大纲数量与分集几何一致。 */
export function geometryViolations(bible: SeasonBible, geometry: SeasonGeometry): string[] {
  if (bible.episodes.length !== geometry.episodeCount) {
    return [`集大纲数量 ${bible.episodes.length} ≠ 几何集数 ${geometry.episodeCount}`]
  }
  return []
}

/** 圣经全量语义校验（Zod 之后的第二道闸）：引用闭合 + 悬念链 + 几何对账。 */
export function seasonBibleViolations(bible: SeasonBible, geometry: SeasonGeometry): string[] {
  return [
    ...referenceClosureViolations(bible),
    ...cliffhangerChainViolations(bible),
    ...geometryViolations(bible, geometry),
  ]
}

// ---------- 圣经 → 每集约束（冻结注入的纯函数侧） ----------

/** 人物表按集引用取出（深拷贝，保持 bible 字节一致的锚点）。
 *  引用缺失的名字静默跳过（集大纲已过引用闭合校验，这里是防御性兜底）。 */
export function charactersForEpisode(bible: SeasonBible, ep: EpisodeOutline): CharacterSheet[] {
  const wanted = new Set(ep.charactersUsed)
  return bible.characters.filter((c) => wanted.has(c.name)).map((c) => ({ ...c }))
}

/** 场景按集引用取出（深拷贝）。 */
export function locationsForEpisode(bible: SeasonBible, ep: EpisodeOutline): RecurringLocation[] {
  const wanted = new Set(ep.locationsUsed)
  return bible.recurringLocations.filter((l) => wanted.has(l.name)).map((l) => ({ ...l }))
}

/** 前情提要片段（中文，给下一集的 story prompt 用——剧情连续性的显式线索）：
 *  上一集 synopsis + cliffhanger（上一集结尾悬着什么）。 */
export function recapFragment(bible: SeasonBible, episodeIndex: number): string {
  if (episodeIndex <= 0) return ''
  const prev = bible.episodes.find((e) => e.index === episodeIndex - 1)
  if (!prev) return ''
  return `前情提要（上一集）：${prev.synopsis}。集尾悬念：${prev.cliffhanger || '（已收口）'}`
}
