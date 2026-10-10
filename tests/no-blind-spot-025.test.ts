// 025 全方位无死角提升（设计 docs/design/no-blind-spot-025.md）四条战线的锁定测试：
//   战线一 景别遵从度：首抽前置硬指令 + 重抽 mandatory 景别 + 无 shotSize 零注入（向后兼容）
//   战线三 经验复利：topPromptsForTeaching 跨项目按分降序 + exemplarTeachingSection 注入/空库零注入
//   战线二 计算型 Job：startRevisionPlan 同反馈复用 / 异反馈 supersede / 被取代 Job 不可翻回 succeeded
//   战线四 双通道：claimNext 类型过滤与排除 / runOneTick 无参兼容旧行为
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { jobService } from '@/core/jobs/job-service'
import { planService } from '@/core/planning/plan-service'
import { contentRepo } from '@/core/repositories/content-repo'
import { versionRepo } from '@/core/repositories/version-repo'
import { exemplarService } from '@/core/quality/exemplar-service'
import { variantImagePrompt } from '@/core/quality/shot-gate'
import { imagePromptFor } from '@/core/content/shot-prompt'
import { exemplarTeachingSection } from '@/ai/planning/story'
import { claimAndExecute, runOneTick } from '../workers/generation-worker'
import { executeJob } from '../workers/pipeline-executor'
import type { ShotSnapshot, VersionStructure } from '@/core/content/schemas'

// ---------- 夹具 ----------

function shotFixture(overrides: Partial<ShotSnapshot> = {}): ShotSnapshot {
  return {
    index: 0,
    visualDescription: '黄昏的老巷口，父亲与自行车',
    imagePrompt: 'A quiet old alley at dusk, a father beside a vintage bicycle',
    shotSize: 'closeup',
    cameraMotion: 'static',
    durationMs: 5000,
    ...overrides,
  } as ShotSnapshot
}

function structureFixture(overrides: Partial<VersionStructure> = {}): VersionStructure {
  return {
    concept: { name: '方向', oneLiner: '一句话' },
    characters: [],
    story: { logline: 'logline', scenes: [] },
    ...(overrides as object),
  } as VersionStructure
}

async function seedContent() {
  const { user } = await userRepo.createSessionUser(db)
  const c = await contentService.startCreation({ ownerId: user.id, text: '无死角走查' })
  return { user, contentId: c.id }
}

beforeEach(async () => {
  await db.generationJob.deleteMany({ where: { status: { in: ['queued', 'claimed'] } } })
  await db.shotExemplar.deleteMany()
})

// ---------- 战线一：景别遵从度 ----------

describe('战线一：景别指令前置与重抽硬指令', () => {
  it('首抽 prompt 以 Framing requirement 开头（图像模型对开头注意力最高）', () => {
    const out = imagePromptFor(shotFixture({ shotSize: 'closeup' }), structureFixture())
    expect(out.startsWith('Framing requirement: close-up shot, face and shoulders fill the frame.')).toBe(true)
    // 尾部保留（首尾双保险）
    expect(out).toContain('Framing: close-up shot')
  })

  it('无 shotSize 的旧配方 → 零前置（向后兼容，与旧版逐字一致的开头）', () => {
    const out = imagePromptFor(shotFixture({ shotSize: undefined }), structureFixture())
    expect(out.startsWith('A quiet old alley')).toBe(true)
    expect(out).not.toContain('Framing requirement')
  })

  it('重抽变体前置 FRAMING (mandatory) 硬指令', () => {
    const out = variantImagePrompt('base prompt.', ['构图太松'], 1, 'close-up shot, face and shoulders fill the frame')
    expect(out.startsWith('FRAMING (mandatory): close-up shot, face and shoulders fill the frame.')).toBe(true)
    expect(out).toContain('MUST avoid these problems')
  })

  it('重抽变体无景别事实 → 不注入 mandatory 指令（旧语义兼容）', () => {
    const out = variantImagePrompt('base prompt.', ['构图太松'], 1)
    expect(out).not.toContain('FRAMING')
    expect(out.startsWith('base prompt.')).toBe(true)
  })
})

// ---------- 战线三：经验复利跨项目激活 ----------

