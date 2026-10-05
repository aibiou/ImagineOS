// ImagineOS 种子数据 —— 走真实服务路径（状态机/版本/Remix/溯源全部经过领域层）
// 幂等：检测到演示用户即跳过
// 运行：bun run db:seed（dev 库）/ bun run db:seed:test（测试库）
import { db } from '../src/lib/db'
import { contentService } from '../src/core/content/content-service'
import { versionService } from '../src/core/content/version-service'
import { forkService } from '../src/core/content/fork-service'
import type { VersionStructure } from '../src/core/content/schemas'

async function upsertUser(handle: string, displayName: string, bio: string) {
  const existing = await db.user.findUnique({ where: { handle } })
  if (existing) return existing
  return db.user.create({ data: { handle, displayName, bio, isDemo: true } })
}

const PIPELINE = ['INTENT', 'PLANNING', 'STORY', 'STORYBOARD', 'GENERATING', 'REVIEW', 'RENDERING', 'READY'] as const

async function walkToReady(contentId: string, ownerId: string) {
  for (const to of PIPELINE) {
    await contentService.advanceStatus(contentId, to, ownerId)
  }
}

function shots(list: Array<{ d: string; cam: string; ms: number; n: string; e: string }>) {
  return list.map((s, i) => ({
    index: i,
    visualDescription: s.d,
    cameraMotion: s.cam,
    durationMs: s.ms,
    narrationLine: s.n,
    emotion: s.e,
  }))
}

// §63 主链样例：自行车故事
const bicycleV1: VersionStructure = {
  intentSummary: '记录童年与父亲一起骑自行车的记忆，约45秒温暖短片，真实口吻，大众观众。',
  concept: {
    directionId: 'dir-b',
    name: '夏日骑行 · 人生片段',
    oneLiner: '父亲的自行车后座，是童年最安稳的地方。',
    emotion: '温暖、怀念',
    visualDirection: 'cinematic_realism · 柔和自然光 · 旧照片质感',
  },
  story: {
    logline: '长大的孩子回望那个夏天：清晨出发、田野并肩、黄昏归家，一切都装在父亲的自行车上。',
    narrationStyle: '第一人称低语旁白，克制而真诚',
    emotionArc: ['平静', '愉悦', '怀念', '温暖'],
    scenes: [
      {
        index: 0,
        summary: '清晨出发',
        location: '老巷口',
        shots: shots([
          { d: '晨光斜切进老巷，尘埃在光柱里浮动', cam: '固定', ms: 4000, n: '那年夏天，我七岁。', e: '平静' },
          { d: '父亲推出那辆二八大杠，车铃斑驳', cam: '缓推', ms: 5000, n: '父亲说：坐稳了。', e: '愉悦' },
        ]),
      },
      {
        index: 1,
        summary: '田野并肩',
        location: '田埂小路',
        shots: shots([
          { d: '麦浪起伏，两大一小两道车辙并行', cam: '侧面跟随', ms: 8000, n: '风从麦田那头吹过来。', e: '愉悦' },
          { d: '父亲回头确认身后的孩子，笑容被风吹开', cam: '固定', ms: 6000, n: '他总回头，怕我掉队。', e: '怀念' },
        ]),
      },
      {
        index: 2,
        summary: '黄昏归家',
        location: '村口土路',
        shots: shots([
          { d: '夕阳把两个剪影拉得很长，车轮缓慢', cam: '远固定', ms: 7000, n: '后来的路，我一个人骑了很久。', e: '怀念' },
          { d: '老屋门口，车灯熄灭，饭香透出', cam: '缓拉', ms: 5000, n: '现在我只想回到那个黄昏。', e: '温暖' },
        ]),
      },
    ],
  },
  characters: [
    { name: '父亲', description: '沉默温和的中年男人，旧衬衫，骑二八大杠', wardrobe: '洗旧的蓝格子衬衫' },
    { name: '我', description: '七岁孩子，坐在后座，红色书包', wardrobe: '白背心、红书包' },
  ],
  style: 'cinematic_realism',
  audio: { narration: true, musicMood: 'warm acoustic guitar' },
}

