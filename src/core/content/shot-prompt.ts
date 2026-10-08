// 镜头提示词组装（纯函数，执行层的确定性部分）
// 设计纪律：配方（imagePrompt 等）由 LLM 创作并密封进版本；本模块只做「执行时增强」——
//   1. 人物视觉锚点注入：把 CharacterSheet.visualAnchor 程序化追加到每个 imagePrompt，
//      跨镜人物一致性从「prompt 规则祈祷」升级为「代码保证」；
//   2. 景别构图提示：shotSize → 英文构图短语，纠正 LLM 偶尔的景别漂移；
//   3. 风格基底 + 无文字水印围栏（原有行为保留）。
// 注意：注入只发生在调用图像/视频模型的时刻，不回写配方（版本密封不可变）。

import type { CharacterSheet, ShotSize, ShotSnapshot, VersionStructure } from './schemas'

/** 景别 → 英文构图短语（与 imagePrompt 的构图词互补，作为确定性兜底） */
export const SHOT_SIZE_FRAMING: Record<ShotSize, string> = {
  extreme_wide: 'extreme wide establishing shot, tiny figure in vast environment',
  wide: 'wide shot, full body visible with surroundings',
  medium: 'medium shot, waist-up framing',
  closeup: 'close-up shot, face and shoulders fill the frame',
  extreme_closeup: 'extreme close-up, single detail fills the frame',
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

function framingFragment(shot: Pick<ShotSnapshot, 'shotSize'>): string {
  if (!shot.shotSize) return ''
  return ` Framing: ${SHOT_SIZE_FRAMING[shot.shotSize]}.`
}

function styleOf(structure: VersionStructure): string {
  return structure.style ?? structure.concept?.visualDirection ?? 'cinematic, warm tone'
}

/** 图像生成提示词（执行层增强版：基底 + 景别兜底 + 人物锚点 + 围栏） */
export function imagePromptFor(shot: ShotSnapshot, structure: VersionStructure): string {
  const base = shot.imagePrompt ?? shot.visualDescription ?? 'a quiet cinematic moment'
  const characters = structure.characters.length > 0 ? structure.characters : (structure.story?.characters ?? [])
  return `${base}.${framingFragment(shot)}${anchorFragment(shot, characters)} Visual style: ${styleOf(structure)}. No text, no watermark, no subtitles in image.`
}

/** 图生视频运动提示词：首帧已定画面，描述「这一镜怎么动起来」（锚点同样注入，保持运动中人物一致） */
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
  return `${base}. Camera: ${motion}.${framingFragment(shot)}${anchorFragment(shot, characters)} Natural ambient movement within the scene (wind, light, fabric, subtle life), subjects move naturally. Visual style: ${styleOf(structure)}${emotion}. No text, no watermark.`
}
