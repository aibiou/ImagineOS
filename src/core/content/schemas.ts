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

/** 景别（蒙太奇情绪语法：大远景定场 → 中景叙事 → 特写递进 → 大特写高潮） */
export const SHOT_SIZES = ['extreme_wide', 'wide', 'medium', 'closeup', 'extreme_closeup'] as const
export type ShotSize = (typeof SHOT_SIZES)[number]

/** 镜头间转场（硬切/叠化/黑场淡入——情绪连接方式） */
export const SHOT_TRANSITIONS = ['cut', 'dissolve', 'fade'] as const
export type ShotTransition = (typeof SHOT_TRANSITIONS)[number]

/** 场景戏剧功能（三幕微结构：每一场戏必须推动故事，不许「只是发生了」） */
export const SCENE_FUNCTIONS = ['hook', 'setup', 'turn', 'climax', 'release'] as const
export type SceneDramaticFunction = (typeof SCENE_FUNCTIONS)[number]

export const ShotSnapshotSchema = z.object({
  index: z.number().int().min(0),
  visualDescription: z.string().optional(),
  /** 面向图像生成的英文提示词（执行配方的一部分，随版本密封） */
  imagePrompt: z.string().optional(),
  cameraMotion: z.string().optional(), // zoom_in | zoom_out | pan_left | pan_right | static
  /** 景别：画面取景范围，驱动构图与情绪递进（可选，向后兼容） */
  shotSize: z.enum(SHOT_SIZES).optional(),
  /** 转场：与下一镜头的连接方式（末镜可缺省） */
  transition: z.enum(SHOT_TRANSITIONS).optional(),
  /** 本镜出现的人物（名字与 CharacterSheet.name 对齐；供执行层注入视觉锚点） */
  charactersInShot: z.array(z.string()).optional(),
  durationMs: z.number().int().positive().optional(),
  narrationLine: z.string().optional(),
  emotion: z.string().optional(),
  /**
   * 镜头运动路径（M1.5 Gate 6 / ADR-0001 修订）：composition = 组合式（图像 + Ken Burns），
   * native = 原生视频（图像首帧 + video.shot 图生视频）。缺省 composition（向后兼容）。
   * 由管线/评估层调度，不由 LLM 决定（模型选择不出现在业务层的纪律）。
   */
  motion: z.enum(['composition', 'native']).optional(),
})
export type ShotSnapshot = z.infer<typeof ShotSnapshotSchema>

/** 人物小传（§86 Character 预留结构的落地）：驱动叙事 + 视觉一致性的双引擎 */
export const CharacterSheetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  /** 服装/造型（中文，给用户看） */
  wardrobe: z.string().optional(),
  /** 这个人物想要什么（欲望——故事的发动机） */
  desire: z.string().optional(),
  /** 什么在阻碍他（障碍——冲突的来源） */
  obstacle: z.string().optional(),
  /** 人物弧光：结尾比开头多了/少了什么（一句话） */
  arc: z.string().optional(),
  /** 英文视觉锚点（年龄/体型/发型/服装/标志性道具——执行层注入每个 imagePrompt，跨镜一致性由代码保证） */
  visualAnchor: z.string().optional(),
})
export type CharacterSheet = z.infer<typeof CharacterSheetSchema>

export const SceneSnapshotSchema = z.object({
  index: z.number().int().min(0),
  summary: z.string().optional(),
  location: z.string().optional(),
  /** 戏剧功能：这场戏为什么存在（hook/setup/turn/climax/release） */
  dramaticFunction: z.enum(SCENE_FUNCTIONS).optional(),
  /** 价值转变：观众情绪从 X 到 Y（「平静→好奇」；无转变的场戏应被删掉） */
  valueShift: z.string().optional(),
  /** 时间（黄昏/深夜/清晨……——光线与情绪的锚） */
  timeOfDay: z.string().optional(),
  shots: z.array(ShotSnapshotSchema).default([]),
})
export type SceneSnapshot = z.infer<typeof SceneSnapshotSchema>

export const StorySnapshotSchema = z.object({
  logline: z.string().optional(),
  narrationStyle: z.string().optional(),
  emotionArc: z.array(z.string()).optional(), // 情绪曲线（节拍数应与场景数对应）
  /** 人物小传（故事阶段产出；密封进版本后供执行层注入视觉锚点） */
  characters: z.array(CharacterSheetSchema).optional(),
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
  characters: z.array(CharacterSheetSchema).default([]),
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
