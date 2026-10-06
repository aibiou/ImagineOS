// Generation Job 服务（§52–§53 / T6.1.1 / T6.1.2）
// SQLite 环境的持久化队列：乐观锁 claim（UPDATE ... WHERE status='queued'，原子语义）
// 生命周期：queued → claimed → running → succeeded | failed | timeout
// 设计约束（接口按 BullMQ 语义设计，未来平移 Redis 队列是机械动作）：
//   - 绝不靠长 HTTP 请求维持生成（§53）
//   - 重试幂等：资产层 hash 去重（Asset 唯一 [hash, kind]）
//   - 崩溃恢复：lease 过期的 claimed/running Job 自动重新入队

import { db } from '@/lib/db'

export const JOB_STATUSES = ['queued', 'claimed', 'running', 'succeeded', 'failed', 'timeout'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export interface JobInput {
  contentId: string
  versionId: string | null
  actorId: string
  [key: string]: unknown
}

/** 各 Job 类型的租约时长（毫秒）——lease 内 worker 必须上报进度或完成 */
const LEASE_MS: Record<string, number> = {
  'video.storyboard': 30 * 60 * 1000,
  'video.render': 20 * 60 * 1000,
}
const DEFAULT_LEASE_MS = 15 * 60 * 1000

export const jobService = {
  async enqueue(input: { contentId: string; versionId: string | null; type: string; payload?: JobInput }) {
    return db.generationJob.create({
      data: {
        contentId: input.contentId,
        versionId: input.versionId,
        type: input.type,
        status: 'queued',
        inputJson: JSON.stringify(input.payload ?? {
          contentId: input.contentId,
          versionId: input.versionId,
          actorId: null,
        }),
      },
    })
  },

  /** 乐观锁 claim：UPDATE ... WHERE status='queued'，并发下只有一个 worker 得手 */
  async claimNext(): Promise<{ id: string; type: string; inputJson: string; contentId: string; versionId: string | null; retryCount: number } | null> {
    const candidates = await db.generationJob.findMany({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
      take: 5,
    })
    for (const candidate of candidates) {
      const lease = LEASE_MS[candidate.type] ?? DEFAULT_LEASE_MS
      const res = await db.generationJob.updateMany({
        where: { id: candidate.id, status: 'queued' },
        data: {
          status: 'claimed',
          claimedAt: new Date(),
          startedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + lease),
        },
      })
      if (res.count === 1) {
        return {
          id: candidate.id,
          type: candidate.type,
          inputJson: candidate.inputJson ?? '',
          contentId: candidate.contentId,
          versionId: candidate.versionId,
          retryCount: candidate.retryCount,
        }
      }
    }
    return null
  },

  markRunning(jobId: string): Promise<void> {
    void db.generationJob.updateMany({ where: { id: jobId }, data: { status: 'running' } }).then(() => {})
    return Promise.resolve()
  },

  /** 进度上报（同时续租，防 lease 误回收） */
  async reportProgress(jobId: string, progress: Record<string, unknown>): Promise<void> {
    const job = await db.generationJob.findUnique({ where: { id: jobId } })
    if (!job || (job.status !== 'claimed' && job.status !== 'running')) return
    const existing = job.outputJson ? (JSON.parse(job.outputJson) as Record<string, unknown>) : {}
    const lease = LEASE_MS[job.type] ?? DEFAULT_LEASE_MS
    await db.generationJob.update({
      where: { id: jobId },
      data: {
        outputJson: JSON.stringify({ ...existing, ...progress }),
        status: 'running',
        leaseExpiresAt: new Date(Date.now() + lease),
      },
    })
  },

  async complete(jobId: string, output: Record<string, unknown>): Promise<void> {
    const job = await db.generationJob.findUnique({ where: { id: jobId } })
    const existing = job?.outputJson ? (JSON.parse(job.outputJson) as Record<string, unknown>) : {}
    await db.generationJob.update({
      where: { id: jobId },
      data: {
        status: 'succeeded',
        completedAt: new Date(),
        outputJson: JSON.stringify({ ...existing, ...output }),
      },
    })
  },

  /** 失败：可重试 → 回队；不可重试/耗尽 → failed（用户工作无损，状态机不回滚） */
  async fail(jobId: string, error: string, opts?: { retryable?: boolean }): Promise<'requeued' | 'failed'> {
    const job = await db.generationJob.findUnique({ where: { id: jobId } })
    if (!job) return 'failed'
    const retryable = opts?.retryable ?? true
    if (retryable && job.retryCount < job.maxRetries) {
      await db.generationJob.update({
        where: { id: jobId },
        data: {
          status: 'queued',
          retryCount: job.retryCount + 1,
          error: error.slice(0, 1000),
          leaseExpiresAt: null,
        },
      })
      return 'requeued'
    }
    await db.generationJob.update({
      where: { id: jobId },
      data: { status: 'failed', error: error.slice(0, 1000), completedAt: new Date() },
    })
    return 'failed'
  },

  /** 崩溃恢复：lease 过期的 claimed/running → 重新入队或 timeout（T6.1.1 AC） */
  async requeueStale(now = new Date()): Promise<number> {
    const stale = await db.generationJob.findMany({
      where: {
        status: { in: ['claimed', 'running'] },
        leaseExpiresAt: { lt: now },
      },
      take: 20,
    })
    let count = 0
    for (const job of stale) {
      if (job.retryCount < job.maxRetries) {
        const res = await db.generationJob.updateMany({
          where: { id: job.id, status: job.status },
          data: { status: 'queued', retryCount: job.retryCount + 1, error: '租约过期（worker 崩溃或网络中断）' },
        })
        count += res.count
      } else {
        const res = await db.generationJob.updateMany({
          where: { id: job.id, status: job.status },
          data: { status: 'timeout', error: '租约过期且重试耗尽', completedAt: now },
        })
        count += res.count
      }
    }
    return count
  },

  /** 当前活跃 Job（生成进度轮询的数据源） */
  async activeJobForContent(contentId: string) {
    return db.generationJob.findFirst({
      where: { contentId, status: { in: ['queued', 'claimed', 'running'] } },
      orderBy: { createdAt: 'desc' },
    })
  },

  /** 最近一次完成的 storyboard job（render 阶段的镜头资产来源） */
  async latestSucceededJob(contentId: string, versionId: string | null, type: string) {
    return db.generationJob.findFirst({
      where: { contentId, type, status: 'succeeded', ...(versionId ? { versionId } : {}) },
      orderBy: { completedAt: 'desc' },
    })
  },

  async getJob(jobId: string) {
    return db.generationJob.findUnique({ where: { id: jobId } })
  },
}