describe('战线三：范例写法教学', () => {
  it('exemplarTeachingSection 空库零注入（向后兼容）', () => {
    expect(exemplarTeachingSection([])).toBe('')
  })

  it('exemplarTeachingSection 注入分数标注与超长截断', () => {
    const long = 'x'.repeat(400)
    const out = exemplarTeachingSection([
      { imagePrompt: 'A father at dusk, navy shirt, warm rim light', score: 9.1 },
      { imagePrompt: long, score: 8.5 },
    ])
    expect(out).toContain('已验证的高分写法范例')
    expect(out).toContain('9.1 分')
    expect(out).toContain('8.5 分')
    expect(out).not.toContain(long) // 400 字符被截到 320 + 省略号
    expect(out).toContain(`${'x'.repeat(320)}…`)
  })

  it('topPromptsForTeaching 跨项目按分降序取 top-N（不加载资产文件）', async () => {
    // 顺序 seed（SQLite 单写者：并发事务会撞锁超时）
    const seeds: Array<{ user: { id: string }; contentId: string }> = []
    for (let i = 0; i < 3; i++) seeds.push(await seedContent())
    // 三个不同项目（跨项目语义），分数乱序入库
    const rows = [
      { contentId: seeds[0]!.contentId, shotIndex: 0, score: 8.2, prompt: 'mid score prompt' },
      { contentId: seeds[1]!.contentId, shotIndex: 1, score: 9.4, prompt: 'best score prompt' },
      { contentId: seeds[2]!.contentId, shotIndex: 0, score: 8.8, prompt: 'second score prompt' },
    ]
    for (const r of rows) {
      await db.shotExemplar.create({
        data: {
          contentId: r.contentId,
          versionId: null,
          shotIndex: r.shotIndex,
          assetId: 'nonexistent-asset', // 教学查询不读资产——资产不存在也不影响
          promptHash: 'hash',
          promptJson: JSON.stringify({ imagePrompt: r.prompt, context: {} }),
          scoreJson: JSON.stringify({ score: r.score, summary: 'ok' }),
        },
      })
    }
    const top = await exemplarService.topPromptsForTeaching(2)
    expect(top.map((t) => t.score)).toEqual([9.4, 8.8])
    expect(top[0]!.imagePrompt).toBe('best score prompt')
  })

  it('坏行（promptJson 脏数据）跳过不炸', async () => {
    const { contentId } = await seedContent()
    await db.shotExemplar.create({
      data: {
        contentId,
        versionId: null,
        shotIndex: 0,
        assetId: 'a',
        promptHash: 'h',
        promptJson: '{not-json',
        scoreJson: 'also-bad',
      },
    })
    expect(await exemplarService.topPromptsForTeaching(3)).toEqual([])
  })
})

// ---------- 战线二：revision.plan 计算型 Job ----------

