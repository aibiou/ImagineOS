// ImagineOS M1 种子数据 —— §63 自行车故事全真实链（真实 LLM/图像/TTS/FFmpeg 管线）
// 链路：表达 → 意图 → 方向 → 故事 → 分镜 → AI 生成(图像+配音) → 预览 → 修订 v2「再温暖一点」→ 渲染 → 发布
// 外加：2 件探索作品（预设配方 + 真实生成像素）+ 1 件 Remix（真实再生成）
// 幂等可恢复：按标题查重；Job 持久化使中断后重跑可续（drain 队列）。
// 运行：bun run db:seed（dev 库）—— 需要网络（真实模型调用），耗时约 15 分钟。
import { db } from '../src/lib/db'
import { contentService } from '../src/core/content/content-service'
import { intentService } from '../src/core/intent/intent-service'
import { planService } from '../src/core/planning/plan-service'
import { versionService } from '../src/core/content/version-service'
import { forkService } from '../src/core/content/fork-service'
import { generationFlow } from '../src/core/content/generation-flow'
import { extractIntent } from '../src/ai/intent/engine'
import { generateDirections } from '../src/ai/planning/directions'
import { generateStoryDraft, generateStoryboard } from '../src/ai/planning/story'
import { planRevision } from '../src/ai/revision/locator'
import { runOneTick } from '../workers/generation-worker'
import { parseStructure, type StorySnapshot, type VersionStructure } from '../src/core/content/schemas'

const log = (msg: string) => console.log(`[seed] ${msg}`)
const t0 = Date.now()
function elapsed(): string {
  return `${((Date.now() - t0) / 1000).toFixed(0)}s`
}

async function upsertUser(handle: string, displayName: string, bio: string) {
  const existing = await db.user.findUnique({ where: { handle } })
  if (existing) return existing
  return db.user.create({ data: { handle, displayName, bio, isDemo: true } })
}

/** 排空 Job 队列（阻塞直到无 queued/claimed/running） */
async function drain(label: string): Promise<void> {
  for (;;) {
    const had = await runOneTick()
    if (!had) return
    log(`  [${label}] ${elapsed()} 队列中处理了一个生成任务`)
  }
}

async function reload(contentId: string) {
  return db.content.findUniqueOrThrow({ where: { id: contentId } })
}

async function findWorkByTitle(ownerId: string, title: string) {
  return db.content.findFirst({ where: { ownerId, title } })
}

interface ShotSpec {
  d: string
  img: string
  cam: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'static'
  ms: number
  n?: string
  e?: string
}

function buildStory(shots: ShotSpec[], meta: { logline: string; narrationStyle: string; arc: string[]; scenes: Array<{ summary: string; shotIdx: number[] }> }): StorySnapshot {
  return {
    logline: meta.logline,
    narrationStyle: meta.narrationStyle,
    emotionArc: meta.arc,
    scenes: meta.scenes.map((sc, i) => ({
      index: i,
      summary: sc.summary,
      shots: sc.shotIdx.map((idx) => {
        const s = shots[idx]!
        return {
          index: idx,
          visualDescription: s.d,
          imagePrompt: s.img,
          cameraMotion: s.cam,
          durationMs: s.ms,
          narrationLine: s.n,
          emotion: s.e,
        }
      }),
    })),
  }
}

// ---------- 作品规格 ----------

interface WorkSpec {
  ownerHandle: string
  ownerName: string
  ownerBio: string
  title: string
  expression: string
  /** 完整真实链（LLM 全程参与）；false = 预设配方 + 真实生成像素 */
  fullChain: boolean
  preset?: { concept: { directionId: string; name: string; oneLiner: string; emotion?: string; visualDirection?: string }; story: StorySnapshot }
  /** 预设配方的备选方向（DirectionsPayloadSchema 要求 ≥2 个方向，模拟真实「多选一」） */
  altDirection?: { name: string; oneLiner: string; emotion?: string; visualDirection?: string }
  /** 发布后接受的修订（§63：再温暖一点） */
  revision?: { feedback: string }
  publish: boolean
  likes: number
}

