// serial-season-027 回归测试——「50 分钟 → 分集 → 连贯一致不飘逸」能力链验收
// 三层证据（设计文档 §7 验收标准）：
//   A. 分集几何纯函数：50min→25×120s；hint 覆盖；单集不分；上限保护
//   B. 季圣经纯函数：anchorHash 稳定性 / 引用闭合 / 悬念链 / 几何对账
//   C. 3 集迷你季集成（fake provider + DB）：圣经落盘 → 剧集孵化 → 逐集生成
//      → 锚点字节一致（expect(x).toBe(bible原文) 级别）+ 悬念注入 + 每集时长预算
// 铁律：fake provider / 直接 DB 造数，绝不触网。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { intentService } from '@/core/intent/intent-service'
import { clearRegistry, registerProvider } from '@/ai/router/registry'
import type { ProviderCallContext, TextPlanProvider } from '@/ai/router/types'
import { generateStoryDraft, generateStoryboard } from '@/ai/planning/story'
import { generateSeasonBible } from '@/ai/planning/season'
import { seasonService } from '@/core/planning/season-service'
import { IntentRecordSchema, type IntentRecord } from '@/core/content/schemas'
import {
  episodeSecHintFromExpression,
  isSerialDuration,
  planSeasonGeometry,
  serialKeywordsInExpression,
  type SeasonGeometry,
} from '@/core/content/season-geometry'
import {
  SeasonBibleSchema,
  anchorHashOf,
  charactersForEpisode,
  cliffhangerChainViolations,
  geometryViolations,
  recapFragment,
  referenceClosureViolations,
  seasonBibleViolations,
  type SeasonBible,
} from '@/core/content/season-bible'

afterEach(() => {
  clearRegistry()
})

// ---------------- A. 分集几何（纯函数） ----------------

describe('planSeasonGeometry：长片 → 分集编译', () => {
  it('50 分钟 → 25 集 × 120 秒（产品口径「每集 1-2 分钟」的缺省几何）', () => {
    const g = planSeasonGeometry(3000)
    expect(g.serial).toBe(true)
    expect(g.episodeCount).toBe(25)
    expect(g.episodeSec).toBe(120)
    expect(g.hintApplied).toBe(false)
    // 总时长守恒
    expect(g.episodeCount * g.episodeSec).toBeCloseTo(g.totalSec, 6)
  })
  it('用户显式偏好：「每集 1 分钟」的 50 分钟 → 50 集 × 60 秒', () => {
    const g = planSeasonGeometry(3000, 60)
    expect(g.serial).toBe(true)
    expect(g.episodeCount).toBe(50)
    expect(g.episodeSec).toBe(60)
    expect(g.hintApplied).toBe(true)
  })
  it('hint 夹到理性区间 [60,180]：每集 5 分钟 → 按 180 秒目标 → 17 集', () => {
    const g = planSeasonGeometry(3000, 300)
    expect(g.episodeCount).toBe(17)
    expect(g.episodeSec).toBeCloseTo(3000 / 17, 6)
  })
  it('4 分钟恰在分集阈值；3 分 59 秒仍单集（既有路径零行为变化）', () => {
    expect(planSeasonGeometry(240).serial).toBe(true)
    expect(planSeasonGeometry(240).episodeCount).toBe(2)
    const single = planSeasonGeometry(239)
    expect(single.serial).toBe(false)
    expect(single.episodeCount).toBe(1)
    expect(single.episodeSec).toBe(239)
  })
  it('集数上限 60：极端长片也守恒且不失控', () => {
    const g = planSeasonGeometry(3600, 30) // hint 30s → 120 集 → 夹 60
    expect(g.episodeCount).toBe(60)
    expect(g.episodeSec).toBe(60)
  })
})

