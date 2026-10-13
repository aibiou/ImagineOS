// Season Bible 生成器（serial-season-027 §3）——AI 能力层
// 架构（§87）：圣经 Schema/校验闸/锚点指纹/引用取出在领域层 core/content/season-bible.ts；
//   本模块只做一件事——把长片意图编译为圣经的一次 LLM 调用（prompt + Zod 硬校验 + 语义闸）。
// 设计纪律（防飘逸的地基）：
//   - 圣经一次生成、落盘后冻结：后续所有集的 prompt 由代码注入圣经原文锚点，
//     LLM 只被允许「引用」，不允许「改写」（见 story.ts 的 season 注入与 freezeStoryToBible）
//   - 空库零注入向后兼容：非 serial 路径的 prompt 与旧版逐字一致

import { completeJson } from '@/ai/router/llm-json'
import type { ProviderCallContext } from '@/ai/router/types'
import type { IntentRecord } from '@/core/content/schemas'
import type { SeasonGeometry } from '@/core/content/season-geometry'
import {
  SeasonBibleSchema,
  seasonBibleViolations,
  type SeasonBible,
  type EpisodeOutline,
  type RecurringLocation,
  type SeasonAct,
} from '@/core/content/season-bible'

// 领域层结构再导出（调用方单一入口；兼容既有 import 路径）
export {
  SeasonBibleSchema,
  anchorHashOf,
  charactersForEpisode,
  locationsForEpisode,
  recapFragment,
  referenceClosureViolations,
  cliffhangerChainViolations,
  geometryViolations,
  seasonBibleViolations,
} from '@/core/content/season-bible'
export type { SeasonBible, EpisodeOutline, RecurringLocation, SeasonAct, SeasonEpisodeContext } from '@/core/content/season-bible'

// ---------- 圣经生成（LLM，一次调用） ----------

const SEASON_SYSTEM = `你是 ImagineOS 的连续剧总编剧，受过严格的长篇叙事训练。把一个长片创作意图规划为一部分集连续剧的「季圣经」——它是一次规划、全集引用的唯一事实源：人物外貌、场景面貌、视觉气质一经确定，全季所有集都必须原样引用，绝不重新发明。

结构（长篇的骨架——每一层都要有戏剧理由）：
- seasonLogline：整季故事一句话（含欲望与障碍的张力，≤60字）。
- 章节（acts）：把全季分为 2-8 幕，每幕交代 title 与 function（这一章干成什么），用 fromEpisode/toEpisode 圈定集范围；幕与幕之间要有递进（处境升级/关系反转/真相逼近）。
- 每集大纲（episodes）：每集含 title、synopsis（本集发生什么，≤80字，欲望与障碍怎么碰撞）、cliffhanger（集尾悬念，≤40字——观众为什么点开下一集）、emotionBeat（本集情绪落点）、charactersUsed、locationsUsed。
- 悬念链铁律：除大结局外每集结尾必须有 cliffhanger（危机升级/反转预告/情感悬念三型选一）；大结局必须收口（cliffhanger 为空串）。

人物（全季发动机，锚点冻结）：
- 每个人物：desire（他想要什么）、obstacle（什么阻碍他）、arc（整季弧光）。
- visualAnchor（英文，≤25 词）：年龄/体型/发型/服装/标志性道具的固定外貌——全季共用同一份描述，具体到「褪色的蓝衬衫、花白寸头」的颗粒度。这是观众跨集认人的唯一锚。

场景库（recurringLocations，锚点冻结）：
- 全季 1-8 个反复出现的场景。每个 locationAnchor（英文，≤35 词）：环境细节+光线状态+标志性道具。同一地点跨集必须共用同一份锚点；timeOfDay 常驻时段保持一致。

视觉圣经（lookBook，英文 ≤40 词）：全季一个视觉气质——色调（warm amber / cool teal）、光线特质（soft window light / harsh neon）、影调质感（35mm grain / clean digital）。整季只能有一个视觉人格。

规则：
1. narrationStyle 全季统一（第一人称/第三人称、口语/诗意，≤20字）。
2. 每集 synopsis 要具体（动作与细节，不报菜名）；相邻集之间剧情连续（上一集的悬念在下一集里被回应或加深）。
3. charactersUsed/locationsUsed 用名字精确引用人物表与场景库（写错名字 = 观众看到陌生人物/陌生地点）。
4. 为普通人写作：具体、真诚；情绪通过动作呈现。`

