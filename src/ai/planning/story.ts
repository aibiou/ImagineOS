// Creative Planner —— Story / Storyboard 生成（Master Brief §19 / T4.2）
// Intent + Concept → 叙述弧/场景 → 分镜（画面/运镜/时长/旁白/情绪）
// 时长预算：Shot 总时长 ≈ Intent.duration（±15%），偏差时线性归一（T4.2.2 AC）
import { completeJson } from '@/ai/router/llm-json'
import type { ProviderCallContext } from '@/ai/router/types'
import {
  StorySnapshotSchema,
  type CreativeDirection,
  type IntentRecord,
  type ShotSnapshot,
  type StorySnapshot,
} from '@/core/content/schemas'
import { z } from 'zod'

// ---------- 时长预算（纯函数，T4.2.2） ----------

/** 目标镜头数：3–8 镜，45s → 5 镜左右 */
export function planShotCount(durationSec: number): number {
  const n = Math.round(durationSec / 9)
  return Math.min(8, Math.max(3, n))
}

/** 把 LLM 产出的镜头时长归一到目标总时长（±15% 容差内则不调整） */
export function reconcileShotDurations(shots: ShotSnapshot[], targetSec: number): ShotSnapshot[] {
  if (shots.length === 0) return shots
  const targetMs = targetSec * 1000
  const totalMs = shots.reduce((sum, s) => sum + (s.durationMs ?? 6000), 0)
  if (totalMs <= 0) return shots
  const ratio = totalMs / targetMs
  if (ratio >= 0.85 && ratio <= 1.15) return shots // 容差内
  return shots.map((s) => ({
    ...s,
    durationMs: Math.min(12000, Math.max(3000, Math.round((s.durationMs ?? 6000) / ratio))),
  }))
}

// ---------- Story 生成（叙述弧 + 场景） ----------

const StoryDraftSchema = StorySnapshotSchema.omit({ scenes: true }).extend({
  scenes: z
    .array(
      z.object({
        index: z.number().int().min(0),
        summary: z.string().min(1),
        location: z.string().optional(),
      }),
    )
    .min(2)
    .max(5),
})

const STORY_SYSTEM = `你是 ImagineOS 的故事策划师。把选定的创作方向展开为一条可拍成短视频的故事。

规则：
1. logline：一句话故事（≤50字，具体、有画面感）。
2. emotionArc：情绪曲线，3–5 个节拍，每个节拍一个情绪词（如 ["平静","怀念","涌动","温暖"]）。
3. narrationStyle：旁白风格描述（第一人称/第三人称、口语/诗意，≤20字）。
4. scenes：2–4 个场景，每个含 summary（这个场景发生什么，≤40字）与 location（地点）。
5. 为普通人写作：具体、真诚，避免空洞形容词。`

const STORY_JSON_HINT = `{
  "logline": "string",
  "narrationStyle": "string",
  "emotionArc": ["平静", "怀念", "温暖"],
  "scenes": [
    { "index": 0, "summary": "夏夜巷口，父亲扶着我第一次骑车", "location": "老巷口" }
  ]
}`

export async function generateStoryDraft(
  intent: IntentRecord,
  concept: { name: string; oneLiner: string; emotion?: string; visualDirection?: string },
  ctx: ProviderCallContext,
): Promise<StorySnapshot> {
  const f = intent.fields
  const userPrompt = `创作意图：主题「${f.topic}」${f.duration ? `，约 ${f.duration} 秒` : ''}${f.emotion?.length ? `，期望情绪 ${f.emotion.join('、')}` : ''}${f.characters?.length ? `，人物：${f.characters.map((c) => `${c.name}(${c.description ?? ''})`).join('、')}` : ''}
选定创作方向：「${concept.name}」——${concept.oneLiner}${concept.emotion ? `（情绪：${concept.emotion}）` : ''}${concept.visualDirection ? `（视觉：${concept.visualDirection}）` : ''}

请展开故事。`

  const parsed = await completeJson(
    StoryDraftSchema,
    { system: STORY_SYSTEM, user: userPrompt, jsonHint: STORY_JSON_HINT },
    ctx,
    { temperature: 0.7 },
  )
  return {
    logline: parsed.logline,
    narrationStyle: parsed.narrationStyle,
    emotionArc: parsed.emotionArc,
    scenes: parsed.scenes.map((s) => ({ ...s, shots: [] })),
  }
}

// ---------- Storyboard 生成（场景 → 镜头） ----------

const StoryboardSchema = z.object({
  scenes: z
    .array(
      z.object({
        index: z.number().int().min(0),
        shots: z
          .array(
            z.object({
              index: z.number().int().min(0),
              visualDescription: z.string().min(4),
              imagePrompt: z.string().min(8),
              cameraMotion: z.enum(['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static']),
              durationMs: z.number().int().min(2000).max(15000),
              narrationLine: z.string().optional(),
              emotion: z.string().optional(),
            }),
          )
          .min(1)
          .max(8), // 单场景镜头上限宽松（时长预算驱动总镜头数；LLM 偶尔不拆场景）
      }),
    )
    .min(1),
})