const WORKS: WorkSpec[] = [
  {
    ownerHandle: 'linxiaoman',
    ownerName: '林小满',
    ownerBio: '想把童年装进 45 秒里的人。',
    title: '父亲与那辆二八大杠',
    expression: '我想做一个 45 秒的视频，记录我小时候和父亲一起骑自行车的记忆。要有夏天的感觉，温暖一点。',
    fullChain: true,
    revision: { feedback: '再温暖一点，结尾加上母亲在门口招手。' },
    publish: true,
    likes: 12,
  },
  {
    ownerHandle: 'ache',
    ownerName: '阿澈',
    ownerBio: '每晚都做梦，早上决定把它们画下来。',
    title: '昨晚的梦，水彩一样',
    expression: '把我昨晚的梦拍成一支水彩风格的短片。',
    fullChain: false,
    altDirection: {
      name: '清醒的边界',
      oneLiner: '梦与醒之间有一条模糊的岸，我们每晚都在涨潮时离开它。',
      emotion: '冷静、克制',
      visualDirection: '冷调蓝灰、锐利线条、超现实构图',
    },
    preset: {
      concept: {
        directionId: 'd1',
        name: '水彩的边界',
        oneLiner: '梦没有边界，水彩也一样——颜色自己会找到去处。',
        emotion: '轻盈、恍惚',
        visualDirection: '水彩晕染、留白呼吸感、淡彩过渡',
      },
      story: buildStory(
        [
          {
            d: '淡蓝的水彩在纸面上晕开，浮现出一扇半开的门',
            img: 'Soft watercolor painting of a half-open door emerging from a wash of pale blue ink bleeding on wet paper, dreamy soft edges, gentle light, lots of white space, delicate color transitions, no text',
            cam: 'zoom_in', ms: 7000, n: '梦的开始，总是一扇没关紧的门。', e: '恍惚',
          },
          {
            d: '一个背着黄色气球的小人，走进漂浮着纸鹤的街道',
            img: 'Watercolor illustration of a tiny figure carrying a yellow balloon walking down a floating street with origami paper cranes drifting in the air, soft pastel palette, dreamlike atmosphere, wet-on-wet watercolor technique, no text',
            cam: 'pan_right', ms: 8000, n: '我带着一只气球，去找昨晚没做完的梦。', e: '轻盈',
          },
          {
            d: '屋顶上的猫回头看，尾巴扫出一道颜料痕迹',
            img: 'A cat sitting on a rooftile looking back over its shoulder, its tail sweeping a trail of watercolor pigment across the sky, whimsical watercolor style, warm afternoon tones, soft brush strokes, no text',
            cam: 'zoom_out', ms: 7000, n: '猫记得所有我忘记的事。', e: '温柔',
          },
          {
            d: '雨水倒流回云里，颜色一点点收回画笔',
            img: 'Dreamy watercolor scene of rain drops flowing upward back into soft clouds, colors being drawn back into an invisible brush, ethereal and poetic, fading pastel washes, generous white space, no text',
            cam: 'static', ms: 8000, n: '醒来之前，一切温柔地收场。', e: '释然',
          },
        ],
        {
          logline: '一个关于「梦如何醒来」的水彩小品：门、气球、猫与倒流的雨。',
          narrationStyle: '第一人称，轻声、留白多',
          arc: ['恍惚', '轻盈', '温柔', '释然'],
          scenes: [
            { summary: '梦的门开了', shotIdx: [0] },
            { summary: '梦中的漫游', shotIdx: [1, 2] },
            { summary: '温柔地醒来', shotIdx: [3] },
          ],
        },
      ),
    },
    publish: true,
    likes: 9,
  },
  {
    ownerHandle: 'nanxing',
    ownerName: '南星',
    ownerBio: '给小朋友解释世界的人。',
    title: '天空为什么是蓝色的',
    expression: '给小朋友解释：为什么天空是蓝色的？要好玩一点，35 秒。',
    fullChain: false,
    altDirection: {
      name: '空气里的小蓝人',
      oneLiner: '空气里住着一群看不见的小蓝人，阳光一碰他们就变蓝。',
      emotion: '活泼、热闹',
      visualDirection: '粘土定格动画质感、圆润造型、高饱和撞色',
    },
    preset: {
      concept: {
        directionId: 'd1',
        name: '阳光的乐队',
        oneLiner: '把太阳光想成一支乐队，蓝色是唱得最欢的那位。',
        emotion: '好奇、明亮',
        visualDirection: '明快插画、大色块、童心构图',
      },
      story: buildStory(
        [
          {
            d: '一个孩子趴在草地上仰头看天，手里的放大镜对着阳光',
            img: 'A cheerful child lying on green grass looking up at a bright blue sky, holding a magnifying glass toward the sun, playful flat illustration style, bold colors, big shapes, kid-friendly art, no text',
            cam: 'zoom_in', ms: 7000, n: '你有没有想过，天空为什么是蓝色的？', e: '好奇',
          },
          {
            d: '一束白光穿过三棱镜，在墙上散成七彩的光带',
            img: 'A beam of white light passing through a glass prism and splitting into a rainbow spectrum on a white wall, bright educational illustration, clean shapes, vivid colors, childlike wonder, no text',
            cam: 'pan_left', ms: 8000, n: '其实，阳光里藏着一整个乐队：红橙黄绿蓝靛紫。', e: '明亮',
          },
          {
            d: '蓝色的小音符在空气中蹦得最高，撞到看不见的小颗粒',
            img: 'Cute illustration of small blue musical notes bouncing higher than red and yellow notes, colliding with tiny invisible particles in the air, playful physics metaphor for kids, bright flat design, no text',
            cam: 'zoom_in', ms: 9000, n: '蓝色是个跳得最欢的小家伙，一撞到空气里的小颗粒，就散满了整个天空。', e: '欢快',
          },
          {
            d: '孩子躺在傍晚的草地上，天空慢慢变成橘红色',
            img: 'The same child lying on grass at dusk, the sky slowly turning orange and red, warm sunset gradient, soft illustration style, peaceful ending scene, no text',
            cam: 'zoom_out', ms: 8000, n: '到了傍晚，光要走更远的路，蓝色散完了，就轮到红色出场啦。', e: '满足',
          },
        ],
        {
          logline: '用一支「阳光乐队」，给孩子讲明白瑞利散射。',
          narrationStyle: '说给 6 岁小朋友听的语气，亲切、有节奏',
          arc: ['好奇', '明亮', '欢快', '满足'],
          scenes: [
            { summary: '提出问题', shotIdx: [0] },
            { summary: '光的乐队', shotIdx: [1, 2] },
            { summary: '傍晚的答案', shotIdx: [3] },
          ],
        },
      ),
    },
    publish: true,
    likes: 15,
  },
]