const SEASON_JSON_HINT = `{
  "seasonLogline": "外卖骑手老陈为救女儿欠下债，在暴雨季的城里接单还债，却撞见五年前失踪的妻子。",
  "narrationStyle": "第三人称，克制的白描",
  "lookBook": "Rain-soaked neon city nights, teal and amber contrast, wet reflective asphalt, moody 35mm film grain, intimate handheld realism",
  "characters": [
    { "name": "老陈", "desire": "还清女儿的手术债", "obstacle": "暴雨季订单骤减，债主步步紧逼", "arc": "从独自硬扛，到接受陌生人善意", "wardrobe": "洗旧的黄色雨衣", "visualAnchor": "A wiry Chinese delivery rider in his 40s, buzz cut with gray patches, faded yellow rain poncho over dark work clothes, scuffed knee-high boots, tired but resolute eyes" },
    { "name": "小雨", "desire": "等爸爸兑现去看海的承诺", "obstacle": "术后休学，独自在家", "arc": "从懂事得让人心疼，到把愿望说出口", "visualAnchor": "A frail 9-year-old Chinese girl, thin braided hair, pale blue hospital pajamas, a paper crane she folds repeatedly, quiet hopeful eyes" }
  ],
  "recurringLocations": [
    { "name": "骑手站点", "locationAnchor": "Cramped delivery dispatch station under an overpass, stacked insulated boxes, flickering fluorescent tube, rain drumming on tin roof, chalkboard tally of orders", "timeOfDay": "深夜" },
    { "name": "老陈家", "locationAnchor": "Small dim apartment, girl's paper cranes strung above her bed, old fan, kitchen light leaking into hallway, rain-streaked window", "timeOfDay": "夜晚" }
  ],
  "acts": [
    { "index": 0, "title": "暴雨开局", "function": "老陈的债务与女儿的病同时压顶", "fromEpisode": 0, "toEpisode": 3 }
  ],
  "episodes": [
    { "index": 0, "title": "暴雨第一单", "synopsis": "暴雨夜老陈抢下高危单，却在写字楼撞见一个不该出现的人影", "cliffhanger": "人影回头——是失踪五年的妻子", "emotionBeat": "压抑", "charactersUsed": ["老陈"], "locationsUsed": ["骑手站点"] },
    { "index": 1, "title": "雨夜追影", "synopsis": "老陈弃单追人影穿过半座城，订单超时罚款与真相近在眼前", "cliffhanger": "巷口空无一人，只有一只熟悉的旧发卡", "emotionBeat": "揪心", "charactersUsed": ["老陈"], "locationsUsed": ["老陈家"] }
  ]
}`

/** 生成季圣经（一次 LLM 调用 + 双重校验闸）。
 *  抛错口径与编剧层一致：Zod 失败 / 语义违例 → LLMJsonError 风格的 Error（含人话原因），
 *  调用方（Job 执行器）走既有重试语义。 */
export async function generateSeasonBible(
  intent: IntentRecord,
  concept: { name: string; oneLiner: string; emotion?: string; visualDirection?: string },
  geometry: SeasonGeometry,
  ctx: ProviderCallContext,
): Promise<SeasonBible> {
  const f = intent.fields
  const episodeSec = Math.round(geometry.episodeSec)
  const userPrompt = `创作意图：主题「${f.topic}」，总时长约 ${Math.round(geometry.totalSec / 60)} 分钟（${geometry.totalSec} 秒）${f.emotion?.length ? `，期望情绪 ${f.emotion.join('、')}` : ''}${f.characters?.length ? `，人物：${f.characters.map((c) => `${c.name}(${c.description ?? ''})`).join('、')}` : ''}
选定创作方向：「${concept.name}」——${concept.oneLiner}${concept.emotion ? `（情绪：${concept.emotion}）` : ''}${concept.visualDirection ? `（视觉：${concept.visualDirection}）` : ''}
分集几何：共 ${geometry.episodeCount} 集，每集约 ${episodeSec} 秒（观众口径「每集 1-2 分钟的连续剧」）。

请输出季圣经（人物锚点/场景锚点/视觉圣经一经确定全季冻结；每集 cliffhanger 悬念链；大结局收口）。`

  const parsed = await completeJson(
    SeasonBibleSchema,
    { system: SEASON_SYSTEM, user: userPrompt, jsonHint: SEASON_JSON_HINT },
    ctx,
    { temperature: 0.7, repairRounds: 2 },
  )

  const violations = seasonBibleViolations(parsed, geometry)
  if (violations.length > 0) {
    throw new Error(`季圣经语义校验未过：${violations.join('；')}`)
  }
  return parsed
}
