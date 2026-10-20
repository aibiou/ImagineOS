// 修订定位器（Master Brief §24 / T9.2.1；cinema-product-021 语义升级）
// 用户自然语言反馈（"再温暖一点"）→ RevisionPlan（改什么/为什么/影响哪些镜头）+ 修改后的完整结构
// UI 依据 plan.summary 展示"我将修改 X"确认点（风险 R3 缓解）。
//
// 语义升级（吸收 cinema-018/020 的分层一致性架构）：
//   创作结构现在是分层传播的——lookBook（全片视觉圣经）/ locationAnchor（场景锚点）/ visualAnchor（人物锚点）
//   会被执行层注入每个镜头的生成提示词。因此修订的正道是「改高层一处，全片自动传播」，
//   而不是逐镜改写 imagePrompt 的色调词（旧 M1 行为——既不可靠也不一致）。
//   本模块用 prompt 教学 + revisionLayerMap（可用修订层菜单，纯函数）双管齐下。
import { completeJson } from '@/ai/router/llm-json'
import type { ProviderCallContext } from '@/ai/router/types'
import { VersionStructureSchema, type VersionStructure } from '@/core/content/schemas'
import { z } from 'zod'

export const REVISION_LEVELS = ['story', 'scene', 'shot', 'audio', 'style', 'character'] as const
export type RevisionLevel = (typeof REVISION_LEVELS)[number]

const RevisionOutputSchema = z.object({
  plan: z.object({
    /** 修改目标层级：style=视觉风格（lookBook）/ scene=场景（locationAnchor/timeOfDay）/ character=人物（visualAnchor） */
    targetLevel: z.enum(REVISION_LEVELS),
    /** 面向用户的修改说明："我将修改 X"（说人话，≤40字） */
    summary: z.string().min(4).max(60),
    /** 为什么这样改（≤60字） */
    reason: z.string().min(4).max(80),
    /** 受影响的镜头序号（全片统一编号，从 0 开始） */
    affectedShotIndexes: z.array(z.number().int().min(0)).default([]),
    /** 修改类型语义 */
    changeKind: z.enum(['tone', 'content', 'duration', 'style', 'structure']).default('tone'),
  }),
  /** 修改后的完整结构（与输入同形态；未受影响部分必须逐字保留） */
  structure: VersionStructureSchema,
})

export interface RevisionPlan {
  targetLevel: RevisionLevel
  summary: string
  reason: string
  affectedShotIndexes: number[]
  changeKind: 'tone' | 'content' | 'duration' | 'style' | 'structure'
}

export interface RevisionOutcome {
  plan: RevisionPlan
  structure: VersionStructure
}

const REVISION_SYSTEM = `你是 ImagineOS 的修订导演。用户看完自己的视频草稿后，用一句自然语言提出修改（例如"再温暖一点""结尾别这么悲伤""第二个镜头太快""这家店看着太冷清了"）。

创作结构是分层传播的：story.lookBook（全片视觉圣经）、每场景的 locationAnchor、每个人物的 visualAnchor，会被系统自动注入每一个镜头的生成提示词。因此你的核心方法论是——改高层一处，全片自动传播；绝不逐镜批量改写色调/环境/外观词（那样会造成不一致）。

定位优先级（从全局到局部）：
1. style 层 = story.lookBook：全片性视觉反馈（"色调再暖一点""整片更有胶片感""画面太冷了"）→ 只改 lookBook 一处。执行层会把它注入每一镜，affectedShotIndexes 通常是全部镜头。
2. scene 层 = 场景字段：某场景的环境氛围（"这家店太冷清""房间换个感觉"）→ 只改该场景的 locationAnchor；光线时段（"改成黄昏"）→ 改该场景 timeOfDay。同场景所有镜头自动继承。
3. character 层 = characters[].visualAnchor：人物外观（"衣服改成黑色""发型换一下"）→ 只改该人物的 visualAnchor 一处；所有出现该人物的镜头自动继承。人物内心（欲望/障碍/弧光）不影响画面。
4. shot 层 = 单镜特例：durationMs（"第二个镜头太快"）、shotSize（"这个镜头推近一点"）、narrationLine（台词措辞）、imagePrompt（该镜独有的画面内容改动）。
5. story 层 = 叙事结构："结尾别这么悲伤" → 最后场景的情绪、narrationLine 与 imagePrompt（结尾镜头）；"节奏拖沓" → 合并/删减场景。
6. aspectRatio 画幅：除非用户明确要求换横竖屏，绝不修改，且必须逐字保留。

铁律：
- 未被反馈影响的部分必须逐字保留（特别是镜头序号、旁白台词、时长、lookBook、locationAnchor、visualAnchor、aspectRatio）。
- 优先单点修改高层字段（lookBook / locationAnchor / visualAnchor），不批量改写镜头字段——注入机制会让一次修改自动作用于全片。
- affectedShotIndexes 只列画面或声音会真正变化的镜头（全片统一编号，从 0 开始；分层传播时列出该层影响到的所有镜头）。
- 修改 lookBook 时保持英文、≤40 词、覆盖色调+光线特质+影调质感三要素。修改 locationAnchor 保持英文、≤35 词。
- 旁白语气类反馈（audio 层）改 narrationLine 的措辞，不动画面。

常见模式：
- "再温暖一点" → style 层：story.lookBook 的色调词（加 warm amber / golden glow 类），可顺带软化结尾旁白
- "色调再暖一点" → style 层：只改 lookBook 一处，affectedShotIndexes = 全部
- "这家店看着太冷清了" → scene 层：该场景 locationAnchor（环境细节/灯光氛围）
- "衣服改成黑色" → character 层：该人物 visualAnchor 的服装描述
- "结尾别这么悲伤" → story 层：最后场景情绪 + 结尾镜头 narrationLine/imagePrompt
- "第二个镜头太快" → shot 层：该镜 durationMs 增大
- "这个镜头推近一点" → shot 层：该镜 shotSize 从 wide 改 medium 或 closeup`

