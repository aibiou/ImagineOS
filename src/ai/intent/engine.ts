// Intent Engine（Master Brief §14–§17 / T3.1–T3.3）
// 自然语言 → 结构化、可验证、可追踪的 Intent Object。
// 设计要点：
//   - 字段级 source: 'user' | 'ai_default'（不变量 I5：缺省决策永不阻塞用户，但永不撒谎）
//   - LLM 抽取失败 → 降级为启发式默认 + 待访谈状态（不崩溃，AC of T3.2.1）
//   - Intent Interview：≤3 问（M1 精简自 §15 的 ≤5 问），每问可跳过
import { completeJson } from '@/ai/router/llm-json'
import { LLMJsonError } from '@/ai/router/llm-json'
import type { ProviderCallContext } from '@/ai/router/types'
import {
  IntentFieldsSchema,
  IntentRecordSchema,
  type IntentRecord,
} from '@/core/content/schemas'
import { aspectFromExpression } from '@/core/content/aspect'
import { isSerialDuration, serialKeywordsInExpression } from '@/core/content/season-geometry'
import { z } from 'zod'

// ---------- 抽取结果 ----------

const IntentExtractionSchema = z.object({
  fields: IntentFieldsSchema,
  sources: z.record(z.string(), z.enum(['user', 'ai_default'])),
  /** 针对信息不足处的澄清问题（≤3 问，简短自然，面向普通用户） */
  questions: z.array(z.string().trim().min(4).max(80)).max(3).default([]),
})

export interface IntentExtraction {
  record: IntentRecord
  questions: string[]
  /** true = LLM 不可用/输出无效，走了缺省决策引擎（§16） */
  degraded: boolean
  provider?: string
  model?: string
}

// ---------- Prompt ----------

const INTENT_SYSTEM = `你是 ImagineOS 的意图理解引擎。用户会说一段自然语言（可能口语化、不完整、带情绪），你的任务是把它编译为结构化的创作意图（Intent Object）。

规则：
1. 只把用户明确表达过的字段标记为 "user"；你推断或补全的字段标记为 "ai_default"。宁可标记 ai_default 也不要臆测用户原意。
2. 用户没提的字段用合理的创作默认值补全（例如 duration: 45，format: "short_film"，visual_style: "cinematic_realism"，narration: true）。
3. topic 必填：用 15 字以内概括用户想表达的主题。
4. duration 单位是秒（数字）。45 秒视频 → 45。
5. emotion 是情绪词数组（中文），如 ["温暖", "怀旧"]。
6. characters 数组：用户提到的人物（含"我""父亲"等），name 用用户原词，description 一句话。
7. 若有关键信息缺失（时长/观众/情绪基调/用途），在 questions 里提出最多 3 个简短自然的问题（面向普通人，不使用任何专业术语）。信息充足时 questions 为空数组。
8. aspectRatio 画幅：用户提到「横屏/横版/宽屏」（或明确说 16:9）→ "16:9"；「竖屏/竖版」（或 9:16）→ "9:16"；未提及 → 默认 "9:16"（标 ai_default）。
9. 长片与连续剧（serial-season-027）：duration 是用户想要的总时长（可到 3600）。总时长 ≥ 240 秒（4 分钟）→ format 填 "serial"（连续剧——平台会自动分集，每集 1-2 分钟，剧情连贯人物一致）；用户提到「连续剧/短剧/分集/每集几分钟」也填 "serial"。总时长 < 240 秒 → 照旧（short_film 等单集格式）。用户说「每集 X 分钟」时 duration 填总时长（若只给了集数与每集时长，相乘得总时长）。`

const INTENT_JSON_HINT = `{
  "fields": {
    "topic": "string（必填，≤15字）",
    "purpose": "string? 创作用途",
    "emotion": ["情绪词"]?,
    "audience": "string? 给谁看",
    "tone": "string? 语气基调",
    "format": "short_film | vlog | documentary | explainer | serial（连续剧：总时长≥240秒或用户提到分集/短剧/每集几分钟） | ...",
    "aspectRatio": "9:16 | 16:9（横屏/竖屏；未提及默认 9:16）",
    "duration": 45,
    "visual_style": "cinematic_realism | watercolor | anime | retro_film | ...",
    "narration": true,
    "creator_on_camera": false,
    "characters": [{ "name": "我", "description": "..." }],
    "references": ["用户提到的参照"],
    "constraints": ["用户提到的限制"]
  },
  "sources": { "topic": "user", "duration": "ai_default", "...": "user | ai_default（fields 的每个键都要标注）" },
  "questions": ["最多3个澄清问题，信息充足则空数组"]
}`

// ---------- 缺省决策引擎（§16 / T3.2.2） ----------

