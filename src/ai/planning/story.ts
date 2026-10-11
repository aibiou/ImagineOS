// Creative Planner —— Story / Storyboard 生成（Master Brief §19 / T4.2）
// Intent + Concept → 叙述弧/场景 → 分镜（画面/景别/运镜/时长/旁白/情绪）
// 时长预算：Shot 总时长 ≈ Intent.duration（±15%），偏差时线性归一（T4.2.2 AC）
//
// 影视专业性设计（2026-10-08 业务升级）：
//   - Story 层：三幕微结构（hook→setup→turn→climax→release），每场戏有戏剧功能与价值转变；
//     人物小传含欲望/障碍/弧光（叙事引擎）+ 视觉锚点（跨镜一致性原料）
//   - Storyboard 层：景别情绪语法（定场远景→中景叙事→特写递进→大特写高潮）、
//     首 3 秒钩子、旁白节拍（首句钩/末句余韵）、转场语义、节奏曲线（高潮短切/结尾留白）
import { completeJson } from '@/ai/router/llm-json'
import type { ProviderCallContext } from '@/ai/router/types'
import {
  CharacterSheetSchema,
  StorySnapshotSchema,
  type CharacterSheet,
  type CreativeDirection,
  type IntentRecord,
  type ShotSnapshot,
  type StorySnapshot,
} from '@/core/content/schemas'
import { z } from 'zod'
import { storyCraftFragment, storyboardCraftFragment } from '@/ai/planning/craft-library'
import { defectMemoryFragment, type DefectMemoryEntry } from '@/core/quality/defect-memory'

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

// ---------- Story 生成（三幕微结构 + 人物小传 + 场景戏剧功能） ----------

const StoryDraftSchema = StorySnapshotSchema.omit({ scenes: true }).extend({
  scenes: z
    .array(
      z.object({
        index: z.number().int().min(0),
        summary: z.string().min(1),
        location: z.string().optional(),
        /** 场景视觉锚点（英文）：环境+光线+标志性道具的固定描述，同场景所有镜头共用 */
        locationAnchor: z.string().optional(),
        /** 戏剧功能（五选一，全片按 hook→setup→turn→climax→release 顺序演进） */
        dramaticFunction: z.enum(['hook', 'setup', 'turn', 'climax', 'release']),
        /** 价值转变：观众情绪从 X 到 Y */
        valueShift: z.string().min(2).max(24),
        /** 时间（黄昏/深夜/清晨/正午……） */
        timeOfDay: z.string().optional(),
      }),
    )
    .min(2)
    .max(5),
  characters: z.array(CharacterSheetSchema).min(1).max(4),
})

const _STORY_SYSTEM_BASE = `你是 ImagineOS 的故事编剧，受过严格的影视短片训练。把选定的创作方向展开为一条结构扎实、能拍成短视频的故事。

结构（三幕微结构——每一场戏都必须推动故事，没有「只是发生了」的场戏）：
- hook（钩子）：开场 3 秒抓人——悬念、反常或强视觉；观众决定看下去就在这一刻。
- setup（建立）：让观众认识人物、看见他想要什么、什么在阻碍他。
- turn（转折）：处境改变——发现、失去、逆转；故事从这里获得动能。
- climax（高潮）：情感最高点，欲望与障碍正面对撞。
- release（释放）：余韵与落点，给观众带走的东西。
45 秒左右的短片通常 3–5 场戏，按上述顺序演进（可省略 setup 或 turn，hook 和 release 不可省）。

人物（故事的发动机）：
- 每个人物给出：desire（他想要什么）、obstacle（什么在阻碍他）、arc（结尾比开头多了/少了什么）。
- visualAnchor（英文，25 词以内）：年龄/体型/发型/服装/标志性道具的固定外貌描述——所有镜头共用同一人物形象，这是观众认人的锚，必须具体到「褪色的蓝衬衫、花白寸头」这种颗粒度。

世界（影视级全面一致性——观众认地方和认人一样重要）：
- lookBook（英文，≤40词）：全片统一的视觉圣经——色调（如 warm amber tones / cool teal shadows）、光线特质（soft diffused window light / harsh neon）、影调质感（35mm film grain / clean digital）。整部片子只能有一个视觉气质，不许每场戏各自造一套。
- 每场戏的 locationAnchor（英文，≤35词）：该场景的固定视觉锚点——环境细节+光线状态+标志性道具（如深夜面馆：narrow noodle shop, red plastic stools, steam rising from bamboo baskets, single warm tungsten bulb）。同场景所有镜头共用这一份描述；同一地点反复出现时锚点必须一致。

规则：
1. logline：一句话故事（≤50字，具体、有画面感，含欲望与阻碍的张力）。
2. emotionArc：情绪曲线，节拍数 = 场景数，第 i 个节拍对应第 i 场戏的落点情绪。
3. narrationStyle：旁白风格描述（第一人称/第三人称、口语/诗意，≤20字）。
4. scenes：每场含 summary（这场戏发生什么，≤40字）、location、locationAnchor、dramaticFunction、valueShift（如「平静→不安」）、timeOfDay。
5. 为普通人写作：具体、真诚，避免空洞形容词；情绪通过动作与细节呈现，不直接报菜名。`
const STORY_SYSTEM = _STORY_SYSTEM_BASE + storyCraftFragment()
export { STORY_SYSTEM }

