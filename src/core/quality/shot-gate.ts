// 镜头质量门——纯函数核心（设计见 docs/design/quality-reproduction.md §2）
// 职责：verdict 模型 / 评分 / 择优 / 重试判定 / 变体 prompt / 评审上下文组装。
// 编排壳（触 Model Router 的 reviewImage/reviewVideo/parseGateVerdict）在 src/ai/quality/vision-review.ts——
// 架构边界（§87）：core 零 AI 实现依赖，AI 能力一律经 src/ai。
// 纪律：质量门是增强件不是单点故障——评审不可用时诚实降级 skipped，绝不冒充通过，也绝不阻塞管线。

import { z } from 'zod'
import type { ShotSnapshot, VersionStructure } from '@/core/content/schemas'
import { SHOT_SIZE_FRAMING, sceneOfShot } from '@/core/content/shot-prompt'

// ---------- Verdict 模型 ----------

export const GATE_SCORE_SCHEMA = z.object({
  character: z.number().min(0).max(10),
  scene: z.number().min(0).max(10),
  style: z.number().min(0).max(10),
  technical: z.number().min(0).max(10),
})

export const GATE_VERDICT_SCHEMA = z.object({
  pass: z.boolean(),
  scores: GATE_SCORE_SCHEMA,
  watermark: z.boolean(),
  issues: z.array(z.string()).max(6).default([]),
  summary: z.string().max(400).default(''),
})

export type GateVerdict = z.infer<typeof GATE_VERDICT_SCHEMA>

/** 综合分：人物 0.30 + 场景 0.25 + 影调 0.25 + 技术 0.20；水印一票否决（返回 0） */
export const SCORE_WEIGHTS = { character: 0.3, scene: 0.25, style: 0.25, technical: 0.2 } as const

export function compositeScore(verdict: GateVerdict): number {
  if (verdict.watermark) return 0
  const s = verdict.scores
  return (
    s.character * SCORE_WEIGHTS.character +
    s.scene * SCORE_WEIGHTS.scene +
    s.style * SCORE_WEIGHTS.style +
    s.technical * SCORE_WEIGHTS.technical
  )
}

/** 范例库入库阈值（综合分 ≥ 该值自动沉淀） */
export const EXEMPLAR_THRESHOLD = 8.0

/** 图像变体重抽上限（含首次共 ≤ 1+MAX_IMAGE_REGENS 次尝试 = 有界 best-of-3） */
export const MAX_IMAGE_REGENS = Number(process.env.IMAGINEOS_IMAGE_GATE_REGENS ?? 2)

/** 视频严格缺陷重试上限（RPM=1 供给珍贵，只给 1 次） */
export const MAX_VIDEO_REGENS = 1

// ---------- 评审上下文（与 shot-prompt 同源的事实描述） ----------

export interface GateFacts {
  shotIndex: number
  sceneAnchor: string
  timeOfDay: string
  lookBook: string
  style: string
  shotSize?: string
  characters: Array<{ name: string; visualAnchor: string }>
}

/** 从配方提取评审事实（锚点原文不翻译——VLM 直接读中文；场景解析与 shot-prompt 同源同口径） */
export function gateFactsFor(shot: ShotSnapshot, structure: VersionStructure): GateFacts {
  const scene = sceneOfShot(shot, structure)
  const characters = (structure.characters.length > 0 ? structure.characters : structure.story?.characters ?? [])
    .filter((c) => (shot.charactersInShot ?? []).includes(c.name) && c.visualAnchor?.trim())
    .map((c) => ({ name: c.name, visualAnchor: c.visualAnchor!.trim() }))
  return {
    shotIndex: shot.index,
    sceneAnchor: scene?.locationAnchor?.trim() ?? '',
    timeOfDay: scene?.timeOfDay?.trim() ?? '',
    lookBook: structure.story?.lookBook?.trim() ?? '',
    style: structure.style ?? structure.concept?.visualDirection ?? '',
    shotSize: shot.shotSize ? SHOT_SIZE_FRAMING[shot.shotSize] : undefined,
    characters,
  }
}

// ---------- 图像门 prompt（纯函数） ----------

const JSON_HINT = `{
  "pass": true/false,
  "scores": { "character": 0-10, "scene": 0-10, "style": 0-10, "technical": 0-10 },
  "watermark": true/false,
  "issues": ["具体问题1", "具体问题2"],
  "summary": "一句话总评"
}`

export function buildImageGateUserPrompt(facts: GateFacts, hasReference: boolean): string {
  const lines: string[] = []
  lines.push(`请严格评审这张电影分镜图（第 ${facts.shotIndex + 1} 镜）。`)
  if (hasReference) lines.push(`同时给出一张「参考帧」——它是同一部片子里已通过质检的镜头，用于比对全片一致性。`)
  lines.push('')
  lines.push('【这一镜应当满足的要求】')
  if (facts.sceneAnchor) lines.push(`- 场景锚点：${facts.sceneAnchor}`)
  if (facts.timeOfDay) lines.push(`- 时段（光线应与之相符）：${facts.timeOfDay}`)
  if (facts.characters.length > 0) {
    lines.push(`- 出场人物（外貌必须与锚点一致）：${facts.characters.map((c) => `${c.name}：${c.visualAnchor}`).join('；')}`)
  }
  if (facts.shotSize) lines.push(`- 景别构图：${facts.shotSize}`)
  if (facts.lookBook) lines.push(`- 全片视觉气质（lookBook）：${facts.lookBook}`)
  if (facts.style) lines.push(`- 风格：${facts.style}`)
  lines.push('- 画面必须干净：不得出现任何文字、水印、字幕、logo')
  lines.push('')
  lines.push('【评分口径（0-10）】')
  lines.push('- character：人物外貌与锚点的一致性（无人物则按场景中人物位置合理性给分）')
  lines.push('- scene：环境与场景锚点/时段光线的相符度与细节可信度')
  lines.push('- style：影调质感与全片视觉气质的统一度' + (hasReference ? '（与参考帧比对）' : ''))
  lines.push('- technical：构图、无畸变、无废笔、无文字水印等技术质量')
  lines.push('')
  lines.push('pass = 综合判断这一镜能用（≥7 且无致命问题）；issues 写具体可执行的修改方向。')
  lines.push('')
  lines.push('【输出格式（只输出 JSON 本身）】')
  lines.push(JSON_HINT)
  return lines.join('\n')
}

