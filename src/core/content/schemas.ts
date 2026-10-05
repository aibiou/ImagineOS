// 领域 Schema（Zod）——结构化、可验证、可版本化（§17 要求）
// 说明：SQLite 无原生 Json，结构化字段以 JSON 字符串入库，出入口一律过本文件校验。

import { z } from 'zod'

// ---------- Intent（§14–§17） ----------

export const INTENT_FIELD_SOURCE_VALUES = ['user', 'ai_default'] as const
export const IntentFieldSource = z.enum(INTENT_FIELD_SOURCE_VALUES)
export type IntentFieldSource = z.infer<typeof IntentFieldSource>

/** 字段名 → 来源（不变量 I5：哪些是用户明确指定、哪些是 AI 默认） */
export const IntentSourcesSchema = z.record(z.string(), IntentFieldSource)

/** §17 示例的结构化落地（字段可由工程团队继续完善） */
export const IntentFieldsSchema = z.object({
  topic: z.string().min(1),
  purpose: z.string().optional(),
  emotion: z.array(z.string()).optional(),
  audience: z.string().optional(),
  tone: z.string().optional(),
  format: z.string().optional(), // short_film | vlog | documentary | ...
  duration: z.number().positive().optional(), // 秒
  visual_style: z.string().optional(),
  narration: z.boolean().optional(),
  creator_on_camera: z.boolean().optional(),
  characters: z.array(z.object({ name: z.string(), description: z.string().optional() })).optional(),
  references: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
})
export type IntentFields = z.infer<typeof IntentFieldsSchema>

export const IntentRecordSchema = z.object({
  fields: IntentFieldsSchema,
  sources: IntentSourcesSchema.default({}),
  /** Intent Interview 状态（§15）：已问/未问/答案 */
  interview: z
    .object({
      asked: z.array(z.string()).default([]),
      remainingBudget: z.number().int().min(0).default(5),
      done: z.boolean().default(false),
    })
    .optional(),
})
export type IntentRecord = z.infer<typeof IntentRecordSchema>

// ---------- 创作结构快照（ContentVersion.structureJson 的值域） ----------

export const ShotSnapshotSchema = z.object({
  index: z.number().int().min(0),
  visualDescription: z.string().optional(),
  cameraMotion: z.string().optional(), // 推/拉/摇/移/跟/固定
  durationMs: z.number().int().positive().optional(),
  narrationLine: z.string().optional(),
  emotion: z.string().optional(),
})
export type ShotSnapshot = z.infer<typeof ShotSnapshotSchema>

export const SceneSnapshotSchema = z.object({
  index: z.number().int().min(0),
  summary: z.string().optional(),
  location: z.string().optional(),
  shots: z.array(ShotSnapshotSchema).default([]),
})
export type SceneSnapshot = z.infer<typeof SceneSnapshotSchema>

export const StorySnapshotSchema = z.object({
  logline: z.string().optional(),
  narrationStyle: z.string().optional(),
  emotionArc: z.array(z.string()).optional(), // 情绪曲线
  scenes: z.array(SceneSnapshotSchema).default([]),
})
export type StorySnapshot = z.infer<typeof StorySnapshotSchema>

/** Creative Direction（§18）：每个方向至少包括名称/一句话概念/情绪/视觉方向/预计时长 */
export const CreativeDirectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  oneLiner: z.string().min(1),
  emotion: z.string().optional(),
  visualDirection: z.string().optional(),
  expectedDurationSec: z.number().positive().optional(),
})
export type CreativeDirection = z.infer<typeof CreativeDirectionSchema>

/**
 * 版本密封快照——"配方"（§21 Content Object 的可继续创造部分）
 * Character / World 为预留结构（§86：为 World 留接口，不建摩天大楼）
 */
export const VersionStructureSchema = z.object({
  intentSummary: z.string().optional(),
  concept: z
    .object({
      directionId: z.string().optional(),
      name: z.string().optional(),
      oneLiner: z.string().optional(),
      emotion: z.string().optional(),
      visualDirection: z.string().optional(),
    })
    .optional(),
  story: StorySnapshotSchema.optional(),
  characters: z
    .array(z.object({ name: z.string(), description: z.string().optional(), wardrobe: z.string().optional() }))
    .default([]),
  world: z.object({ name: z.string().optional(), description: z.string().optional() }).optional(),
  style: z.string().optional(),
  audio: z.object({ narration: z.boolean().optional(), musicMood: z.string().optional() }).optional(),
})
export type VersionStructure = z.infer<typeof VersionStructureSchema>
/** 构造侧类型（可选字段宽松，服务入参用） */
export type VersionStructureInput = z.input<typeof VersionStructureSchema>

export const VERSION_CREATION_METHODS = ['initial', 'revision', 'restore', 'remix', 'regenerate'] as const
export const VersionCreationMethodSchema = z.enum(VERSION_CREATION_METHODS)
export type VersionCreationMethod = z.infer<typeof VersionCreationMethodSchema>

// ---------- API 入参 ----------

export const StartCreationInputSchema = z.object({
  text: z.string().trim().min(1, '想说点什么？').max(2000, '表达太长了，先浓缩到 2000 字以内'),
})
export type StartCreationInput = z.infer<typeof StartCreationInputSchema>

export const CreateVersionInputSchema = z.object({
  method: z.enum(['initial', 'revision', 'regenerate']).default('revision'),
  changelog: z.string().trim().max(500).optional(),
  structure: VersionStructureSchema.optional(),
  title: z.string().trim().max(120).optional(),
})
export type CreateVersionInput = z.infer<typeof CreateVersionInputSchema>

export const AdvanceStatusInputSchema = z.object({
  to: z.string().trim().min(1),
})

export const PublishInputSchema = z.object({
  visibility: z.enum(['private', 'unlisted', 'public']).default('public'),
  description: z.string().trim().max(1000).optional(),
})

// ---------- 工具 ----------

export function parseStructure(json: string | null | undefined): VersionStructure {
  if (!json) return VersionStructureSchema.parse({})
  return VersionStructureSchema.parse(JSON.parse(json))
}

export function serializeStructure(structure: VersionStructureInput): string {
  return JSON.stringify(VersionStructureSchema.parse(structure))
}
