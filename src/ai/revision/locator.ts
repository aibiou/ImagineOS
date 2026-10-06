// 修订定位器（Master Brief §24 / T9.2.1 前置；M1 简化实现）
// 用户自然语言反馈（"再温暖一点"）→ RevisionPlan（改什么/为什么/影响哪些镜头）+ 修改后的完整结构
// UI 依据 plan.summary 展示"我将修改 X"确认点（风险 R3 缓解）。
import { completeJson } from '@/ai/router/llm-json'
import type { ProviderCallContext } from '@/ai/router/types'
import { VersionStructureSchema, type VersionStructure } from '@/core/content/schemas'
import { z } from 'zod'

export const REVISION_LEVELS = ['story', 'scene', 'shot', 'audio', 'style', 'character'] as const
export type RevisionLevel = (typeof REVISION_LEVELS)[number]

const RevisionOutputSchema = z.object({
  plan: z.object({
    /** 修改目标层级 */
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

const REVISION_SYSTEM = `你是 ImagineOS 的修订导演。用户看完自己的视频草稿后，用一句自然语言提出修改（例如"再温暖一点""结尾别这么悲伤""第二个镜头太快"）。

你的任务：
1. 定位：判断反馈指向哪一层（story=整体叙事 / scene=某个场景 / shot=某个镜头 / audio=旁白配音 / style=视觉风格 / character=人物形象），以及具体影响哪些镜头（全片统一编号，从 0 开始）。
2. 计划：用一句用户能听懂的话说明你将修改什么（"我将修改 X"格式）。
3. 执行：输出修改后的完整创作结构。铁律——未被反馈影响的部分必须逐字保留（特别是镜头序号、旁白台词、时长），只修改需要修改的字段。
4. 修改方式：调整 imagePrompt 的色调/光线/情绪词、narrationLine 的措辞、durationMs、视觉风格描述等。"更温暖"通常意味着：暖色调、柔光、人物更亲近的构图、旁白更柔软。

常见模式：
- "再温暖一点" → style/shot 层：全局色调与若干镜头的 imagePrompt 情绪词 + 旁白语气
- "结尾别这么悲伤" → story 层：最后一两个镜头的情绪与旁白 + imagePrompt
- "第二个镜头太快" → shot 层：shot[1].durationMs 增大
- "衣服改成黑色" → character 层：所有 imagePrompt 中的服装描述统一改`

const REVISION_JSON_HINT = `{
  "plan": { "targetLevel": "shot", "summary": "我将调暖全片色调，并软化结尾两句旁白", "reason": "「再温暖一点」指向整体情绪基调", "affectedShotIndexes": [0, 3, 4], "changeKind": "tone" },
  "structure": { ...修改后的完整 VersionStructure，形态与输入完全一致... }
}`

export async function planRevision(
  feedback: string,
  current: VersionStructure,
  ctx: ProviderCallContext,
): Promise<RevisionOutcome> {
  const userPrompt = `用户反馈：「${feedback}」

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
