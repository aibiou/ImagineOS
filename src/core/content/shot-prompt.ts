// 镜头提示词组装（纯函数，执行层的确定性部分）
// 设计纪律：配方（imagePrompt 等）由 LLM 创作并密封进版本；本模块只做「执行时增强」——
//   1. 人物视觉锚点注入：把 CharacterSheet.visualAnchor 程序化追加到每个 imagePrompt，
//      跨镜人物一致性从「prompt 规则祈祷」升级为「代码保证」；
//   2. 世界一致性注入（影视全面一致性升级）：
//      - 全片视觉圣经 lookBook：StorySnapshot.lookBook 注入每个镜头（一部片子一个视觉气质）；
//      - 场景视觉锚点 locationAnchor：镜头所属 Scene 的锚点注入（同场景所有镜头共用同一世界观）；
//      - 时段光线 timeOfDay：中文时段词映射为英文光线短语（同场景光线连续）；
//   3. 景别构图提示：shotSize → 英文构图短语，纠正 LLM 偶尔的景别漂移；
//   4. 风格基底 + 无文字水印围栏（原有行为保留）。
// 注意：注入只发生在调用图像/视频模型的时刻，不回写配方（版本密封不可变）。

import type { CharacterSheet, SceneSnapshot, ShotSize, ShotSnapshot, VersionStructure } from './schemas'

/** 景别 → 英文构图短语（与 imagePrompt 的构图词互补，作为确定性兜底） */
export const SHOT_SIZE_FRAMING: Record<ShotSize, string> = {
  extreme_wide: 'extreme wide establishing shot, tiny figure in vast environment',
  wide: 'wide shot, full body visible with surroundings',
  medium: 'medium shot, waist-up framing',
  closeup: 'close-up shot, face and shoulders fill the frame',
  extreme_closeup: 'extreme close-up, single detail fills the frame',
}

/** 中文时段词 → 英文光线短语（同场景光线连续性的确定性兜底；未匹配则不注入） */
const TIME_OF_DAY_LIGHTING: Array<{ match: RegExp; phrase: string }> = [
  { match: /晚霞|火烧云|日落余晖/, phrase: 'vivid sunset afterglow, glowing warm sky' },
  { match: /黄昏|暮色|傍晚|夕暮|夕阳/, phrase: 'golden hour dusk light, long warm shadows' },
  { match: /深夜|午夜|凌晨[一二三四]?点?|半夜/, phrase: 'deep night ambience, dark blue tones with warm artificial lights' },
  { match: /夜晚|入夜|夜里|晚上/, phrase: 'night scene, warm artificial lights against dark surroundings' },
  { match: /清晨|黎明|破晓|拂晓/, phrase: 'soft cool dawn light, gentle morning haze' },
  { match: /上午/, phrase: 'soft clear morning daylight' },
  { match: /正午|中午|晌午/, phrase: 'harsh overhead midday sun, short hard shadows' },
  { match: /下午/, phrase: 'warm slanting afternoon light' },
  { match: /雨夜/, phrase: 'rainy night, wet reflective surfaces with scattered lights' },
  { match: /雪|冬/, phrase: 'cold winter light, desaturated crisp air' },
]

/** 时段 → 光线短语（导出供测试；无匹配返回空串） */
export function lightingPhraseFor(timeOfDay: string | undefined): string {
  if (!timeOfDay?.trim()) return ''
  for (const { match, phrase } of TIME_OF_DAY_LIGHTING) {
    if (match.test(timeOfDay)) return phrase
  }
  return ''
}

/** 解析镜头所属场景：引用匹配优先（执行器传同一对象图）；结构兜底（index+imagePrompt+durationMs 一致，
 *  覆盖 Zod parse 克隆 / 修订流克隆对象等场景——per-scene index 需与 imagePrompt 联合消歧） */
export function sceneOfShot(
  shot: ShotSnapshot,
  structure: Pick<VersionStructure, 'story'>,
): SceneSnapshot | undefined {
  const scenes = structure.story?.scenes ?? []
  for (const scene of scenes) {
    if (scene.shots.includes(shot)) return scene
  }
  for (const scene of scenes) {
    if (
      scene.shots.some(
        (s) => s.index === shot.index && s.imagePrompt === shot.imagePrompt && s.durationMs === shot.durationMs,
      )
    ) {
      return scene
    }
  }
  return undefined
}