// ---------- 各阶段推进 ----------

async function ensureIntent(contentId: string, ownerId: string, spec: WorkSpec) {
  const raw = await intentService.requireRawExpression(contentId)
  const extraction = await extractIntent({ rawExpression: raw }, { contentId, purpose: 'intent.extract', actorId: ownerId })
  await intentService.saveExtracted(contentId, extraction.record, {
    degraded: extraction.degraded,
    actorId: ownerId,
  })
  await contentService.advanceStatus(contentId, 'INTENT', ownerId)
  log(`  意图就绪（${elapsed()}${extraction.degraded ? '，降级路径' : ''}）`)
}

async function ensureDirection(contentId: string, ownerId: string, spec: WorkSpec) {
  if (spec.fullChain) {
    const record = await intentService.requireRecord(contentId)
    const directions = await generateDirections(record, { contentId, purpose: 'directions.generate', actorId: ownerId })
    await planService.saveDirections(contentId, directions, ownerId)
    await planService.selectDirection(contentId, directions[0]!.id, ownerId)
    log(`  方向已选：「${directions[0]!.name}」（${directions.length} 选 1，${elapsed()}）`)
  } else {
    const concept = spec.preset!.concept
    const alt = spec.altDirection ?? {
      name: '另一个方向',
      oneLiner: '如果换个说法，这个故事也可以这样讲。',
    }
    await planService.saveDirections(contentId, [
      {
        id: concept.directionId,
        name: concept.name,
        oneLiner: concept.oneLiner,
        emotion: concept.emotion,
        visualDirection: concept.visualDirection,
        expectedDurationSec: 32,
      },
      {
        id: 'alt',
        name: alt.name,
        oneLiner: alt.oneLiner,
        emotion: alt.emotion,
        visualDirection: alt.visualDirection,
        expectedDurationSec: 32,
      },
    ], ownerId)
    await planService.selectDirection(contentId, concept.directionId, ownerId)
    log(`  方向已选（预设）：「${concept.name}」（2 选 1）`)
  }
}