// §63 修订："再温暖一点。" → v2
const bicycleV2: VersionStructure = {
  ...bicycleV1,
  concept: { ...bicycleV1.concept, emotion: '温暖、明亮', visualDirection: 'cinematic_realism · 黄金时刻暖调 · 更柔的高光' },
  story: {
    ...bicycleV1.story!,
    emotionArc: ['平静', '愉悦', '怀念', '明亮温暖'],
    scenes: [
      ...bicycleV1.story!.scenes.slice(0, 2),
      {
        index: 2,
        summary: '黄昏归家（更暖）',
        location: '村口土路',
        shots: shots([
          { d: '夕阳更暖，逆光里两道剪影并肩骑行', cam: '远固定', ms: 7000, n: '后来的路，我一个人骑了很久。', e: '怀念' },
          { d: '母亲系着围裙在门口招手，炊烟升起', cam: '缓拉', ms: 6000, n: '饭菜好了，回家。', e: '明亮温暖' },
          { d: '父亲的自行车靠在墙边，车铃闪着最后一缕光', cam: '特写', ms: 4000, n: '那个夏天，我记了一辈子。', e: '温暖' },
        ]),
      },
    ],
  },
}

function simpleStructure(opts: {
  intentSummary: string
  name: string
  oneLiner: string
  emotion: string
  visual: string
  logline: string
  sceneShots: Array<{ d: string; cam: string; ms: number; n: string; e: string }>
  style: string
  music: string
}): VersionStructure {
  return {
    intentSummary: opts.intentSummary,
    concept: { name: opts.name, oneLiner: opts.oneLiner, emotion: opts.emotion, visualDirection: opts.visual },
    story: {
      logline: opts.logline,
      narrationStyle: '口播旁白',
      emotionArc: ['好奇', '投入', '顿悟'],
      scenes: [{ index: 0, summary: '主线', shots: shots(opts.sceneShots) }],
    },
    characters: [],
    style: opts.style,
    audio: { narration: true, musicMood: opts.music },
  }
}