/** 镜头涉及的人物解析：charactersInShot 显式标注优先；名字出现在画面描述里时兜底匹配 */
export function charactersForShot(
  shot: Pick<ShotSnapshot, 'charactersInShot' | 'visualDescription' | 'imagePrompt'>,
  characters: CharacterSheet[],
): CharacterSheet[] {
  if (characters.length === 0) return []
  const explicit = shot.charactersInShot ?? []
  if (explicit.length > 0) {
    const matched = characters.filter((c) => explicit.includes(c.name))
    if (matched.length > 0) return matched
  }
  // 兜底：名字（中文原词）出现在 visualDescription / imagePrompt 中即视为在场
  const haystack = `${shot.visualDescription ?? ''} ${shot.imagePrompt ?? ''}`
  return characters.filter((c) => haystack.includes(c.name))
}

/** 人物视觉锚点片段（去重；仅含有 visualAnchor 的人物） */
function anchorFragment(shot: Pick<ShotSnapshot, 'charactersInShot' | 'visualDescription' | 'imagePrompt'>, characters: CharacterSheet[]): string {
  const present = charactersForShot(shot, characters).filter((c) => c.visualAnchor?.trim())
  if (present.length === 0) return ''
  return ` Characters (keep visually consistent): ${present.map((c) => `${c.name}: ${c.visualAnchor!.trim()}`).join('; ')}.`
}

/** 世界一致性片段：场景锚点 + 时段光线（同场景所有镜头共用同一世界观） */
function worldFragment(shot: ShotSnapshot, structure: VersionStructure): string {
  const scene = sceneOfShot(shot, structure)
  if (!scene) return ''
  const parts: string[] = []
  if (scene.locationAnchor?.trim()) {
    parts.push(`Scene (keep environment consistent): ${scene.locationAnchor.trim()}`)
  }
  const lighting = lightingPhraseFor(scene.timeOfDay)
  if (lighting) parts.push(`Lighting: ${lighting}`)
  return parts.length > 0 ? ` ${parts.join('. ')}.` : ''
}

/** 全片视觉圣经片段（一部片子一个视觉气质） */
function lookBookFragment(structure: VersionStructure): string {
  const lb = structure.story?.lookBook?.trim()
  if (!lb) return ''
  return ` Film look (whole film): ${lb}.`
}

function framingFragment(shot: Pick<ShotSnapshot, 'shotSize'>): string {
  if (!shot.shotSize) return ''
  return ` Framing: ${SHOT_SIZE_FRAMING[shot.shotSize]}.`
}

/** 景别指令前置（025 战线一）：图像模型对 prompt 开头的注意力最高——
 *  024 实战镜4 暴露「prompt 要求特写、模型给中景」，中部的 Framing 提示权重不足。
 *  首抽即前置硬指令；尾部 framingFragment 保留（首尾双保险）。 */
function framingLead(shot: Pick<ShotSnapshot, 'shotSize'>): string {
  if (!shot.shotSize) return ''
  return `Framing requirement: ${SHOT_SIZE_FRAMING[shot.shotSize]}. `
}

function styleOf(structure: VersionStructure): string {
  return structure.style ?? structure.concept?.visualDirection ?? 'cinematic, warm tone'
}

/** 图像生成提示词（执行层增强版：景别前置硬指令 + 基底 + 世界一致性 + 人物锚点 + 围栏） */
export function imagePromptFor(shot: ShotSnapshot, structure: VersionStructure): string {
  const base = shot.imagePrompt ?? shot.visualDescription ?? 'a quiet cinematic moment'
  const characters = structure.characters.length > 0 ? structure.characters : (structure.story?.characters ?? [])
  return `${framingLead(shot)}${base}.${framingFragment(shot)}${anchorFragment(shot, characters)}${worldFragment(shot, structure)}${lookBookFragment(structure)} Visual style: ${styleOf(structure)}. No text, no watermark, no subtitles in image.`
}

/** 图生视频运动提示词：首帧已定画面，描述「这一镜怎么动起来」（锚点同样注入，保持运动中人物与世界一致） */
export function videoPromptFor(shot: ShotSnapshot, structure: VersionStructure): string {
  const base = shot.imagePrompt ?? shot.visualDescription ?? 'a quiet cinematic moment'
  const cam: Record<string, string> = {
    zoom_in: 'slow cinematic push in',
    zoom_out: 'slow cinematic pull back',
    pan_left: 'gentle pan to the left',
    pan_right: 'gentle pan to the right',
    static: 'subtle handheld drift',
  }
  const motion = cam[shot.cameraMotion ?? 'zoom_in'] ?? 'subtle camera drift'
  const emotion = shot.emotion ? `, overall mood: ${shot.emotion}` : ''
  const characters = structure.characters.length > 0 ? structure.characters : (structure.story?.characters ?? [])
  return `${base}. Camera: ${motion}.${framingFragment(shot)}${anchorFragment(shot, characters)}${worldFragment(shot, structure)}${lookBookFragment(structure)} Natural ambient movement within the scene (wind, light, fabric, subtle life), subjects move naturally. Visual style: ${styleOf(structure)}${emotion}. No text, no watermark.`
}