async function ensureStory(contentId: string, ownerId: string, spec: WorkSpec) {
  if (spec.fullChain) {
    const record = await intentService.requireRecord(contentId)
    const concept = await planService.requireConcept(contentId)
    const story = await generateStoryDraft(record, concept, { contentId, purpose: 'story.generate', actorId: ownerId })
    await planService.saveStoryDraft(contentId, story, ownerId)
    const storyboard = await generateStoryboard(record, concept, story, { contentId, purpose: 'storyboard.generate', actorId: ownerId })
    await planService.saveStoryboard(contentId, storyboard, ownerId)
    const shotCount = storyboard.scenes.reduce((n, s) => n + s.shots.length, 0)
    log(`  故事+分镜（真实生成）：${storyboard.scenes.length} 场景 · ${shotCount} 镜头（${elapsed()}）`)
  } else {
    await planService.saveStoryDraft(contentId, spec.preset!.story, ownerId)
    await planService.saveStoryboard(contentId, spec.preset!.story, ownerId)
    const shotCount = spec.preset!.story.scenes.reduce((n, s) => n + s.shots.length, 0)
    log(`  分镜（预设配方）：${shotCount} 镜头`)
  }
}

async function ensureGeneratedToReview(contentId: string, ownerId: string, label: string) {
  const active = await db.generationJob.findFirst({
    where: { contentId, status: { in: ['queued', 'claimed', 'running'] } },
  })
  if (active) {
    log(`  ${label}：发现未完成的生成任务，续跑（${elapsed()}）`)
    await drain(label)
    return
  }
  // Remix 副本（READY/REVIEW，已继承配方）走同版本重跑；原生流程从 STORYBOARD 首次生成
  const content = await reload(contentId)
  if (content.status === 'READY' || content.status === 'REVIEW') {
    await generationFlow.regenerate(contentId, ownerId)
    log(`  ${label}：再创作任务已入队（沿用配方重新生成，${elapsed()}）`)
  } else {
    const { versionNumber } = await generationFlow.startStoryboardGeneration(contentId, ownerId)
    log(`  ${label}：生成任务已入队（第 ${versionNumber} 版配方，${elapsed()}）`)
  }
  await drain(label)
}

async function ensureRendered(contentId: string, ownerId: string, label: string) {
  const content = await reload(contentId)
  if (content.status === 'READY' || content.status === 'PUBLISHED') {
    // 已有成片？确认 final 资产存在
    const versionId = content.currentVersionId
    if (versionId) {
      const renderJob = await db.generationJob.findFirst({
        where: { contentId, versionId, type: 'video.render', status: 'succeeded' },
      })
      if (renderJob) return
    }
  }
  const active = await db.generationJob.findFirst({
    where: { contentId, status: { in: ['queued', 'claimed', 'running'] } },
  })
  if (!active) {
    await generationFlow.startRender(contentId, ownerId)
    log(`  ${label}：渲染任务已入队（${elapsed()}）`)
  }
  await drain(label)
}

async function applyRevisionStep(contentId: string, ownerId: string, feedback: string, label: string) {
  const version = await versionService.getCurrentVersion(contentId)
  if (!version) throw new Error('修订前找不到当前版本')
  const structure = parseStructure(version.structureJson)
  const outcome = await planRevision(feedback, structure, { contentId, versionId: version.id, purpose: 'revision.locate', actorId: ownerId })
  log(`  修订定位：「${outcome.plan.summary}」（${outcome.plan.targetLevel} 层，影响镜头 ${outcome.plan.affectedShotIndexes.map((i) => i + 1).join('、')}，${elapsed()}）`)
  await generationFlow.applyRevision(contentId, ownerId, { structure: outcome.structure, changelog: feedback })
  await drain(label)
  await ensureRendered(contentId, ownerId, label)
}

