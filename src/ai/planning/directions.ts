// Creative Planner —— 创作方向生成（Master Brief §18 / T4.1）
// Intent → 2–4 个互异的创作方向（名称/一句话概念/情绪/视觉方向/预计时长）
import { completeJson } from '@/ai/router/llm-json'
import type { ProviderCallContext } from '@/ai/router/types'
import { CreativeDirectionSchema, type CreativeDirection, type IntentRecord } from '@/core/content/schemas'
import { z } from 'zod'

const DirectionsOutputSchema = z.object({
  directions: z.array(CreativeDirectionSchema).min(2).max(4),
})

const DIRECTIONS_SYSTEM = `你是 ImagineOS 的创意策划师。基于用户的结构化创作意图，提出 3 个互异的创作方向。

规则：
1. 方向之间必须在"叙事视角、情绪基调、视觉风格"至少一个维度明显不同——不是同一思路的三种说法。
2. 每个方向：name（≤8字的诗意名称）、oneLiner（一句话概念，≤40字，说人话）、emotion（主导情绪）、visualDirection（视觉方向描述，≤40字）、expectedDurationSec（预计时长，贴近用户意图的时长）。
3. 方向必须可执行：能落地为分镜故事，不是抽象口号。
4. id 用 d1/d2/d3 这样的短标识。`

const DIRECTIONS_JSON_HINT = `{
  "directions": [
    { "id": "d1", "name": "旧路上的风", "oneLiner": "以一辆旧自行车的视角，重走父子俩骑过的每一条路。", "emotion": "怀旧·温柔", "visualDirection": "黄昏暖调、胶片颗粒、逆光剪影", "expectedDurationSec": 45 },
    { "id": "d2", "name": "车铃声里", "oneLiner": "以车铃声作为记忆开关，串联三十年的六个夏天。", "emotion": "明亮·俏皮", "visualDirection": "水彩晕染、高饱和夏日色", "expectedDurationSec": 40 }
  ]
}`

export async function generateDirections(
  intent: IntentRecord,
  ctx: ProviderCallContext,
  opts?: { count?: number },
): Promise<CreativeDirection[]> {
  const count = opts?.count ?? 3
  const f = intent.fields
  const userPrompt = `用户创作意图：
- 主题：${f.topic}
${f.purpose ? `- 用途：${f.purpose}` : ''}
${f.emotion?.length ? `- 期望情绪：${f.emotion.join('、')}` : ''}
${f.audience ? `- 观众：${f.audience}` : ''}
${f.tone ? `- 语气：${f.tone}` : ''}
${f.duration ? `- 时长：约 ${f.duration} 秒` : ''}
${f.visual_style ? `- 视觉风格偏好：${f.visual_style}` : ''}
${f.characters?.length ? `- 涉及人物：${f.characters.map((c) => c.name).join('、')}` : ''}
${f.constraints?.length ? `- 限制：${f.constraints.join('；')}` : ''}

请提出 ${count} 个互异的创作方向。`

  const parsed = await completeJson(
    DirectionsOutputSchema,
    { system: DIRECTIONS_SYSTEM, user: userPrompt, jsonHint: DIRECTIONS_JSON_HINT },
    ctx,
    { temperature: 0.8 },
  )
  return parsed.directions
}

/** 方向选择冻结后的 Concept（§18：选定即冻结，进入 Story 阶段） */
export function freezeConcept(direction: CreativeDirection) {
  return {
    directionId: direction.id,
    name: direction.name,
    oneLiner: direction.oneLiner,
    emotion: direction.emotion,
    visualDirection: direction.visualDirection,
  }
}