const STORY_JSON_HINT = `{
  "logline": "父亲扶了一夏天后座，只为松手那一下。",
  "narrationStyle": "第一人称，克制的口语",
  "emotionArc": ["轻快", "不安", "决然", "释然"],
  "lookBook": "Warm nostalgic summer palette, golden hour tones with soft haze, gentle 35mm film grain, tender naturalistic light, quiet observational framing",
  "characters": [
    {
      "name": "父亲",
      "desire": "让儿子学会骑车",
      "obstacle": "儿子怕摔，他也不忍心松手",
      "arc": "从不敢放手，到站在原地目送",
      "wardrobe": "洗旧的藏蓝衬衫",
      "visualAnchor": "A lean Chinese father in his 40s, short graying hair, faded navy blue shirt with rolled sleeves, weathered hands, warm gentle eyes"
    },
    {
      "name": "我",
      "desire": "学会骑车追上大孩子",
      "obstacle": "怕摔，总回头看父亲在不在",
      "arc": "从回头找父亲，到不敢回头",
      "visualAnchor": "A 10-year-old Chinese boy, buzz cut, white t-shirt with a small red stripe, scraped knees, bright determined eyes"
    }
  ],
  "scenes": [
    { "index": 0, "summary": "夏夜巷口，父亲扶着车后座，我攥着车把不敢蹬", "location": "老巷口", "locationAnchor": "Old residential alley entrance, cracked concrete wall with faded posters, single warm streetlight, parked bicycles, summer evening ambience", "dramaticFunction": "hook", "valueShift": "平静→忐忑", "timeOfDay": "黄昏" },
    { "index": 1, "summary": "一圈又一圈，父亲的手一直没松，我越骑越稳", "location": "巷子", "locationAnchor": "Narrow back alley between old brick houses, dim amber window light spilling onto uneven pavement, laundry lines overhead, quiet summer night", "dramaticFunction": "setup", "valueShift": "忐忑→安心", "timeOfDay": "黄昏" },
    { "index": 2, "summary": "我喊「别松手」，回头才发现父亲早已站在巷口远处", "location": "巷口", "locationAnchor": "Old residential alley entrance, cracked concrete wall with faded posters, single warm streetlight, parked bicycles, summer evening ambience", "dramaticFunction": "turn", "valueShift": "安心→震动", "timeOfDay": "暮色" },
    { "index": 3, "summary": "我没有停，一直骑进晚霞里，父亲在原地看", "location": "长街", "locationAnchor": "Long open residential street stretching toward horizon, silhouetted rooftops, wide glowing sunset sky, distant telephone poles", "dramaticFunction": "release", "valueShift": "震动→释然", "timeOfDay": "晚霞" }
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

请展开故事（三幕微结构 + 人物小传 + 全片视觉圣经与场景锚点 + 情绪节拍与场景一一对应）。`

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
    characters: parsed.characters,
    lookBook: parsed.lookBook,
    scenes: parsed.scenes.map((s) => ({
      index: s.index,
      summary: s.summary,
      location: s.location,
      locationAnchor: s.locationAnchor,
      dramaticFunction: s.dramaticFunction,
      valueShift: s.valueShift,
      timeOfDay: s.timeOfDay,
      shots: [],
    })),
  }
}

// ---------- Storyboard 生成（场景 → 镜头：景别语法 + 钩子 + 节拍 + 转场） ----------

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
              shotSize: z.enum(['extreme_wide', 'wide', 'medium', 'closeup', 'extreme_closeup']),
              cameraMotion: z.enum(['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static']),
              transition: z.enum(['cut', 'dissolve', 'fade']).optional(),
              charactersInShot: z.array(z.string()).default([]),
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