async function ensureWork(spec: WorkSpec): Promise<string> {
  const owner = await upsertUser(spec.ownerHandle, spec.ownerName, spec.ownerBio)
  let content = await findWorkByTitle(owner.id, spec.title)

  if (!content) {
    const created = await contentService.startCreation({ ownerId: owner.id, text: spec.expression })
    await contentService.setMetadata(created.id, owner.id, { title: spec.title })
    content = await reload(created.id)
    log(`《${spec.title}》已创建（${elapsed()}）`)
  } else {
    log(`《${spec.title}》已存在，从 ${content.status} 继续（${elapsed()}）`)
  }

  // 幂等状态机行走
  for (let guard = 0; guard < 40; guard++) {
    const current = await reload(content.id)
    const id = current.id
    switch (current.status) {
      case 'IDEA':
        await ensureIntent(id, owner.id, spec)
        break
      case 'INTENT':
        await ensureDirection(id, owner.id, spec)
        break
      case 'PLANNING':
        await ensureStory(id, owner.id, spec)
        break
      case 'STORY':
        // 中断恢复：直接补分镜
        await planService.saveStoryboard(id, spec.fullChain
          ? (await planService.getWorkingStory(id)) ?? { scenes: [] }
          : spec.preset!.story, owner.id)
        break
      case 'STORYBOARD':
        await ensureGeneratedToReview(id, owner.id, spec.title)
        break
      case 'GENERATING':
        await drain(spec.title)
        break
      case 'REVIEW': {
        // §63 修订：v2「再温暖一点」
        const versionCount = await db.contentVersion.count({ where: { contentId: id } })
        if (spec.revision && versionCount < 2) {
          await applyRevisionStep(id, owner.id, spec.revision.feedback, `${spec.title}·修订`)
        } else {
          await ensureRendered(id, owner.id, spec.title)
        }
        break
      }
      case 'RENDERING':
        await drain(spec.title)
        break
      case 'READY':
        if (spec.publish) {
          await contentService.publishMinimal(id, owner.id, { visibility: 'public' })
          log(`《${spec.title}》已发布（${elapsed()}）`)
        } else {
          return id
        }
        break
      case 'PUBLISHED':
        return id
      default:
        return id
    }
  }
  throw new Error(`《${spec.title}》状态机行走超限（疑似循环）`)
}

async function ensureRemix(sourceContentId: string, remixerHandle: string, remixerName: string, remixerBio: string): Promise<void> {
  const remixer = await upsertUser(remixerHandle, remixerName, remixerBio)
  const source = await reload(sourceContentId)
  const remixTitle = `${source.title} · Remix`
  const existing = await findWorkByTitle(remixer.id, remixTitle)
  if (existing?.status === 'PUBLISHED') {
    log(`Remix《${remixTitle}》已完成，跳过`)
    return
  }
  let remixId = existing?.id
  if (!remixId) {
    const fork = await forkService.forkContent({ sourceContentId, newOwnerId: remixer.id })
    remixId = fork.content.id
    await contentService.setMetadata(remixId, remixer.id, { title: remixTitle })
    log(`Remix 已创建：《${remixTitle}》（${elapsed()}）`)
  }
  // 生成自己的版本（像素重新创作）
  await ensureGeneratedToReview(remixId, remixer.id, remixTitle)
  await ensureRendered(remixId, remixer.id, remixTitle)
  const c = await reload(remixId)
  if (c.status === 'READY') {
    await contentService.publishMinimal(remixId, remixer.id, { visibility: 'public' })
    log(`Remix《${remixTitle}》已发布（${elapsed()}）`)
  }
}

async function addLikes(workIds: string[], likeTarget: Record<string, number>) {
  for (const contentId of workIds) {
    const content = await reload(contentId)
    const target = likeTarget[contentId] ?? 0
    const likers = await db.user.findMany({ take: target, orderBy: { createdAt: 'asc' } })
    for (const liker of likers) {
      if (liker.id === content.ownerId) continue
      await db.contentInteraction.upsert({
        where: { userId_contentId_type: { userId: liker.id, contentId, type: 'like' } },
        create: { userId: liker.id, contentId, type: 'like' },
        update: {},
      })
    }
  }
}

async function main() {
  log('M1 真实管线种子启动（LLM + 图像 + TTS + FFmpeg 全真）')
  const done: string[] = []
  for (const spec of WORKS) {
    const id = await ensureWork(spec)
    done.push(id)
  }

  // Remix 回环：阿澈 从「父亲与那辆二八大杠」开始自己的版本
  const bicycleId = done[0]!
  await ensureRemix(bicycleId, 'ache', '阿澈', '每晚都做梦，早上决定把它们画下来。')

  const likeMap: Record<string, number> = {}
  WORKS.forEach((w, i) => { if (done[i]) likeMap[done[i]!] = w.likes })
  await addLikes(done, likeMap)

  const published = await db.content.count({ where: { visibility: 'public', status: 'PUBLISHED' } })
  const assets = await db.asset.count()
  log(`完成（${elapsed()}）：公开作品 ${published} 件 · 资产 ${assets} 件`)
  log('§63 链路已真实铺陈：表达 → 意图 → 方向 → 故事 → 分镜 → 生成 → 预览 → 修订 v2 → 发布 → Remix')
}

main()
  .catch((e) => {
    console.error('[seed] 失败：', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