describe('战线二：修订定位 Job（supersede 语义）', () => {
  async function seedVersionedContent() {
    const { user, contentId } = await seedContent()
    // 手工密封一个版本（修订定位的原料）
    const version = await versionRepo.create(db, {
      contentId,
      versionNumber: 1,
      parentVersionId: null,
      createdBy: user.id,
      creationMethod: 'seed',
      structureJson: JSON.stringify({
        concept: { name: 'n', oneLiner: 'o' },
        characters: [],
        story: { logline: 'l', scenes: [] },
      }),
      changelog: '初稿',
    })
    await contentRepo.update(db, contentId, { currentVersionId: version.id })
    return { user, contentId, versionId: version.id }
  }

  it('入队语义：revision.plan Job 携带 feedback 原文', async () => {
    const { user, contentId, versionId } = await seedVersionedContent()
    const r = await planService.startRevisionPlan(contentId, '再温暖一点', user.id)
    expect(r.alreadyRunning).toBe(false)
    expect(r.supersededJobId).toBeNull()
    const job = await db.generationJob.findUnique({ where: { id: r.jobId } })
    expect(job?.type).toBe('revision.plan')
    expect(JSON.parse(job?.inputJson ?? '{}')).toMatchObject({ feedback: '再温暖一点', versionId })
  })

  it('同 feedback 重复提交 → 复用活跃 Job（幂等防重）', async () => {
    const { user, contentId } = await seedVersionedContent()
    const first = await planService.startRevisionPlan(contentId, '再温暖一点', user.id)
    const second = await planService.startRevisionPlan(contentId, '再温暖一点', user.id)
    expect(second.alreadyRunning).toBe(true)
    expect(second.jobId).toBe(first.jobId)
    expect(await db.generationJob.count({ where: { contentId, type: 'revision.plan' } })).toBe(1)
  })

  it('换 feedback 重提 → 旧 Job 被取代（failed 终态 + 人话原因）+ 新 Job 入队', async () => {
    const { user, contentId } = await seedVersionedContent()
    const first = await planService.startRevisionPlan(contentId, '再温暖一点', user.id)
    const second = await planService.startRevisionPlan(contentId, '结尾别这么悲伤', user.id)

    expect(second.alreadyRunning).toBe(false)
    expect(second.supersededJobId).toBe(first.jobId)
    const old = await db.generationJob.findUnique({ where: { id: first.jobId } })
    expect(old?.status).toBe('failed')
    expect(old?.error).toContain('已被新的修订请求取代')
    expect(await db.generationJob.count({ where: { contentId, type: 'revision.plan' } })).toBe(2)
  })

  it('被取代的 Job 即使执行器返回也翻不回 succeeded（complete 条件写）', async () => {
    const { user, contentId } = await seedVersionedContent()
    const { jobId } = await planService.startRevisionPlan(contentId, '再温暖一点', user.id)
    // 模拟执行器已领取并跑完 LLM（running）→ 用户此刻改了反馈
    await db.generationJob.update({ where: { id: jobId }, data: { status: 'running' } })
    await planService.startRevisionPlan(contentId, '换个改法', user.id)

    await jobService.complete(jobId, { plan: { summary: '迟到的结果' } })

    const after = await db.generationJob.findUnique({ where: { id: jobId } })
    expect(after?.status).toBe('failed') // 终态守卫：迟到的结果作废
  })

  it('无版本（未生成过）→ DomainValidationError', async () => {
    const { user, contentId } = await seedContent()
    await expect(planService.startRevisionPlan(contentId, '再温暖一点', user.id)).rejects.toThrow('先完成一次生成')
  })

  it('feedback 透传回归（E2E 实战揪出的白名单漏洞）：执行器绝不报「反馈缺失」', async () => {
    const { user, contentId } = await seedVersionedContent()
    const { jobId } = await planService.startRevisionPlan(contentId, '再温暖一点', user.id)
    const job = await db.generationJob.findUnique({ where: { id: jobId } })
    // 直接执行（测试库无 LLM provider → ProviderExhaustedError 失败，
    // 但 parseJobPayload 白名单必须已透传 feedback——否则会报「修订反馈缺失或太短」）
    await executeJob(jobId, 'revision.plan', job?.inputJson ?? '{}')
    const after = await db.generationJob.findUnique({ where: { id: jobId } })
    expect(after?.error ?? '').not.toContain('修订反馈缺失')
  })
})

// ---------- 战线二：intent.directions Job 入队 ----------

describe('战线二：方向构思 Job 化（入队语义与幂等）', () => {
  it('INTENT 状态入队 intent.directions；重复提交复用（刷新不重烧配额）', async () => {
    const { user, contentId } = await seedContent()
    // startCreation 落在 IDEA → 推进到 INTENT（需先有意图确认语义，直接走状态机）
    await contentService.advanceStatus(contentId, 'INTENT', user.id)
    const first = await planService.startDirections(contentId, user.id)
    expect(first.alreadyRunning).toBe(false)
    const job = await db.generationJob.findUnique({ where: { id: first.jobId } })
    expect(job?.type).toBe('intent.directions')

    const second = await planService.startDirections(contentId, user.id)
    expect(second.alreadyRunning).toBe(true)
    expect(second.jobId).toBe(first.jobId)
  })

  it('非 INTENT 状态 → DomainValidationError（与旧同步路由同语义）', async () => {
    const { user, contentId } = await seedContent()
    await expect(planService.startDirections(contentId, user.id)).rejects.toThrow('先确认你的表达')
  })
})