const DEFAULT_QUESTIONS = [
  '这个视频大概想多长？',
  '希望是什么情绪基调？（比如温暖、燃、平静）',
  '想给谁看？',
]

function heuristicIntent(rawExpression: string): IntentRecord {
  const cleaned = rawExpression.replace(/\s+/g, ' ').trim()
  // 从原话中尽力抽取时长（"45秒的视频" / "50分钟" / "一小时"）
  // 分钟上限 3600（serial-season-027：长片不再被锄成 5 分钟——分集几何会接管）
  let duration = 45
  let durationFromUser = false
  const secMatch = cleaned.match(/(\d{1,4})\s*(?:秒|s)\b/i)
  const minMatch = cleaned.match(/(\d{1,3})\s*分钟/)
  const hourMatch = cleaned.match(/([一二三]?\d)\s*个?小时/)
  if (secMatch?.[1]) {
    duration = Math.min(180, Math.max(5, Number(secMatch[1])))
    durationFromUser = true
  } else if (minMatch?.[1]) {
    duration = Math.min(3600, Number(minMatch[1]) * 60)
    durationFromUser = true
  } else if (hourMatch?.[1]) {
    duration = Math.min(3600, Number(hourMatch[1]) * 3600)
    durationFromUser = true
  }

  // 连续剧检测（关键词）：长片意图在降级路径也不丢分集语义
  const serial = serialKeywordsInExpression(cleaned) || isSerialDuration(duration)

  const fields = {
    topic: cleaned.length > 15 ? `${cleaned.slice(0, 15)}…` : cleaned,
    purpose: '记录并分享一段真实的表达',
    emotion: ['温暖'],
    audience: '通用观众',
    tone: '真诚自然',
    format: serial ? 'serial' : 'short_film',
    aspectRatio: aspectFromExpression(cleaned) ?? '9:16',
    duration,
    visual_style: 'cinematic_realism',
    narration: true,
    creator_on_camera: false,
    characters: [],
    references: [],
    constraints: [],
  }
  const sources: Record<string, 'user' | 'ai_default'> = {}
  for (const key of Object.keys(fields)) {
    sources[key] =
      key === 'topic' ||
      (key === 'duration' && durationFromUser) ||
      (key === 'format' && serial) ||
      (key === 'aspectRatio' && aspectFromExpression(cleaned))
        ? 'user'
        : 'ai_default'
  }

  return IntentRecordSchema.parse({
    fields,
    sources,
    interview: { asked: [], remainingBudget: 3, done: false },
  })
}

// ---------- 主入口 ----------

export interface ExtractIntentInput {
  rawExpression: string
  /** 访谈答案（按 questions 顺序；空串/未答 = 跳过） */
  answers?: string[]
  /** 已问过的问题（避免重复问） */
  askedQuestions?: string[]
}

export async function extractIntent(
  input: ExtractIntentInput,
  ctx: ProviderCallContext,
): Promise<IntentExtraction> {
  const answered = (input.answers ?? [])
    .map((a, i) => (a.trim() ? `Q${i + 1}: ${input.askedQuestions?.[i] ?? ''}\nA: ${a.trim()}` : null))
    .filter((x): x is string => x !== null)

  const userPrompt = `用户的原始表达：
"""${input.rawExpression}"""
${answered.length > 0 ? `\n访谈补充（用户对澄清问题的回答）：\n${answered.join('\n')}` : ''}
${input.askedQuestions?.length ? `\n（以下问题已经问过，不要再重复问：${input.askedQuestions.join(' / ')}）` : ''}

请输出结构化 Intent JSON。`

  try {
    const parsed = await completeJson(
      IntentExtractionSchema,
      { system: INTENT_SYSTEM, user: userPrompt, jsonHint: INTENT_JSON_HINT },
      ctx,
      { temperature: 0.2, repairRounds: 2 },
    )
    // asked 存「当前轮待回答的问题」（前端据此恢复访谈 UI）；历史轮信息已并入抽取上下文
    const record = IntentRecordSchema.parse({
      fields: parsed.fields,
      sources: parsed.sources,
      interview: {
        asked: parsed.questions,
        remainingBudget: Math.max(0, 3 - (input.askedQuestions?.length ?? 0) - parsed.questions.length),
        done: parsed.questions.length === 0,
      },
    })
    return {
      record,
      questions: parsed.questions.filter((q) => !input.askedQuestions?.includes(q)),
      degraded: false,
    }
  } catch (e) {
    if (!(e instanceof LLMJsonError) && !(e instanceof Error)) throw e
    // 降级路径（AC of T3.2.1）：缺字段 + 待访谈，永不阻塞
    const record = heuristicIntent(input.rawExpression)
    return {
      record,
      questions: DEFAULT_QUESTIONS.slice(0, record.interview?.remainingBudget ?? 0),
      degraded: true,
    }
  }
}