const REVISION_JSON_HINT = `{
  "plan": { "targetLevel": "style", "summary": "我将把全片视觉圣经调成暖琥珀色调，画面会整体变暖", "reason": "「色调再暖一点」指向全片视觉基调，改 lookBook 一处即全片传播", "affectedShotIndexes": [0, 1, 2, 3, 4], "changeKind": "tone" },
  "structure": { ...修改后的完整 VersionStructure，形态与输入完全一致（只改 story.lookBook，其余逐字保留）... }
}`

/** 可用修订层菜单（纯函数）：把当前结构里「可被修订定位的层」连同现值列给 LLM——
 *  定位不再靠 LLM 在原始 JSON 里摸索，而是面对一张明确的菜单做选择题。
 *  未建立的层会标注「可创建」，给 lookBook/locationAnchor 缺失的旧配方一条升级路径。 */
export function revisionLayerMap(structure: VersionStructure): string {
  const lines: string[] = []
  const lb = structure.story?.lookBook?.trim()
  lines.push(
    lb
      ? `- 全片视觉圣经 story.lookBook（style 层，改这一处全片传播）：${lb.slice(0, 80)}`
      : '- 全片视觉圣经 story.lookBook（style 层）：尚未建立——全片性视觉反馈可创建它（英文，≤40词，色调+光线+影调）',
  )

  const scenes = structure.story?.scenes ?? []
  if (scenes.length > 0) {
    lines.push('- 场景锚点（scene 层，改某一处该场景所有镜头继承）：')
    scenes.forEach((sc) => {
      const anchor = sc.locationAnchor?.trim()
      const where = sc.location?.trim() || `场${sc.index}`
      lines.push(
        anchor
          ? `  · 场${sc.index}（${where}）：${anchor.slice(0, 60)}${sc.timeOfDay ? `｜时段：${sc.timeOfDay}` : ''}`
          : `  · 场${sc.index}（${where}）：锚点尚未建立——场景环境反馈可创建（英文，≤35词）${sc.timeOfDay ? `｜时段：${sc.timeOfDay}` : ''}`,
      )
    })
  }

  const characters = structure.characters.length > 0 ? structure.characters : (structure.story?.characters ?? [])
  if (characters.length > 0) {
    lines.push('- 人物视觉锚点（character 层，改某一处所有含该人物的镜头继承）：')
    characters.forEach((c) => {
      const anchor = c.visualAnchor?.trim()
      lines.push(anchor ? `  · ${c.name}：${anchor.slice(0, 60)}` : `  · ${c.name}：锚点尚未建立——外观反馈可创建（英文）`)
    })
  }

  lines.push(`- 画幅 aspectRatio：${structure.aspectRatio ?? '9:16（缺省）'}——除非用户明确要求，绝不修改`)
  return `当前可修订层（附现值，截断展示）：\n${lines.join('\n')}`
}

export async function planRevision(
  feedback: string,
  current: VersionStructure,
  ctx: ProviderCallContext,
): Promise<RevisionOutcome> {
  const userPrompt = `用户反馈：「${feedback}」

${revisionLayerMap(current)}

当前创作结构（JSON）：
${JSON.stringify(current, null, 2)}

请输出修订计划与修改后的完整结构。`

  const parsed = await completeJson(
    RevisionOutputSchema,
    { system: REVISION_SYSTEM, user: userPrompt, jsonHint: REVISION_JSON_HINT },
    ctx,
    { temperature: 0.3 },
  )
  return { plan: parsed.plan, structure: parsed.structure }
}