const STORYBOARD_SYSTEM = `你是 ImagineOS 的分镜师。把故事场景分解为镜头（Shot），每个镜头将成为一张生成的图像 + 一段旁白配音 + 一次运镜，最终合成视频。

规则：
1. visualDescription：中文画面描述（给用户看，≤40字，具体到光线/构图/人物动作）。
2. imagePrompt：英文图像生成提示词（给图像模型）。包含：主体、动作、环境、光线、色调、构图、风格词。与 visualDescription 语义一致。不含文字渲染要求（画面中不出现文字）。
3. cameraMotion 从 zoom_in / zoom_out / pan_left / pan_right / static 中选，与情绪配合（回忆涌现→zoom_in，开阔→pan_right）。
4. durationMs：镜头时长（毫秒）。所有镜头总和 ≈ 目标总时长。
5. narrationLine：该镜头的旁白台词（中文口语，≤30字，与画面互补而非重复描述）。有旁白时相邻镜头台词连起来是完整叙述。
6. 同一人物的视觉特征（服装、年龄、发型）在所有 imagePrompt 中保持一致，写进每个提示词。
7. 尽量把镜头按叙事节奏分配到各场景（每场景 1–4 镜）；仅当某一段叙事确实不可拆时才允许单场景超过 4 镜。`

const STORYBOARD_JSON_HINT = `{
  "scenes": [
    {
      "index": 0,
      "shots": [
        {
          "index": 0,
          "visualDescription": "黄昏的老巷口，父亲弯腰扶着自行车后座，孩子坐上车座",
          "imagePrompt": "A father in a faded blue shirt bending down steadying the back of an old bicycle while a child climbs onto the seat, narrow old alley at dusk, warm golden backlight, soft film grain, cinematic composition, gentle nostalgic tone",
          "cameraMotion": "zoom_in",
          "durationMs": 9000,
          "narrationLine": "那年夏天，父亲的手一直没离开过后座。",
          "emotion": "温暖"
        }
      ]
    }
  ]
}`

export async function generateStoryboard(
  intent: IntentRecord,
  concept: { name: string; oneLiner: string; visualDirection?: string },
  story: StorySnapshot,
  ctx: ProviderCallContext,
): Promise<StorySnapshot> {
  const targetSec = intent.fields.duration ?? 45
  const shotCount = planShotCount(targetSec)
  const f = intent.fields

  const userPrompt = `故事：
- logline：${story.logline}
- 情绪曲线：${story.emotionArc?.join(' → ') ?? '未定'}
- 旁白风格：${story.narrationStyle ?? '第一人称，真诚口语'}
- 场景：
${story.scenes.map((s) => `  ${s.index}. ${s.summary}${s.location ? `（${s.location}）` : ''}`).join('\n')}

创作方向：「${concept.name}」${concept.visualDirection ? `视觉：${concept.visualDirection}` : ''}
视觉风格基底：${f.visual_style ?? 'cinematic_realism'}
${f.characters?.length ? `人物（保持视觉特征一致）：${f.characters.map((c) => `${c.name}：${c.description ?? ''}`).join('；')}` : ''}
总时长目标：约 ${targetSec} 秒，全片约 ${shotCount} 个镜头。

请输出分镜。`

  const parsed = await completeJson(
    StoryboardSchema,
    { system: STORYBOARD_SYSTEM, user: userPrompt, jsonHint: STORYBOARD_JSON_HINT },
    ctx,
    { temperature: 0.6 },
  )

  // 组装完整 StorySnapshot：场景摘要沿用 Story 阶段，镜头填入
  const scenes = parsed.scenes.map((sc) => {
    const original = story.scenes.find((s) => s.index === sc.index)
    const shots: ShotSnapshot[] = sc.shots.map((sh) => ({
      index: sh.index,
      visualDescription: sh.visualDescription,
      imagePrompt: sh.imagePrompt,
      cameraMotion: sh.cameraMotion,
      durationMs: sh.durationMs,
      narrationLine: sh.narrationLine,
      emotion: sh.emotion,
    }))
    return {
      index: sc.index,
      summary: original?.summary,
      location: original?.location,
      shots,
    }
  })

  // 时长预算归一（T4.2.2 AC：±15%）
  const allShots = scenes.flatMap((s) => s.shots)
  const reconciled = reconcileShotDurations(allShots, targetSec)
  let cursor = 0
  for (const sc of scenes) {
    sc.shots = reconciled.slice(cursor, cursor + sc.shots.length)
    cursor += sc.shots.length
  }

  return { ...story, scenes }
}
