// 缺陷记忆（负向经验复利，收编自 bestshot-compounding-025 设计 §4）
// 定位：把质量门「只写不读」的 Provenance 账本变成读回通道的负向一半——
//   复发性缺陷（历史出现 ≥2 次）→ ① 编剧层中文规避清单（分镜 user prompt）
//                                   ② 执行层英文负面约束（图像 prompt 末段）
// 与正向复利（exemplar-service.topPromptsForTeaching 高分范例 few-shot）合成完整复利闭环。
// 数据源（零 schema 变更）：pipeline-executor 每镜落盘的 Provenance 事件——
//   eventType='ai_generated', model='quality-gate', payload={ stage:'image.gate', shotIndex, pass, skipped, score, attempts, issues }
// 可用性铁律（延续 advisory 纪律）：loadDefectMemory 任何失败 → 空记忆，复利绝不阻断主链路。
// 架构边界（§87）：领域层纯逻辑 + 仓储查询，不绑模型 SDK；翻译映射与 shot-gate 同一套口径。

import { db } from '@/lib/db'

// ---------- 评审记录解析（防御性） ----------

export interface GateReviewRecord {
  shotIndex: number
  pass: boolean
  /** true = 评审缺席（门关闭/抽帧失败）——不构成质量证据，不参与缺陷统计 */
  skipped: boolean
  score: number | null
  issues: string[]
  createdAt: Date
}

/** Provenance 行（只需这三列；payloadJson 内含 image.gate 载荷） */
export interface GateReviewRow {
  payloadJson: string | null
  createdAt: Date
}

/** image.gate 事件 → 评审记录（脏行/缺字段/非本 stage 一律跳过——账本里混有其他 ai_generated 事件） */
export function parseGateReviews(rows: GateReviewRow[]): GateReviewRecord[] {
  const out: GateReviewRecord[] = []
  for (const row of rows) {
    if (!row.payloadJson) continue
    try {
      const p = JSON.parse(row.payloadJson) as {
        stage?: unknown
        shotIndex?: unknown
        pass?: unknown
        skipped?: unknown
        score?: unknown
        issues?: unknown
      }
      if (p.stage !== 'image.gate') continue
      if (typeof p.shotIndex !== 'number' || !Number.isInteger(p.shotIndex) || p.shotIndex < 0) continue
      if (typeof p.pass !== 'boolean') continue
      const skipped = p.skipped === true
      const score = typeof p.score === 'number' && Number.isFinite(p.score) ? p.score : null
      const issues = Array.isArray(p.issues)
        ? p.issues.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 8)
        : []
      out.push({ shotIndex: p.shotIndex, pass: p.pass, skipped, score, issues, createdAt: row.createdAt })
    } catch {
      // 脏 JSON：防御性跳过
    }
  }
  return out
}

// ---------- 缺陷聚合 ----------

export const DEFECT_MEMORY_MIN_COUNT = 2
export const DEFECT_MEMORY_LIMIT = 6

export interface DefectMemoryEntry {
  issue: string
  count: number
}

/** 失败评审的 issues 频次聚合（同一评审内去重；出现 ≥2 次才算复发性缺陷） */
export function aggregateDefectMemory(
  records: GateReviewRecord[],
  opts?: { minCount?: number; limit?: number },
): DefectMemoryEntry[] {
  const minCount = opts?.minCount ?? DEFECT_MEMORY_MIN_COUNT
  const counts = new Map<string, number>()
  for (const r of records) {
    if (r.pass || r.skipped) continue // 只统计「有证据的失败」
    const seen = new Set<string>()
    for (const issue of r.issues) {
      const key = issue.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .map(([issue, count]) => ({ issue, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, opts?.limit ?? DEFECT_MEMORY_LIMIT)
}

// ---------- 注入片段 ----------

/** 编剧层中文规避清单（注入分镜 user prompt；无复发性缺陷 → 空串零注入） */
export function defectMemoryFragment(memory: DefectMemoryEntry[]): string {
  if (memory.length === 0) return ''
  const lines = memory.map((m) => `  - ${m.issue}（历史出现 ${m.count} 次）`)
  return `\n历史高频缺陷规避清单（这些缺陷在过往生成中反复出现——写 imagePrompt 时必须主动规避：不写含文字的招牌/标签/便签，人物外貌严格锚定，环境与光线严格锚定）：\n${lines.join('\n')}`
}

/** issue → 生成侧负面约束子句（与质量门 variantImagePrompt 同口径的翻译映射） */
export function avoidanceClausesFor(issues: string[]): string[] {
  const avoid: string[] = []
  if (issues.some((s) => /文字|水印/.test(s))) avoid.push('absolutely no text, no watermark, no captions, no letters anywhere in the image')
  if (issues.some((s) => /畸形|肢体|多指|扭曲/.test(s))) avoid.push('anatomically correct hands and body, natural proportions, no deformities')
  if (issues.some((s) => /人物/.test(s))) avoid.push('characters must strictly match the described appearance (age, build, hair, clothing)')
  if (issues.some((s) => /场景/.test(s))) avoid.push('environment must strictly match the described scene anchor')
  if (issues.some((s) => /风格|断裂/.test(s))) avoid.push('color grading and lighting must follow the film look description exactly')
  return avoid
}

/** 执行层英文负面约束（逐镜图像 prompt 末尾追加；只注入可翻译类别，无映射的诚实跳过） */
export function learnedAvoidanceFragment(memory: DefectMemoryEntry[]): string {
  const clauses = avoidanceClausesFor(memory.map((m) => m.issue))
  if (clauses.length === 0) return ''
  return ` Studio-learned constraints (recurrent past defects): ${clauses.join('; ')}.`
}

// ---------- 查询服务（读回通道） ----------

export const EMPTY_DEFECT_MEMORY: DefectMemoryEntry[] = []

const REVIEW_SCAN_LIMIT = 400

/**
 * 加载缺陷记忆（storyboard 生成前调用一次）。
 * 铁律：任何失败 → 空记忆（复利缺席不阻断主链路）。
 */
export async function loadDefectMemory(): Promise<DefectMemoryEntry[]> {
  try {
    const rows = await db.provenance.findMany({
      where: { eventType: 'ai_generated', model: 'quality-gate' },
      orderBy: { createdAt: 'desc' },
      take: REVIEW_SCAN_LIMIT,
      select: { payloadJson: true, createdAt: true },
    })
    return aggregateDefectMemory(parseGateReviews(rows))
  } catch (e) {
    console.warn('[defect-memory] 加载失败（不影响主链路）：', e instanceof Error ? e.message : e)
    return EMPTY_DEFECT_MEMORY
  }
}