describe('episodeSecHintFromExpression / serialKeywords / isSerialDuration', () => {
  it('「每集1分钟」「一集两分钟」「每集 90 秒」解析；无匹配返回 undefined', () => {
    expect(episodeSecHintFromExpression('做一个50分钟的短剧，每集1分钟')).toBe(60)
    expect(episodeSecHintFromExpression('一集两分钟的连续剧')).toBe(120)
    expect(episodeSecHintFromExpression('每集 90 秒的系列')).toBe(90)
    expect(episodeSecHintFromExpression('每集5分钟')) // 解析宽容 300
      .toBe(300)
    expect(episodeSecHintFromExpression('随便一个故事')).toBeUndefined()
    expect(episodeSecHintFromExpression('每集10秒')).toBeUndefined() // 低于 30s 不采
  })
  it('连续剧关键词与时长阈值', () => {
    expect(serialKeywordsInExpression('做一个连续剧')).toBe(true)
    expect(serialKeywordsInExpression('短剧，每集两分钟')).toBe(true)
    expect(serialKeywordsInExpression('50分钟的短视频')).toBe(false)
    expect(isSerialDuration(240)).toBe(true)
    expect(isSerialDuration(239)).toBe(false)
    expect(isSerialDuration(undefined)).toBe(false)
  })
})

// ---------------- B. 季圣经纯函数（冻结与校验闸） ----------------

const bibleFixture = (): SeasonBible =>
  SeasonBibleSchema.parse({
    seasonLogline: '外卖骑手老陈为救女儿欠下债，在暴雨季的城里接单还债，却撞见五年前失踪的妻子。',
    narrationStyle: '第三人称，克制的白描',
    lookBook: 'Rain-soaked neon city nights, teal and amber contrast, wet reflective asphalt, moody 35mm film grain',
    characters: [
      {
        name: '老陈',
        desire: '还清女儿的手术债',
        obstacle: '暴雨季订单骤减，债主步步紧逼',
        arc: '从独自硬扛，到接受陌生人善意',
        wardrobe: '洗旧的黄色雨衣',
        visualAnchor: 'A wiry Chinese delivery rider in his 40s, buzz cut with gray patches, faded yellow rain poncho, tired but resolute eyes',
      },
      {
        name: '小雨',
        desire: '等爸爸兑现去看海的承诺',
        obstacle: '术后休学，独自在家',
        arc: '从懂事得让人心疼，到把愿望说出口',
        visualAnchor: 'A frail 9-year-old Chinese girl, thin braided hair, pale blue hospital pajamas, quiet hopeful eyes',
      },
    ],
    recurringLocations: [
      {
        name: '骑手站点',
        locationAnchor: 'Cramped delivery dispatch station under an overpass, stacked insulated boxes, flickering fluorescent tube, rain drumming on tin roof',
        timeOfDay: '深夜',
      },
      {
        name: '老陈家',
        locationAnchor: 'Small dim apartment, paper cranes strung above the bed, old fan, kitchen light leaking into hallway',
        timeOfDay: '夜晚',
      },
    ],
    acts: [{ index: 0, title: '暴雨开局', function: '债务与女儿的病同时压顶', fromEpisode: 0, toEpisode: 2 }],
    episodes: [
      {
        index: 0,
        title: '暴雨第一单',
        synopsis: '暴雨夜老陈抢下高危单，却在写字楼撞见一个不该出现的人影',
        cliffhanger: '人影回头——是失踪五年的妻子',
        emotionBeat: '压抑',
        charactersUsed: ['老陈'],
        locationsUsed: ['骑手站点'],
      },
      {
        index: 1,
        title: '雨夜追影',
        synopsis: '老陈弃单追人影穿过半座城，订单超时罚款与真相近在眼前',
        cliffhanger: '巷口空无一人，只有一只熟悉的旧发卡',
        emotionBeat: '揪心',
        charactersUsed: ['老陈', '小雨'],
        locationsUsed: ['老陈家', '骑手站点'],
      },
      {
        index: 2,
        title: '雨停之约',
        synopsis: '老陈带着女儿去看了海，把妻子的发卡留在了沙滩上',
        cliffhanger: '',
        emotionBeat: '释然',
        charactersUsed: ['老陈', '小雨'],
        locationsUsed: ['老陈家'],
      },
    ],
  })