const _STORYBOARD_SYSTEM_BASE = `你是 ImagineOS 的分镜师，受过严格的影视视听语言训练。把故事场景分解为镜头（Shot），每个镜头将成为一张生成的图像 + 一段旁白配音 + 一次运镜（或原生 AI 视频），最终合成短视频。

景别语法（蒙太奇的情绪递进——观众靠景别感知距离与亲密）：
- extreme_wide（大远景）：定场、渺小感、命运感；开场与结尾常用。
- wide（全景）：人物与环境的关系，动作展开。
- medium（中景）：叙事主力，对话与互动。
- closeup（特写）：情绪升温，让观众「看见」感受。
- extreme_closeup（大特写）：高潮顶点，一个细节炸开情绪。
递进原则：相邻镜头景别尽量有变化（跳级剪切出张力）；全片大致遵循「定场宽 → 叙事中 → 情绪特写 → 高潮大特写/快切 → 结尾宽长镜留白」。

节奏（durationMs 是叙事节拍，不是均分）：
- hook 镜头 3–5s，信息要快；高潮镜头短促（3–5s）快切堆情绪；release 镜头放长（7–10s）给余韵。
- 全部镜头总时长 ≈ 目标总时长。

镜头规则：
1. visualDescription：中文画面描述（给用户看，≤40字，具体到光线/构图/人物动作/景别感受）。
2. imagePrompt：英文图像生成提示词。包含：主体（含外貌特征）、动作、环境、光线、色调、构图（与 shotSize 一致）、风格词。与 visualDescription 语义一致。不含文字渲染要求（画面中不出现文字）。人物外貌必须与人物表 visualAnchor 一致——系统会自动追加锚点，你写主体时不要另编外貌；环境与光线必须复用该场景的 locationAnchor 与 timeOfDay——系统也会自动注入，你写环境时不要另编一套场地。
3. shotSize + cameraMotion 组合与情绪配合（回忆涌现→closeup+zoom_in，开阔→wide+pan_right，孤身→extreme_wide+static）。
4. transition：与下一镜的连接方式——cut（硬切，推进节奏，默认）、dissolve（叠化，时间流逝/进入回忆）、fade（黑场，段落终结，仅结尾可用）。末镜之后无转场可省略。
5. charactersInShot：本镜出现的人物名字数组（与人物表 name 完全一致；空场景为空数组）。
6. narrationLine：该镜头的旁白台词（中文口语，≤30字，与画面互补而非重复描述）。节拍规则——第一句必须是钩子（悬念、断言或反常，让观众想听第二句）；最后一句是余韵（回收或留白，不解释满）。相邻镜头台词连起来是完整叙述。
7. 尽量把镜头按叙事节奏分配到各场景（每场景 1–4 镜）；仅当某一段叙事确实不可拆时才允许单场景超过 4 镜。
8. 轴线与动作衔接（剪辑不跳戏）：同一场戏内人物的屏幕方向保持一致（面向左的持续面向左，除非剧情给转身理由）；上一镜人物向画面某侧运动，下一镜延续同方向；两镜动作能接得上（出画→入画、抬手→落下），观众才不会迷失。
9. 全片色调与光线气质遵从故事阶段的 lookBook，不要每镜自创风格。`
const STORYBOARD_SYSTEM = _STORYBOARD_SYSTEM_BASE + storyboardCraftFragment()
export { STORYBOARD_SYSTEM }

const STORYBOARD_JSON_HINT = `{
  "scenes": [
    {
      "index": 0,
      "shots": [
        {
          "index": 0,
          "visualDescription": "大远景：暮色中的老巷口，一大一小两个身影，一辆二八大杠",
          "imagePrompt": "A quiet old alley at dusk seen from far away, a father and a small boy beside a vintage black bicycle, long shadows, warm golden backlight, hazy summer evening, cinematic composition",
          "shotSize": "extreme_wide",
          "cameraMotion": "static",
          "transition": "cut",
          "charactersInShot": ["父亲", "我"],
          "durationMs": 5000,
          "narrationLine": "那年夏天，我只学会了一件事：别回头。",
          "emotion": "忐忑"
        }
      ]
    }
  ]
}`

/** 高分范例教学段（025 战线三，纯函数）：跨项目高分镜头的 imagePrompt 写法 few-shot。
 *  教写法密度（主体动作前置、光线具体、构图词与景别一致、环境锚定），不教内容——
 *  空库零注入（向后兼容：无范例时 prompt 与旧版逐字一致）。 */
