// Job 重试策略（gate7-product-hardening-008，2026-10-07）
// 实证缺陷一：前置条件错误（配方无镜头）被无差别重试 3 轮、1 秒内耗尽（2026-10-07 08:31 门禁期间，
//   worker 真实执行测试遗留 job）→ NonRetryableJobError fail-fast：一次终态 + 用户可见指引
// 实证缺陷二：重试无退避，失败回队立即可被再认领 → fail() 回队带递增退避（15s/30s/45s），
//   claimNext 过滤退避窗口；退避中的 queued Job 仍是「活跃 Job」（进度轮询语义不变）
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { jobService, parseLastError, RETRY_BACKOFF_BASE_MS } from '@/core/jobs/job-service'
import { versionService } from '@/core/content/version-service'
import { runOneTick } from '../workers/generation-worker'

// 队列卫生：前置测试文件（generation-failure 等）会遗留 queued Job（生产库时代由 dev worker
// 消化——即 08:31 实证的那个风险；测试库无 worker，必须自行清理，否则 claimNext 抢到别家 Job）
beforeEach(async () => {
  await db.generationJob.deleteMany({ where: { status: { in: ['queued', 'claimed'] } } })
})

async function seedEmptyShotContent() {
  const { user } = await userRepo.createSessionUser(db)
  const c = await contentService.startCreation({ ownerId: user.id, text: '重试策略走查' })
  for (const to of ['INTENT', 'PLANNING', 'STORY', 'STORYBOARD'] as const) {
    await contentService.advanceStatus(c.id, to, user.id)
  }
  // 配方有版本但零镜头（分镜未完成的真实竞态形态——与 2026-10-07 08:31 线上一致）
  await versionService.createVersion(c.id, user.id, {
    method: 'initial',
    changelog: '空配方（无镜头）',
    structure: { story: { scenes: [] } } as never,
  })
  return { user, content: (await db.content.findUnique({ where: { id: c.id } }))! }
}

describe('确定性失败 fail-fast（NonRetryableJobError 不烧重试）', () => {
  it('配方中没有镜头 → runOneTick 一次即终态 failed，retryCount 归零，用户看到指引', async () => {
    const { content } = await seedEmptyShotContent()
    await contentService.advanceStatus(content.id, 'GENERATING', 'owner')
    const job = await jobService.enqueue({ contentId: content.id, versionId: content.currentVersionId, type: 'video.storyboard' })

    await runOneTick()

    const after = await db.generationJob.findUnique({ where: { id: job.id } })
    expect(after?.status).toBe('failed') // 不是 queued（requeued）
    expect(after?.retryCount).toBe(0) // 未消耗任何重试额度
    expect(after?.error).toContain('先完成分镜')

    const marker = parseLastError((await db.content.findUnique({ where: { id: content.id } }))?.lastErrorJson ?? null)
    expect(marker?.code).toBe('generation_failed')
    expect(marker?.message).toContain('先完成分镜')
    expect(marker?.jobId).toBe(job.id)
  })

  it('未知 Job 类型 → 确定性终态（不重试）', async () => {
    const { content } = await seedEmptyShotContent()
    const job = await jobService.enqueue({ contentId: content.id, versionId: null, type: 'video.nonsense' })

    await runOneTick()

    const after = await db.generationJob.findUnique({ where: { id: job.id } })
    expect(after?.status).toBe('failed')
    expect(after?.retryCount).toBe(0)
    expect(after?.error).toContain('未知 Job 类型')
  })
})

describe('可重试失败回队退避（防重试风暴）', () => {
  it('fail() 回队 → leaseExpiresAt 约 +15s；退避窗口内 claimNext 不认领；窗口过后可认领', async () => {
    const { content } = await seedEmptyShotContent()
    const job = await jobService.enqueue({ contentId: content.id, versionId: null, type: 'video.storyboard' })

    const outcome = await jobService.fail(job.id, '暂时性网络错误')
    expect(outcome).toBe('requeued')

    const requeued = await db.generationJob.findUnique({ where: { id: job.id } })
    expect(requeued?.status).toBe('queued')
    expect(requeued?.leaseExpiresAt).toBeTruthy()
    const delta = requeued!.leaseExpiresAt!.getTime() - Date.now()
    expect(delta).toBeGreaterThan(RETRY_BACKOFF_BASE_MS - 2_000)
    expect(delta).toBeLessThan(RETRY_BACKOFF_BASE_MS + 2_000)

    // 退避窗口内：不认领（修复前此处会立即被 claim → 1 秒烧完 3 轮重试）
    expect(await jobService.claimNext()).toBeNull()

    // 窗口过后：可认领
    await db.generationJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1_000) } })
    const claimed = await jobService.claimNext()
    expect(claimed?.id).toBe(job.id)
    expect(claimed?.retryCount).toBe(1)
  })

  it('退避中的 queued Job 仍是「活跃 Job」（进度轮询语义不变，用户不会看到闪断）', async () => {
    const { content } = await seedEmptyShotContent()
    const job = await jobService.enqueue({ contentId: content.id, versionId: null, type: 'video.storyboard' })
    await jobService.fail(job.id, '暂时性错误')

    const active = await jobService.activeJobForContent(content.id)
    expect(active?.id).toBe(job.id)
  })
})