describe('anchorHashOf：锚点指纹', () => {
  it('同一圣经两次计算一致；改一个锚点字符即变（漂移可检测）', () => {
    const a = bibleFixture()
    const b = bibleFixture()
    expect(anchorHashOf(a)).toBe(anchorHashOf(b))
    b.characters[0]!.visualAnchor = `${b.characters[0]!.visualAnchor}!`
    expect(anchorHashOf(a)).not.toBe(anchorHashOf(b))
    // lookBook 变也漂移
    const c = bibleFixture()
    c.lookBook = 'totally different look'
    expect(anchorHashOf(a)).not.toBe(anchorHashOf(c))
  })
})

describe('seasonBibleViolations：语义闸（引用闭合 + 悬念链 + 几何对账）', () => {
  const geometry3: SeasonGeometry = { serial: true, totalSec: 360, episodeCount: 3, episodeSec: 120, hintApplied: false }
  it('干净圣经零违例', () => {
    expect(seasonBibleViolations(bibleFixture(), geometry3)).toEqual([])
  })
  it('引用不闭合：人名/场景名不在表里 → 违例', () => {
    const bad = bibleFixture()
    bad.episodes[0]!.charactersUsed = ['陌生人']
    bad.episodes[1]!.locationsUsed = ['不存在的码头']
    const v = referenceClosureViolations(bad)
    expect(v.join('; ')).toContain('陌生人')
    expect(v.join('; ')).toContain('不存在的码头')
  })
  it('悬念链：中间集缺悬念 → 违例；大结局留悬念 → 违例；序号断档 → 违例', () => {
    const noHook = bibleFixture()
    noHook.episodes[1]!.cliffhanger = ''
    expect(cliffhangerChainViolations(noHook).join('; ')).toContain('第 2 集缺少集尾悬念')
    const openFinale = bibleFixture()
    openFinale.episodes[2]!.cliffhanger = '还有第二季'
    expect(cliffhangerChainViolations(openFinale).join('; ')).toContain('大结局不应留悬念')
    const gapped = bibleFixture()
    gapped.episodes[2]!.index = 5
    expect(cliffhangerChainViolations(gapped).join('; ')).toContain('集序号不连续')
  })
  it('几何对账：集大纲数量与几何集数不一致 → 违例', () => {
    const v = geometryViolations(bibleFixture(), { ...geometry3, episodeCount: 25 })
    expect(v[0]).toContain('≠')
  })
})

describe('charactersForEpisode / recapFragment：引用取出与前情提要', () => {
  it('按集引用深拷贝（改副本不污染圣经）；前情提要含上一集悬念', () => {
    const bible = bibleFixture()
    const chars = charactersForEpisode(bible, bible.episodes[1]!)
    expect(chars.map((c) => c.name).sort()).toEqual(['小雨', '老陈'])
    chars[0]!.visualAnchor = 'TAMPERED'
    expect(bible.characters.find((c) => c.name === chars[0]!.name)!.visualAnchor).not.toBe('TAMPERED')
    const recap = recapFragment(bible, 1)
    expect(recap).toContain('前情提要')
    expect(recap).toContain('人影回头')
    expect(recapFragment(bible, 0)).toBe('')
  })
})

// ---------------- C. 3 集迷你季集成（fake provider + DB，零触网） ----------------

