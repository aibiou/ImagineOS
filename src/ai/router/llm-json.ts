// LLM 结构化输出助手：completeJson（T3.2.1）
// 流程：text.plan 调用 → 剥离 markdown 围栏 → JSON.parse → Zod 校验
//       失败 → 修复重试（把解析/校验错误喂回 LLM，最多 repairRounds 轮）→ 仍失败抛 LLMJsonError
import { router } from '@/ai/router/registry'
import type { ProviderCallContext } from '@/ai/router/types'
import type { ZodType } from 'zod'

export class LLMJsonError extends Error {
  readonly raw: string
  constructor(message: string, raw: string) {
    super(message)
    this.name = 'LLMJsonError'
    this.raw = raw
  }
}

/** 剥离 ```json ... ``` 围栏与前后杂质 */
export function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) return fence[1].trim()
  // 无围栏：截取第一个 { 到最后一个 }（或 [ ... ]）
  const firstObj = trimmed.indexOf('{')
  const lastObj = trimmed.lastIndexOf('}')
  if (firstObj >= 0 && lastObj > firstObj) return trimmed.slice(firstObj, lastObj + 1)
  const firstArr = trimmed.indexOf('[')
  const lastArr = trimmed.lastIndexOf(']')
  if (firstArr >= 0 && lastArr > firstArr) return trimmed.slice(firstArr, lastArr + 1)
  return trimmed
}

export interface CompleteJsonOptions {
  /** 修复重试轮数（默认 2，§T3.2.1） */
  repairRounds?: number
  temperature?: number
}

/**
 * 走 Model Router 的结构化 LLM 调用。
 * 调用方只需给出 system / user / jsonHint（目标 JSON 形态的自然语言描述）+ Zod schema。
 */
export async function completeJson<T>(
  schema: ZodType<T>,
  input: { system: string; user: string; jsonHint: string },
  ctx: ProviderCallContext,
  opts?: CompleteJsonOptions,
): Promise<T> {
  const repairRounds = opts?.repairRounds ?? 2
  const rounds: Array<{ role: 'user'; content: string }> = []

  const systemPrompt = `${input.system}

【输出格式（必须严格遵守）】
只输出一个 JSON 对象，不要输出任何解释、前后缀或 markdown 围栏。
目标 JSON 形态：
${input.jsonHint}`

  rounds.push({
    role: 'user',
    content: input.user,
  })

  let lastRaw = ''
  for (let round = 0; round <= repairRounds; round++) {
    const userContent =
      round === 0
        ? rounds[0]!.content
        : `${rounds[0]!.content}

【上一次输出无效，请修复】
上一次输出：
${lastRaw.slice(0, 2000)}
错误：
${rounds[round]?.content ?? 'JSON 解析或校验失败'}
请重新输出修正后的完整 JSON（仍只输出 JSON 本身）。`

    const { result } = await router.text(
      {
        system: systemPrompt,
        user: userContent,
        temperature: opts?.temperature ?? 0.4,
      },
      ctx,
    )
    lastRaw = result.text

    const candidate = stripJsonFence(result.text)
    try {
      const parsed = JSON.parse(candidate) as unknown
      const validated = schema.safeParse(parsed)
      if (validated.success) return validated.data
      const issues = validated.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')
      rounds.push({ role: 'user', content: `JSON 校验失败：${issues}` })
    } catch (e) {
      rounds.push({
        role: 'user',
        content: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }
  throw new LLMJsonError(`结构化输出在 ${repairRounds + 1} 轮后仍无效`, lastRaw)
}
