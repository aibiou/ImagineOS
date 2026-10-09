// 规划层 LLM 异步化（2026-10-09 UX 反馈闭环：story.draft / storyboard.plan Job）
// 验证四件事：
//   1. 入队语义：PLANNING/STORY 状态下正确入队对应 Job 类型（payload 带 actorId）
//   2. 幂等防重：活跃 Job 期间重复提交 → 复用同一 jobId，不重复入队（刷新不重复烧配额）
//   3. 状态守卫：错误状态下提交 → DomainValidationError（与旧同步路由同语义）
//   4. 并发跳过：Job 执行时状态已被另一副本推进 → 幂等 complete(skipped)，不报错不丢工作
//   5. fail-fast：STORY 无故事执行 storyboard.plan → 确定性终态 + 用户可见指引
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { jobService } from '@/core/jobs/job-service'
import { planService } from '@/core/planning/plan-service'
import { runOneTick } from '../workers/generation-worker'

// 队列卫生：前置测试文件可能遗留 queued/claimed Job，测试库无 worker，必须自行清理
beforeEach(async () => {
  await db.generationJob.deleteMany({ where: { status: { in: ['queued', 'claimed'] } } })
})

async function seedContentAt(status: 'PLANNING' | 'STORY') {
  const { user } = await userRepo.createSessionUser(db)
  const c = await contentService.startCreation({ ownerId: user.id, text: '规划层异步化走查' })
  for (const to of ['INTENT', 'PLANNING', ...(status === 'STORY' ? (['STORY'] as const) : [])] as const) {
    await contentService.advanceStatus(c.id, to, user.id)
  }
  return { user, contentId: c.id }
}

/** 补齐规划层前置（Intent 记录 + Concept 冻结）——requireRecord/requireConcept 的原料 */
async function seedPlanPrerequisites(contentId: string) {
  // startCreation 已创建 Intent 行（rawExpression 有、fieldsJson 空）——原地补结构化字段
  const intent = await db.intent.findFirst({ where: { contentId } })
  await db.intent.update({
    where: { id: intent!.id },
    data: {
      fieldsJson: JSON.stringify({ fields: { topic: '规划层异步化' }, sources: { topic: 'ai_default' } }),
    },
  })
  await db.creativePlan.create({
    data: {
      contentId,
      selectedDirectionId: 'd-test',
      conceptJson: JSON.stringify({ directionId: 'd-test', name: '测试方向', oneLiner: '一条测试用的一句话故事' }),
    },
  })
}

describe('规划层入队语义与幂等防重', () => {
  it('PLANNING → startStoryDraft 入队 story.draft（payload 记录 actorId）', async () => {
    const { user, contentId } = await seedContentAt('PLANNING')
    const result = await planService.startStoryDraft(contentId, user.id)

    expect(result.alreadyRunning).toBe(false)
    const job = await db.generationJob.findUnique({ where: { id: result.jobId } })
    expect(job?.type).toBe('story.draft')
    expect(job?.status).toBe('queued')
    expect(JSON.parse(job?.inputJson ?? '{}')).toMatchObject({ contentId, actorId: user.id })
  })

  it('活跃 Job 期间重复提交 → 复用同一 jobId（不重复入队）', async () => {
    const { user, contentId } = await seedContentAt('PLANNING')
    const first = await planService.startStoryDraft(contentId, user.id)
    const second = await planService.startStoryDraft(contentId, user.id)

    expect(second.alreadyRunning).toBe(true)
    expect(second.jobId).toBe(first.jobId)
    const count = await db.generationJob.count({ where: { contentId } })
    expect(count).toBe(1)
  })

  it('退避中的重试 Job 也算活跃（轮询语义不断档，且不重复入队）', async () => {
    const { user, contentId } = await seedContentAt('PLANNING')
    const first = await planService.startStoryDraft(contentId, user.id)
    await jobService.fail(first.jobId, '暂时性错误') // → queued + 15s 退避

    const again = await planService.startStoryDraft(contentId, user.id)
    expect(again.alreadyRunning).toBe(true)
    expect(again.jobId).toBe(first.jobId)
  })
})

describe('状态守卫（与旧同步路由同语义）', () => {
  it('STORY 状态提交 startStoryDraft → DomainValidationError', async () => {
    const { user, contentId } = await seedContentAt('STORY')
    await expect(planService.startStoryDraft(contentId, user.id)).rejects.toThrow('先选定创作方向')
  })

  it('PLANNING 状态提交 startStoryboardPlan → DomainValidationError', async () => {
    const { user, contentId } = await seedContentAt('PLANNING')
    await expect(planService.startStoryboardPlan(contentId, user.id)).rejects.toThrow('先展开故事')
  })
})

describe('Job 执行的并发幂等与 fail-fast', () => {
  it('执行时状态已被另一副本推进 → 幂等 complete(skipped)，不报错不丢工作', async () => {
    const { user, contentId } = await seedContentAt('PLANNING')
    const { jobId } = await planService.startStoryDraft(contentId, user.id)
    // 模拟：另一个 Job 副本（租约过期重入队前的原副本）已完成推进
    await contentService.advanceStatus(contentId, 'STORY', user.id)

    await runOneTick()

    const after = await db.generationJob.findUnique({ where: { id: jobId } })
    expect(after?.status).toBe('succeeded')
    expect(JSON.parse(after?.outputJson ?? '{}')).toMatchObject({ stage: 'skipped' })
    // 不写失败标记（这不是失败，是幂等跳过）
    const content = await db.content.findUnique({ where: { id: contentId } })
    expect(content?.lastErrorJson).toBeNull()
    expect(content?.status).toBe('STORY')
  })

  it('STORY 但故事未写（工作副本缺失）→ storyboard.plan 确定性失败 + 用户可见指引', async () => {
    const { user, contentId } = await seedContentAt('STORY') // 没有 story 行
    await seedPlanPrerequisites(contentId)
    const { jobId } = await planService.startStoryboardPlan(contentId, user.id)

    await runOneTick()

    const after = await db.generationJob.findUnique({ where: { id: jobId } })
    expect(after?.status).toBe('failed')
    expect(after?.error).toContain('故事还没写')
  })
})