export function exemplarTeachingSection(exemplars: Array<{ imagePrompt: string; score: number }>): string {
  if (exemplars.length === 0) return ''
  const lines = exemplars.map((e, i) => {
    const truncated = e.imagePrompt.length > 320 ? `${e.imagePrompt.slice(0, 320)}…` : e.imagePrompt
    return `${i + 1}. ${truncated}（该写法实测质检 ${e.score.toFixed(1)} 分）`
  })
  return `\n\n已验证的高分写法范例——以下是真实图像模型上通过质检并拿过高分的 imagePrompt 片段（学习它们的写法密度：主体与动作前置、光线具体可执行、构图词与景别一致、环境锚定不漂移；理解写法即可，绝不照抄内容）：\n${lines.join('\n')}`
}

export async function generateStoryboard(
  intent: IntentRecord,
  concept: { name: string; oneLiner: string; visualDirection?: string },
  story: StorySnapshot,
  ctx: ProviderCallContext,
  opts?: { exemplarPrompts?: Array<{ imagePrompt: string; score: number }>; defectMemory?: DefectMemoryEntry[] },
): Promise<StorySnapshot> {
  const targetSec = intent.fields.duration ?? 45
  const shotCount = planShotCount(targetSec)
  const f = intent.fields

  const characters: CharacterSheet[] =
    story.characters?.length ? story.characters : (f.characters ?? []).map((c) => ({ name: c.name, description: c.description }))
  const characterBrief = characters
    .map((c) => `${c.name}：${c.description ?? ''}${c.desire ? `｜想要：${c.desire}` : ''}${c.obstacle ? `｜阻碍：${c.obstacle}` : ''}${c.visualAnchor ? `｜视觉锚点：${c.visualAnchor}` : ''}`)
    .join('；')

  const userPrompt = `故事：
- logline：${story.logline}
- 情绪曲线：${story.emotionArc?.join(' → ') ?? '未定'}
- 旁白风格：${story.narrationStyle ?? '第一人称，真诚口语'}
- 人物表（name 必须与 charactersInShot 对齐；imagePrompt 的主体外貌遵循 visualAnchor）：${characterBrief || '无人物表'}
- 场景（戏剧功能 → 镜头要服务它；imagePrompt 的环境与光线遵循各场 locationAnchor 与 timeOfDay）：
${story.scenes.map((s) => `  ${s.index}. ${s.summary}${s.location ? `（${s.location}${s.timeOfDay ? '·' + s.timeOfDay : ''}）` : ''}${s.locationAnchor ? `〔锚点：${s.locationAnchor}〕` : ''}${s.dramaticFunction ? `［${s.dramaticFunction}${s.valueShift ? '：' + s.valueShift : ''}］` : ''}`).join('\n')}
${story.lookBook ? `- 全片视觉圣经（所有镜头的色调与光线气质基准）：${story.lookBook}\n` : ''}创作方向：「${concept.name}」${concept.visualDirection ? `视觉：${concept.visualDirection}` : ''}
视觉风格基底：${f.visual_style ?? 'cinematic_realism'}
总时长目标：约 ${targetSec} 秒，全片约 ${shotCount} 个镜头。

请输出分镜（景别有递进、首镜是钩子、节奏有起伏、旁白成叙述、同场戏环境光线一致、轴线不跳）。${defectMemoryFragment(opts?.defectMemory ?? [])}`

  const parsed = await completeJson(
    StoryboardSchema,
    {
      system: STORYBOARD_SYSTEM + exemplarTeachingSection(opts?.exemplarPrompts ?? []),
      user: userPrompt,
      jsonHint: STORYBOARD_JSON_HINT,
    },
    ctx,
    { temperature: 0.6 },
  )

  // 组装完整 StorySnapshot：场景摘要沿用 Story 阶段，镜头填入（含人物表透传）
  const scenes = parsed.scenes.map((sc) => {
    const original = story.scenes.find((s) => s.index === sc.index)
    const shots: ShotSnapshot[] = sc.shots.map((sh) => ({
      index: sh.index,
      visualDescription: sh.visualDescription,
      imagePrompt: sh.imagePrompt,
      shotSize: sh.shotSize,
      cameraMotion: sh.cameraMotion,
      transition: sh.transition,
      charactersInShot: sh.charactersInShot,
      durationMs: sh.durationMs,
      narrationLine: sh.narrationLine,
      emotion: sh.emotion,
    }))
    return {
      index: sc.index,
      summary: original?.summary,
      location: original?.location,
      locationAnchor: original?.locationAnchor,
      dramaticFunction: original?.dramaticFunction,
      valueShift: original?.valueShift,
      timeOfDay: original?.timeOfDay,
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