describe('3 集迷你季：圣经落盘 → 剧集孵化 → 逐集生成（锚点字节一致）', () => {
  const BIBLE = bibleFixture()

  /** 路由式 fake LLM：季规划返回圣经；故事返回「带错误锚点」的草稿（验证冻结覆写）；分镜返回 8×15s */
  function makeFakeLlm(captured: { user: string; system: string; n: number }): TextPlanProvider {
    return {
      id: 'fake-llm-027',
      capability: 'text.plan',
      model: 'fake-llm',
      async execute(payload) {
        captured.n += 1
        captured.user = payload.user
        captured.system = payload.system
        if (payload.system.includes('连续剧总编剧')) {
          return { text: JSON.stringify(BIBLE) }
        }
        if (payload.system.includes('故事编剧')) {
          return {
            text: JSON.stringify({
              logline: '老陈的暴雨季：债、女儿与一个不该出现的人影',
              narrationStyle: 'DRIFTED-STYLE',
              emotionArc: ['压抑', '揪心', '释然'],
              lookBook: 'DRIFTED-LOOK-BOOK-wrong wrong wrong',
              characters: [
                {
                  name: '老陈',
                  desire: '还债',
                  obstacle: '暴雨',
                  arc: '硬扛到接受',
                  visualAnchor: 'DRIFTED-WRONG-ANCHOR for laochen',
                },
                {
                  name: '小雨',
                  desire: '看海',
                  obstacle: '休学',
                  arc: '把愿望说出口',
                  visualAnchor: 'DRIFTED-WRONG-ANCHOR for xiaoyu',
                },
              ],
              scenes: [
                {
                  index: 0,
                  summary: '暴雨夜的第一单',
                  location: '骑手站点',
                  locationAnchor: 'DRIFTED-WRONG-SCENE-ANCHOR',
                  dramaticFunction: 'hook',
                  valueShift: '平静→不安',
                  timeOfDay: '深夜',
                },
                {
                  index: 1,
                  summary: '家里的纸鹤',
                  location: '老陈家',
                  locationAnchor: 'DRIFTED-WRONG-SCENE-ANCHOR-2',
                  dramaticFunction: 'setup',
                  valueShift: '不安→牵挂',
                  timeOfDay: '夜晚',
                },
                {
                  index: 2,
                  summary: '天台临时场景',
                  location: '临时天台',
                  locationAnchor: 'Episode-local rooftop anchor, rain clouds over city',
                  dramaticFunction: 'turn',
                  valueShift: '牵挂→震动',
                  timeOfDay: '深夜',
                },
              ],
            }),
          }
        }
        // 分镜师：8 镜 × 15000ms = 120s
        return {
          text: JSON.stringify({
            scenes: [
              {
                index: 0,
                shots: Array.from({ length: 8 }, (_, i) => ({
                  index: i,
                  visualDescription: `第${i}镜暴雨中的骑手`,
                  imagePrompt: 'A rainy neon alley, wet asphalt reflections, cinematic',
                  shotSize: 'medium',
                  cameraMotion: 'static',
                  charactersInShot: ['老陈'],
                  durationMs: 15000,
                })),
              },
            ],
          }),
        }
      },
    }
  }

  beforeEach(async () => {
    await db.season.deleteMany({ where: {} })
    await db.episode.deleteMany({ where: {} })
  })

  it('整条链：360 秒意图 → 3 集孵化（PLANNING）→ 逐集故事生成锚点=bible 字节 → 悬念注入 → 时长预算', async () => {
    const captured = { user: '', system: '', n: 0 }
    registerProvider(makeFakeLlm(captured))

    const { user } = await userRepo.createSessionUser(db)
    const master = await contentService.startCreation({ ownerId: user.id, text: '做一个6分钟的连续短剧' })
    const record = IntentRecordSchema.parse({
      fields: { topic: '暴雨季骑手', duration: 360, format: 'serial' },
      sources: { topic: 'user', duration: 'user' },
    })
    await intentService.saveExtracted(master.id, record, { degraded: false, actorId: user.id })
    const directionId = 'dir-0'
    await db.creativePlan.create({
      data: {
        contentId: master.id,
        directionsJson: JSON.stringify([{ id: directionId, name: '暴雨骑手', oneLiner: '暴雨季的债与重逢' }]),
        selectedDirectionId: directionId,
        conceptJson: JSON.stringify({ directionId, name: '暴雨骑手', oneLiner: '暴雨季的债与重逢' }),
      },
    })

    // ---- 季规划执行（与 pipeline-executor 同构：领域守卫 → LLM 一次 → 落盘孵化） ----
    const prep = await seasonService.prepareSeasonPlan(master.id)
    expect(prep.geometry.episodeCount).toBe(3)
    expect(prep.geometry.episodeSec).toBe(120)
    const ctxSeason = (contentId: string): ProviderCallContext => ({ contentId, versionId: null, purpose: 'season.plan' })
    const bible = await generateSeasonBible(record, { name: '暴雨骑手', oneLiner: '暴雨季的债与重逢' }, prep.geometry, ctxSeason(master.id))
    expect(anchorHashOf(bible)).toBe(anchorHashOf(BIBLE))
    const outcome = await seasonService.persistSeason(master.id, { bible, geometry: prep.geometry }, user.id)
    expect(outcome.geometry.episodeCount).toBe(3)
    expect(outcome.anchorHash).toBe(anchorHashOf(BIBLE))

    // Season 落盘：bibleJson 冻结 + anchorHash 对账基准
    const seasonRow = await db.season.findUnique({ where: { contentId: master.id }, include: { episodes: true } })
    expect(seasonRow).not.toBeNull()
    expect(seasonRow!.episodeCount).toBe(3)
    expect(SeasonBibleSchema.parse(JSON.parse(seasonRow!.bibleJson)).seasonLogline).toBe(BIBLE.seasonLogline)

    // 剧集孵化：3 个 Episode 行 + 3 个 Content 直达 PLANNING，Intent duration=120
    const episodes = seasonRow!.episodes.sort((a, b) => a.index - b.index)
    expect(episodes).toHaveLength(3)
    for (const ep of episodes) {
      const content = await db.content.findUnique({ where: { id: ep.contentId } })
      expect(content!.status).toBe('PLANNING')
      expect(content!.title).toContain(`第 ${ep.index + 1} 集`)
      const intentRow = await db.intent.findFirst({ where: { contentId: ep.contentId } })
      const epRecord = intentService.parseRecord(intentRow!)
      expect(epRecord!.fields.duration).toBe(120)
      expect(epRecord!.fields.characters!.map((c) => c.name)).toContain('老陈')
    }

    // ---- 逐集故事生成：锚点字节一致（L1 防飘逸的核心断言） ----
    const ctx = (contentId: string): ProviderCallContext => ({ contentId, versionId: null, purpose: 'story.generate' })
    const concept = { name: '暴雨骑手', oneLiner: '暴雨季的债与重逢' }

    const anchorAssertions: string[] = []
    for (const ep of episodes) {
      const seasonCtx = await seasonService.seasonContextFor(ep.contentId)
      expect(seasonCtx).toBeDefined()
      const epIntentRow = await db.intent.findFirst({ where: { contentId: ep.contentId } })
      const epRecord = intentService.parseRecord(epIntentRow!) as IntentRecord

      const story = await generateStoryDraft(epRecord, concept, ctx(ep.contentId), { season: seasonCtx! })

      // 人物锚点 = 圣经原文（字节一致——LLM 写错也会被覆写）
      for (const c of story.characters ?? []) {
        const bibleChar = BIBLE.characters.find((b) => b.name === c.name)
        expect(bibleChar).toBeDefined()
        expect(c.visualAnchor).toBe(bibleChar!.visualAnchor)
      }
      // 视觉圣经/旁白风格 = 圣经原文
      expect(story.lookBook).toBe(BIBLE.lookBook)
      expect(story.narrationStyle).toBe(BIBLE.narrationStyle)

      // 场景锚点：圣经场景覆写为原文；临时场景保留自洽锚点
      const station = story.scenes.find((s) => s.location === '骑手站点')
      expect(station!.locationAnchor).toBe(BIBLE.recurringLocations[0]!.locationAnchor)
      const rooftop = story.scenes.find((s) => s.location === '临时天台')
      expect(rooftop!.locationAnchor).toBe('Episode-local rooftop anchor, rain clouds over city')

      anchorAssertions.push(`${ep.index}:${story.characters?.[0]!.visualAnchor!.slice(0, 12)}`)
    }
    expect(anchorAssertions).toHaveLength(3)

    // ---- 非剧集 Content：seasonContextFor 返回 undefined（单集路径零侵入） ----
    expect(await seasonService.seasonContextFor(master.id)).toBeUndefined()

    // ---- 悬念注入与每集时长预算（storyboard 层） ----
    const ep1Ctx = await seasonService.seasonContextFor(episodes[1]!.contentId)
    const ep1IntentRow = await db.intent.findFirst({ where: { contentId: episodes[1]!.contentId } })
    const ep1Record = intentService.parseRecord(ep1IntentRow!) as IntentRecord
    const ep1Story = await generateStoryDraft(ep1Record, concept, ctx(episodes[1]!.contentId), { season: ep1Ctx! })

    // 前情提要进 user prompt（fake 捕获的是最后一次调用的 user）
    expect(captured.user).toContain('前情提要')
    expect(captured.user).toContain(BIBLE.episodes[0]!.cliffhanger)
    // system 含集模式铁律
    expect(captured.system).toContain('连续剧的一集')

    const storyboard = await generateStoryboard(
      ep1Record,
      concept,
      ep1Story,
      ctx(episodes[1]!.contentId),
      { season: ep1Ctx! },
    )
    const totalMs = storyboard.scenes.reduce((n, s) => n + s.shots.reduce((m, sh) => m + (sh.durationMs ?? 0), 0), 0)
    expect(Math.abs(totalMs - 120000)).toBeLessThanOrEqual(18000) // ±15% 预算纪律
    // 分镜 user prompt：本集大纲与结尾悬念在场；system 含集铁律
    expect(captured.user).toContain(BIBLE.episodes[1]!.synopsis)
    expect(captured.user).toContain('末镜落在本集悬念')
    expect(captured.system).toContain('连续剧单集分镜的附加铁律')

    // ---- 幂等：重复 prepare → existing 短路（执行器不重调 LLM）；persist 事务内再入不重复孵化 ----
    const again = await seasonService.prepareSeasonPlan(master.id)
    expect(again.existing?.episodeContentIds.sort()).toEqual(outcome.episodeContentIds.sort())
    const repersisted = await seasonService.persistSeason(master.id, { bible, geometry: prep.geometry }, user.id)
    expect(repersisted.episodeContentIds.sort()).toEqual(outcome.episodeContentIds.sort())
    const count = await db.episode.count({ where: { seasonId: seasonRow!.id } })
    expect(count).toBe(3)

    // ---- 季视图（API 读侧） ----
    const view = await seasonService.getSeasonView(master.id)
    expect(view!.episodes).toHaveLength(3)
    expect(view!.episodes[0]!.cliffhanger).toBe(BIBLE.episodes[0]!.cliffhanger)
    expect(view!.episodes.map((e) => e.status)).toEqual(['PLANNING', 'PLANNING', 'PLANNING'])
  })

  it('诚实拒绝：单集时长（< 240s）不走季规划；LLM 路径以外的降级语义', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const master = await contentService.startCreation({ ownerId: user.id, text: '一个45秒的温暖小片' })
    const record = IntentRecordSchema.parse({
      fields: { topic: '温暖小片', duration: 45 },
      sources: { topic: 'user' },
    })
    await intentService.saveExtracted(master.id, record, { degraded: false, actorId: user.id })
    const directionId = 'dir-x'
    await db.creativePlan.create({
      data: {
        contentId: master.id,
        directionsJson: JSON.stringify([{ id: directionId, name: 'x', oneLiner: 'x' }]),
        selectedDirectionId: directionId,
        conceptJson: JSON.stringify({ directionId, name: 'x', oneLiner: 'x' }),
      },
    })
    await expect(seasonService.prepareSeasonPlan(master.id)).rejects.toThrow('未达分集量级')
  })
})