async function main() {
  const demoCount = await db.user.count({ where: { isDemo: true } })
  if (demoCount > 0) {
    console.log(`[seed] 已存在 ${demoCount} 位演示用户，跳过。`)
    return
  }

  const lin = await upsertUser('lin-yiye', '林一叶', '在路上的生活记录者。相信普通日子值得被认真讲述。')
  const chen = await upsertUser('chen-shiguang', '陈拾光', '把知识拍成故事的人。复杂的事，简单地说。')
  const he = await upsertUser('a-he', '阿禾', '记录梦与情绪的碎片。')

  // ---------- §63 主链样例：自行车故事 ----------
  const bicycle = await contentService.startCreation({
    ownerId: lin.id,
    text: '我想做一个45秒的视频，记录我小时候和父亲一起骑自行车。',
  })
  await walkToReady(bicycle.id, lin.id)
  await versionService.createVersion(bicycle.id, lin.id, { method: 'initial', structure: bicycleV1, changelog: '初版：三幕结构，克制怀旧调' })
  await versionService.createVersion(bicycle.id, lin.id, { method: 'revision', structure: bicycleV2, changelog: '再温暖一点：结尾加入母亲与炊烟，色调转黄金时刻' })
  await contentService.publishMinimal(bicycle.id, lin.id, {
    visibility: 'public',
    description: '父亲的自行车后座，是童年最安稳的地方。AI 协同创作短片。',
  })

  // ---------- 探索作品 ----------
  const works: Array<{ owner: string; text: string; structure: VersionStructure; desc: string }> = [
    {
      owner: lin.id,
      text: '我想拍凌晨四点的渔市，记录那些天不亮就开始的人。',
      structure: simpleStructure({
        intentSummary: '纪录凌晨渔市的劳作群像，60秒，纪实口吻。',
        name: '凌晨四点的渔市',
        oneLiner: '天亮之前，城市先在这里醒来。',
        emotion: '质朴、敬意',
        visual: '纪实摄影 · 高感光颗粒 · 冷蓝到暖橙的光变',
        logline: '从卸货到开秤，跟着渔市的两个小时走完一天里最诚实的劳动。',
        sceneShots: [
          { d: '码头探照灯下，渔船靠岸，人影攒动', cam: '手持跟随', ms: 8000, n: '凌晨四点，渔市先醒。', e: '质朴' },
          { d: '胶靴踩过湿漉漉的水泥地，鱼箱摞起', cam: '低角度', ms: 6000, n: '冰、盐、和一整天的生计。', e: '质朴' },
          { d: '第一缕天光落在秤杆上，交易开市', cam: '缓摇', ms: 7000, n: '天亮了，他们收工了。', e: '敬意' },
        ],
        style: 'documentary',
        music: 'minimal ambient',
      }),
      desc: '天亮之前，城市先在这里醒来。纪实短片。',
    },
    {
      owner: chen.id,
      text: '我想做一个视频解释为什么天空是蓝色的，给小朋友看。',
      structure: simpleStructure({
        intentSummary: '向孩子解释瑞利散射，45秒，亲切语调。',
        name: '为什么天空是蓝色',
        oneLiner: '阳光其实是七种颜色挤在一起赶路。',
        emotion: '好奇、明快',
        visual: '手绘动画 · 明快色块 · 圆润线条',
        logline: '跟着一束阳光穿过大气层，看蓝光如何被空气弹得满天空都是。',
        sceneShots: [
          { d: '白色阳光被棱镜散成七色扇面', cam: '固定', ms: 6000, n: '阳光是一大家子颜色。', e: '好奇' },
          { d: '蓝光小圆点撞上空气分子，弹跳成满屏星屑', cam: '弹跳动画', ms: 9000, n: '蓝色最调皮，撞得到处都是。', e: '明快' },
          { d: '抬头看天空，蓝色星屑铺满穹顶', cam: '仰角缓推', ms: 6000, n: '所以，天空是蓝色的。', e: '顿悟' },
        ],
        style: 'handdrawn_animation',
        music: 'playful pizzicato',
      }),
      desc: '给小朋友的 45 秒科普：蓝光为什么会铺满天空。',
    },
    {
      owner: chen.id,
      text: '我想用三分钟讲清楚相对论到底在说什么。',
      structure: simpleStructure({
        intentSummary: '科普狭义相对论核心直觉，180秒，讲给普通人。',
        name: '三分钟理解相对论',
        oneLiner: '时间不是统一的背景板，它是每块手表自己的事。',
        emotion: '深邃、豁然',
        visual: '极简几何动画 · 黑底白线 · 一点金色',
        logline: '用一列火车、两块表和一个光子，讲明白"同时"是错觉。',
        sceneShots: [
          { d: '黑幕上光子出发，金色轨迹延伸', cam: '固定', ms: 10000, n: '先记住：光速对谁都一样。', e: '好奇' },
          { d: '火车内的人看光走直线，站台的人看光走斜线', cam: '分屏对照', ms: 15000, n: '同一束光，两位观察者。', e: '投入' },
          { d: '两块表的刻度悄然岔开，时间膨胀可视化', cam: '特写', ms: 12000, n: '所以时间，是各自的。', e: '顿悟' },
        ],
        style: 'minimal_geometry',
        music: 'sparse piano',
      }),
      desc: '一列火车、两块表、一个光子——"同时"是错觉。',
    },
    {
      owner: he.id,
      text: '我想把我外婆讲过的梦做成一个视频，那些梦比电影还离奇。',
      structure: simpleStructure({
        intentSummary: '将外婆口述的梦境视觉化，50秒，梦幻诗性。',
        name: '外婆的梦境日记',
        oneLiner: '她梦见海水漫过灶台，鱼在汤锅里游成了星星。',
        emotion: '梦幻、温柔',
        visual: '水彩晕染 · 蓝绿基调 · 星屑粒子',
        logline: '翻开外婆的梦境日记：一页会飞的老屋，一页住着灯的鲸鱼。',
        sceneShots: [
          { d: '老屋拔起炊烟缓缓升空，瓦片如羽毛', cam: '仰角缓摇', ms: 8000, n: '外婆说，房子会想飞。', e: '梦幻' },
          { d: '鲸鱼游过夜空，肚里亮着一盏盏灯', cam: '横移', ms: 9000, n: '灯是给夜里赶路的人留的。', e: '温柔' },
          { d: '汤锅里升起星屑，铺成银河', cam: '缓推', ms: 7000, n: '梦做完，天就亮了。', e: '温柔' },
        ],
        style: 'watercolor_dream',
        music: 'music box lullaby',
      }),
      desc: '外婆口述梦境的视觉化实验：会飞的老屋和住着灯的鲸鱼。',
    },
  ]

  for (const w of works) {
    const c = await contentService.startCreation({ ownerId: w.owner, text: w.text })
    await walkToReady(c.id, w.owner)
    await versionService.createVersion(c.id, w.owner, { method: 'initial', structure: w.structure, changelog: '初版' })
    await contentService.publishMinimal(c.id, w.owner, { visibility: 'public', description: w.desc })
  }

  // ---------- Remix 案例：阿禾 remix 自行车故事 ----------
  const forked = await forkService.forkContent({ sourceContentId: bicycle.id, newOwnerId: he.id })
  await versionService.createVersion(forked.content.id, he.id, {
    method: 'revision',
    changelog: '换成城市夜灯：骑行发生在晚高峰后的街道，霓虹代替夕阳',
    structure: {
      ...bicycleV2,
      concept: { ...bicycleV2.concept!, name: '夜灯骑行 · 城市版', oneLiner: '长大后我把那段路骑成了城市夜灯。', visualDirection: 'cinematic_realism · 霓虹湿润 · 蓝紫夜调' },
      story: {
        ...bicycleV2.story!,
        logline: '下班后的街道上，一个人骑车穿过城市，后座空着。',
        scenes: [
          { index: 0, summary: '夜街出发', shots: shots([{ d: '写字楼灯火渐熄，自行车汇入夜色', cam: '跟拍', ms: 6000, n: '下班后的城市，安静得像小时候的巷口。', e: '平静' }]) },
          { index: 1, summary: '穿过霓虹', shots: shots([{ d: '便利店灯箱雨后反光，车轮碾过倒影', cam: '低角度', ms: 7000, n: '霓虹替我记着路。', e: '怅然' }]) },
          { index: 2, summary: '归家', shots: shots([{ d: '楼下路灯拉长影子，手机亮起：爸', cam: '缓拉', ms: 8000, n: '下个周末，回家骑车。', e: '温暖' }]) },
        ],
      },
    },
  })
  await contentService.publishMinimal(forked.content.id, he.id, {
    visibility: 'public',
    description: 'Remix 自《和父亲骑车的夏天》：长大后我把那段路骑成了城市夜灯。',
  })

  // ---------- 少量互动 ----------
  await db.contentInteraction.createMany({
    data: [
      { userId: chen.id, contentId: bicycle.id, type: 'like' },
      { userId: he.id, contentId: bicycle.id, type: 'like' },
      { userId: lin.id, contentId: forked.content.id, type: 'like' },
    ],
  })

  console.log('[seed] 完成：3 位演示用户 / 6 件作品（含 §63 自行车故事 + 1 条 Remix 血缘）')
}

main()
  .catch((e) => {
    console.error('[seed] 失败：', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
