// 生成失败可见性铁律（Gate 7 线上缺陷回归测试，2026-10-07）
// 背景：Job 永久失败（provider 429 重试耗尽）后 Content 永远停在 GENERATING、
// job=null、lastErrorJson 空——真实用户无限「AI 生成中」。
// 铁律：任何异常必须 FAILED + error message；不能永久停留 GENERATING；看门狗兜底。
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { jobService, parseLastError } from '@/core/jobs/job-service'
import { generationFlow } from '@/core/content/generation-flow'
import { versionService } from '@/core/content/version-service'
import { planService } from '@/core/planning/plan-service'

async function seedGeneratingContent(withVersion = true) {
  const { user } = await userRepo.createSessionUser(db)
  const c = await contentService.startCreation({ ownerId: user.id, text: '失败可见性走查' })
  for (const to of ['INTENT', 'PLANNING', 'STORY', 'STORYBOARD'] as const) {
    await contentService.advanceStatus(c.id, to, user.id)
  }
  if (withVersion) {
    await versionService.createVersion(c.id, user.id, {
      method: 'initial',
      changelog: '初稿配方',
      structure: (await planService.buildVersionStructure(c.id)) as never,
    })
    return { user, content: (await db.content.findUnique({ where: { id: c.id } }))! }
  }
  return { user, content: c }
}

function readLastError(raw: string | null) {
  return parseLastError(raw)
}

describe('Job 永久失败 → 失败传导到 Content（FAILED + error message）', () => {
  it('fail() 重试耗尽 → Content.lastErrorJson 写入 + generation_failed 溯源事件', async () => {
    const { content } = await seedGeneratingContent()
    await contentService.advanceStatus(content.id, 'GENERATING', 'owner')
    const job = await jobService.enqueue({ contentId: content.id, versionId: null, type: 'video.storyboard', payload: { contentId: content.id, versionId: null, actorId: 'tester' } })

    // 3 轮可重试失败 → requeued；第 4 轮耗尽 → failed + 传导
    let outcome: 'requeued' | 'failed' = 'requeued'
    for (let i = 0; i < 4; i++) {
      outcome = await jobService.fail(job.id, '[ModelRouter] 能力 image.shot 的全部候选 Provider 失败：zai-image(429)')
    }
    expect(outcome).toBe('failed')

    const after = await db.content.findUnique({ where: { id: content.id } })
    const marker = readLastError(after?.lastErrorJson ?? null)
    expect(marker?.code).toBe('generation_failed')
    expect(marker?.message).toContain('image.shot')
    expect(marker?.jobId).toBe(job.id)

    const events = await db.provenance.findMany({ where: { contentId: content.id, eventType: 'generation_failed' } })
    expect(events).toHaveLength(1)
    // 状态机位置保持（§51 不丢用户工作）
    expect(after?.status).toBe('GENERATING')
  })

  it('fail() 可重试 → 回队且不写失败标记', async () => {
    const { content } = await seedGeneratingContent()
    const job = await jobService.enqueue({ contentId: content.id, versionId: null, type: 'video.storyboard' })
    const outcome = await jobService.fail(job.id, '暂时性错误')
    expect(outcome).toBe('requeued')
    const after = await db.content.findUnique({ where: { id: content.id } })
    expect(after?.lastErrorJson).toBeNull()
  })

  it('requeueStale() timeout 分支 → 同步标记 Content 超时', async () => {
    const { content } = await seedGeneratingContent()
    await contentService.advanceStatus(content.id, 'GENERATING', 'owner')
    const job = await jobService.enqueue({ contentId: content.id, versionId: null, type: 'video.storyboard' })
    // 直接构造已耗尽重试 + 租约过期的 running 态
    const past = new Date(Date.now() - 60_000)
    await db.generationJob.update({
      where: { id: job.id },
      data: { status: 'running', retryCount: 3, leaseExpiresAt: past },
    })
    await jobService.requeueStale()
    const jobAfter = await db.generationJob.findUnique({ where: { id: job.id } })
    expect(jobAfter?.status).toBe('timeout')
    const marker = readLastError((await db.content.findUnique({ where: { id: content.id } }))?.lastErrorJson ?? null)
    expect(marker?.code).toBe('generation_timeout')
  })
})