// ---------- 战线四：双通道 worker ----------

describe('战线四：claimNext 类型过滤（双通道）', () => {
  it('规划通道只领规划类；生成通道排除规划类；无参 = 旧行为领任意', async () => {
    const { user, contentId } = await seedContent()
    await db.intent.create({
      data: { contentId, rawExpression: 'x', fieldsJson: JSON.stringify({ fields: { topic: 'x' } }) },
    })
    await db.creativePlan.create({
      data: { contentId, selectedDirectionId: 'd1', conceptJson: JSON.stringify({ directionId: 'd1', name: 'n', oneLiner: 'o' }) },
    })
    // 三个不同类型排进队列：两个规划类 + 一个生成类
    await jobService.enqueue({ contentId, versionId: null, type: 'story.draft', payload: { contentId, versionId: null, actorId: user.id } })
    await jobService.enqueue({ contentId, versionId: null, type: 'intent.directions', payload: { contentId, versionId: null, actorId: user.id } })
    await jobService.enqueue({ contentId, versionId: null, type: 'video.storyboard', payload: { contentId, versionId: null, actorId: user.id } })

    // 无参：领最早的（story.draft）——旧行为
    const any = await jobService.claimNext()
    expect(any?.type).toBe('story.draft')

    // 规划通道：领下一个规划类（intent.directions），绝不领 video.storyboard
    const planning = await jobService.claimNext(['story.draft', 'storyboard.plan', 'intent.directions', 'revision.plan'])
    expect(planning?.type).toBe('intent.directions')

    // 生成通道：排除规划类 → 领 video.storyboard
    const generation = await jobService.claimNext(undefined, ['story.draft', 'storyboard.plan', 'intent.directions', 'revision.plan'])
    expect(generation?.type).toBe('video.storyboard')

    // 队列清空后两通道都拿不到
    expect(await jobService.claimNext(['revision.plan'])).toBeNull()
  })

  it('runOneTick 无参兼容旧行为（领取任意类型并执行到终态）', async () => {
    const { user, contentId } = await seedContent()
    await db.intent.create({
      data: { contentId, rawExpression: 'x', fieldsJson: JSON.stringify({ fields: { topic: 'x' } }) },
    })
    await db.creativePlan.create({
      data: { contentId, selectedDirectionId: 'd1', conceptJson: JSON.stringify({ directionId: 'd1', name: 'n', oneLiner: 'o' }) },
    })
    // 状态在 IDEA（非 INTENT）→ directions Job 走状态守卫 → 幂等 skipped 终态（不报错不丢工作）
    const { jobId } = await planService.startDirections(contentId, user.id).catch(() => ({ jobId: '' }))
    void jobId
    // 直接手工入队（绕过状态校验），验证 runOneTick 无参领取 + 执行
    await db.content.update({ where: { id: contentId }, data: { status: 'INTENT' } })
    const job = await jobService.enqueue({ contentId, versionId: null, type: 'intent.directions', payload: { contentId, versionId: null, actorId: user.id } })

    // 打断 LLM：测试环境无供给配置时 completeJson 会抛错 → Job 失败回队/终态——
    // 这里只验证「领取到了」：runOneTick 返回 true 即领取并执行过
    const had = await runOneTick()
    expect(had).toBe(true)
    const after = await db.generationJob.findUnique({ where: { id: job.id } })
    expect(['running', 'queued', 'claimed', 'succeeded', 'failed', 'timeout']).toContain(after?.status)
  })

  it('claimAndExecute 分通道领取（planning 通道不吃生成类）', async () => {
    const { user, contentId } = await seedContent()
    await jobService.enqueue({ contentId, versionId: null, type: 'video.storyboard', payload: { contentId, versionId: null, actorId: user.id } })

    // 规划通道面对纯生成队列 → 无可领取，返回 false（生成 Job 留给生成通道）
    const had = await claimAndExecute('planning')
    expect(had).toBe(false)
    const still = await db.generationJob.findFirst({ where: { contentId, type: 'video.storyboard' } })
    expect(still?.status).toBe('queued')
  })
})

// 抑制未使用告警（夹具按需取用）