export const GATE_SYSTEM_PROMPT =
  '你是严格的影视分镜质检员：只依据画面与给定的锚点事实评审，不脑补；用词直接、问题具体。只输出 JSON。'

// ---------- 视频门 prompt（纯函数） ----------

export function buildVideoGateUserPrompt(facts: GateFacts): string {
  const lines: string[] = []
  lines.push('请快审这一镜原生视频：第 1 张是首帧（分镜图），第 2 张是视频中点抽帧。')
  lines.push('')
  lines.push('【严格检查（任一命中即 pass=false 且必须在 issues 指明）】')
  lines.push('1. 水印/文字/logo：任一帧出现即 fail（watermark=true）')
  lines.push('2. 画面损坏：黑帧/花屏/严重 artifacts/中点帧与首帧完全相同且镜头应为动态')
  lines.push('3. 人物突变：中点帧人物外貌与首帧明显不一致（服装/体型/年龄跳变）')
  lines.push('')
  lines.push('【软性评分（只记录不拦截）】')
  lines.push('- technical：画面质量与运动自然度（0-10）')
  lines.push('- character / scene / style：与首帧及锚点的一致性（0-10）')
  if (facts.sceneAnchor) lines.push(`- 场景锚点：${facts.sceneAnchor}`)
  if (facts.characters.length > 0) {
    lines.push(`- 人物锚点：${facts.characters.map((c) => `${c.name}：${c.visualAnchor}`).join('；')}`)
  }
  lines.push('')
  lines.push('【输出格式（只输出 JSON 本身）】')
  lines.push(JSON_HINT)
  return lines.join('\n')
}

// ---------- 变体重抽 prompt（纯函数） ----------

/** 不合格时的变体提示词：问题清单 + 构图/光影重试指令（英文追加——与基底 prompt 同语种） */
export function variantImagePrompt(basePrompt: string, issues: string[], attempt: number): string {
  const issueList = issues.slice(0, 4).map((s) => s.trim()).filter(Boolean)
  const nudges = [
    'Recompose the shot with different placement and camera angle.',
    'Adjust lighting and atmosphere while keeping the same story beat.',
    'Simplify the frame, remove distractions, strengthen the subject.',
  ]
  const nudge = nudges[Math.min(attempt - 1, nudges.length - 1)]!
  const avoid = issueList.length > 0 ? ` MUST avoid these problems from the previous attempt: ${issueList.map((s) => `(${s})`).join(' ')}.` : ''
  return `${basePrompt}${avoid} ${nudge}`
}

// ---------- 择优（纯函数） ----------

export interface GateAttempt {
  imageBase64: string
  mime: string
  verdict: GateVerdict | null // null = 评审不可用（skipped）
}

/** 选取综合分最高的尝试（verdict 为 null 的尝试按「无证据」处理，排在有证据者之后；
 *  全部无证据 → 取最后一次（生成器视角的默认信任），门结果标记 skipped） */
export function pickBestAttempt(attempts: GateAttempt[]): { best: GateAttempt; skipped: boolean } {
  if (attempts.length === 0) throw new Error('pickBestAttempt: 空尝试列表')
  let best = attempts[attempts.length - 1]!
  let bestScore = -1
  for (const a of attempts) {
    const score = a.verdict ? compositeScore(a.verdict) : -1
    if (score > bestScore) {
      bestScore = score
      best = a
    }
  }
  const skipped = attempts.every((a) => a.verdict === null)
  return { best, skipped }
}

/** 是否还应重抽（最后一次尝试有确凿不合格证据 且 预算未用完） */
export function shouldRegenerate(attempts: GateAttempt[]): boolean {
  if (attempts.length > MAX_IMAGE_REGENS) return false
  const last = attempts[attempts.length - 1]
  if (!last?.verdict) return false // 无证据不重抽（可用性优先）
  return !last.verdict.pass || compositeScore(last.verdict) < 7
}

// ---------- 门开关（env 豁免：评估对照 / 紧急关闭） ----------

export function imageGateEnabled(): boolean {
  return process.env.IMAGINEOS_IMAGE_GATE !== '0'
}

export function videoGateEnabled(): boolean {
  return process.env.IMAGINEOS_VIDEO_GATE !== '0'
}

/** 供进度载荷 / Provenance 的门摘要 */
export function gateSummary(outcome: { verdict: GateVerdict | null; skipped: boolean; attempts: number; score: number | null }) {
  return {
    pass: outcome.skipped ? true : (outcome.verdict?.pass ?? true),
    skipped: outcome.skipped,
    score: outcome.skipped ? null : (outcome.score ?? null),
    attempts: outcome.attempts,
    issues: outcome.skipped ? [] : (outcome.verdict?.issues ?? []),
  }
}