describe('重试重置：新 Job 入队清除失败标记', () => {
  it('enqueue() 后 lastErrorJson 复位为 null', async () => {
    const { content } = await seedGeneratingContent()
    await contentService.advanceStatus(content.id, 'GENERATING', 'owner')
    const job = await jobService.enqueue({ contentId: content.id, versionId: null, type: 'video.storyboard' })
    await jobService.fail(job.id, 'x', { retryable: false })
    expect(readLastError((await db.content.findUnique({ where: { id: content.id } }))?.lastErrorJson ?? null)?.code).toBe('generation_failed')

    await jobService.enqueue({ contentId: content.id, versionId: null, type: 'video.storyboard' })
    expect((await db.content.findUnique({ where: { id: content.id } }))?.lastErrorJson).toBeNull()
  })
})

describe('孤儿看门狗 sweepOrphanedGenerations（不能永久停留 GENERATING）', () => {
  it('静默超时 + 无活跃 Job → 标记 generation_timeout', async () => {
    const { content } = await seedGeneratingContent()
    await contentService.advanceStatus(content.id, 'GENERATING', 'owner')
    // 把 updatedAt 拨回 1 小时前（模拟孤儿）
    await db.content.update({ where: { id: content.id }, data: { updatedAt: new Date(Date.now() - 3600_000) } })

    const marked = await jobService.sweepOrphanedGenerations()
    expect(marked).toBeGreaterThanOrEqual(1)
    const marker = readLastError((await db.content.findUnique({ where: { id: content.id } }))?.lastErrorJson ?? null)
    expect(marker?.code).toBe('generation_timeout')
    expect(marker?.message).toContain('重新生成')
  })

  it('有活跃 Job（queued）的 GENERATING 不被误标', async () => {
    const { content } = await seedGeneratingContent()
    await contentService.advanceStatus(content.id, 'GENERATING', 'owner')
    await jobService.enqueue({ contentId: content.id, versionId: null, type: 'video.storyboard' })
    await db.content.update({ where: { id: content.id }, data: { updatedAt: new Date(Date.now() - 3600_000) } })

    await jobService.sweepOrphanedGenerations()
    expect((await db.content.findUnique({ where: { id: content.id } }))?.lastErrorJson).toBeNull()
  })

  it('未超时的 GENERATING 不被标记；已标记的幂等跳过', async () => {
    const { content } = await seedGeneratingContent()
    await contentService.advanceStatus(content.id, 'GENERATING', 'owner')
    await db.content.update({ where: { id: content.id }, data: { updatedAt: new Date(Date.now() - 60_000) } })

    await jobService.sweepOrphanedGenerations()
    expect((await db.content.findUnique({ where: { id: content.id } }))?.lastErrorJson).toBeNull()

    // 超时标记后再扫不重复计数
    await db.content.update({ where: { id: content.id }, data: { updatedAt: new Date(Date.now() - 3600_000) } })
    await jobService.sweepOrphanedGenerations()
    const first = readLastError((await db.content.findUnique({ where: { id: content.id } }))?.lastErrorJson ?? null)
    expect(first?.code).toBe('generation_timeout')
    const events = await db.provenance.count({ where: { contentId: content.id, eventType: 'generation_failed' } })
    await jobService.sweepOrphanedGenerations()
    const eventsAfter = await db.provenance.count({ where: { contentId: content.id, eventType: 'generation_failed' } })
    expect(eventsAfter).toBe(events) // 幂等
  })
})

describe('regenerate 从失败 GENERATING 恢复（端到端）', () => {
  it('GENERATING + 无活跃 Job + 失败标记 → regenerate 成功入队并清错', async () => {
    const { user, content } = await seedGeneratingContent()
    await contentService.advanceStatus(content.id, 'GENERATING', user.id)
    const job = await jobService.enqueue({ contentId: content.id, versionId: content.currentVersionId, type: 'video.storyboard' })
    await jobService.fail(job.id, '[ModelRouter] 全部候选 Provider 失败', { retryable: false })

    const result = await generationFlow.regenerate(content.id, user.id)
    expect(result.jobId).toBeTruthy()
    const active = await jobService.activeJobForContent(content.id)
    expect(active?.id).toBe(result.jobId)
    expect((await db.content.findUnique({ where: { id: content.id } }))?.lastErrorJson).toBeNull()
  })

  it('startRender 支持从卡死的 RENDERING（无活跃 Job）重试', async () => {
    const { user, content } = await seedGeneratingContent()
    for (const to of ['GENERATING', 'REVIEW', 'RENDERING'] as const) {
      await contentService.advanceStatus(content.id, to, user.id)
    }
    const result = await generationFlow.startRender(content.id, user.id)
    expect(result.jobId).toBeTruthy()
    const after = await db.content.findUnique({ where: { id: content.id } })
    expect(after?.status).toBe('RENDERING') // 不重复推进，但新 Job 已入队
  })
})
