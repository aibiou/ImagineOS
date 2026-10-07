// Generation Job 服务（§52–§53 / T6.1.1 / T6.1.2）
// SQLite 环境的持久化队列：乐观锁 claim（UPDATE ... WHERE status='queued'，原子语义）
// 生命周期：queued → claimed → running → succeeded | failed | timeout
// 设计约束（接口按 BullMQ 语义设计，未来平移 Redis 队列是机械动作）：
//   - 绝不靠长 HTTP 请求维持生成（§53）
//   - 重试幂等：资产层 hash 去重（Asset 唯一 [hash, kind]）
//   - 崩溃恢复：lease 过期的 claimed/running Job 自动重新入队
// 失败可见性铁律（Gate 7 线上缺陷修复，2026-10-07）：
//   - Job 永久失败/超时 → 必须写 Content.lastErrorJson（§51 的另一半，此前从未实现）
//   - 新 Job 入队 → 清除 lastErrorJson（重试重置失败态）
//   - 孤儿看门狗：GENERATING/RENDERING 无活跃 Job 且超时 → 标记错误，永不无限转圈

import { db } from '@/lib/db'

export const JOB_STATUSES = ['queued', 'claimed', 'running', 'succeeded', 'failed', 'timeout'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export interface JobInput {
  contentId: string
  versionId: string | null
  actorId: string
  [key: string]: unknown
}

/** 孤儿看门狗默认阈值：GENERATING/RENDERING 无活跃 Job 超过该时长即标记失败（可用 env 覆盖） */
export const WATCHDOG_STALE_MS = Number(process.env.IMAGINEOS_WATCHDOG_STALE_MIN ?? 10) * 60 * 1000

export interface GenerationErrorMarker {
  code: 'generation_failed' | 'generation_timeout' | 'enqueue_failed'
  message: string
  jobId?: string
  at: string
}

/** 生成模式（真实产物路径，对用户可见——防止把 Ken Burns 合成误认为 AI 视频模型产物）：
 *  - composition：全部镜头为「生成图像 + 运镜合成」（零 video.shot 资产）
 *  - native     ：全部镜头为 AI 视频模型产物（每镜都有 videoAssetId）
 *  - hybrid     ：部分镜头 native、其余回落 composition（native-fallback 的诚实形态）
 */
export type GenerationMode = 'composition' | 'native' | 'hybrid'

export interface GenerationModeInfo {
  mode: GenerationMode
  nativeShots: number
  totalShots: number
}

/** 由 storyboard Job 的 outputJson 计算生成模式（纯函数，脏容错：无记录/坏 JSON → null） */
export function computeGenerationMode(outputJson: string | null | undefined): GenerationModeInfo | null {
  if (!outputJson) return null
  try {
    const parsed = JSON.parse(outputJson) as {
      shotAssets?: Array<{ shotIndex: number; imageAssetId: string; videoAssetId?: string }>
    }
    const entries = parsed.shotAssets
    if (!Array.isArray(entries) || entries.length === 0) return null
    const nativeShots = entries.filter((e) => Boolean(e.videoAssetId)).length
    const totalShots = entries.length
    const mode: GenerationMode = nativeShots === 0 ? 'composition' : nativeShots === totalShots ? 'native' : 'hybrid'
    return { mode, nativeShots, totalShots }
  } catch {
    return null
  }
}

/** 解析 Content.lastErrorJson（脏容错：坏 JSON 返回 null） */
export function parseLastError(raw: string | null | undefined): GenerationErrorMarker | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<GenerationErrorMarker>
    if (!parsed.code || !parsed.message) return null
    return { code: parsed.code, message: parsed.message, jobId: parsed.jobId, at: parsed.at ?? '' }
  } catch {
    return null
  }
}

/** 写入失败标记（不推进状态机位置，§51 不丢用户工作；错误对用户可见） */
async function markGenerationError(contentId: string, marker: GenerationErrorMarker, jobId?: string): Promise<void> {
  await db.content.update({
    where: { id: contentId },
    data: { lastErrorJson: JSON.stringify(marker) },
  })
  await db.provenance.create({
    data: {
      contentId,
      versionId: null,
      eventType: 'generation_failed',
      actorType: 'system',
      actorId: null,
      provider: 'pipeline',
      model: null,
      payloadJson: JSON.stringify({ ...marker, jobId: jobId ?? marker.jobId ?? null }),
    },
  }).catch(() => {
    // 溯源失败不阻塞错误标记本身（可诊断性优先）
  })
}

/** 各 Job 类型的租约时长（毫秒）——lease 内 worker 必须上报进度或完成 */
const LEASE_MS: Record<string, number> = {
  'video.storyboard': 30 * 60 * 1000,
  'video.render': 20 * 60 * 1000,
}
const DEFAULT_LEASE_MS = 15 * 60 * 1000

export const jobService = {
  async enqueue(input: { contentId: string; versionId: string | null; type: string; payload?: JobInput }) {
    const job = await db.generationJob.create({
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
    // 新 Job 入队 = 用户重试：清除历史失败标记（失败态复位）
    await db.content.updateMany({
      where: { id: input.contentId, lastErrorJson: { not: null } },
      data: { lastErrorJson: null },
    }).catch(() => {})
    return job
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

  /** 失败：可重试 → 回队；不可重试/耗尽 → failed + Content 失败标记（错误必须对用户可见） */
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
    // 永久失败 → 传导到 Content（修复前：Job failed 但作品永远停在 GENERATING 转圈）
    await markGenerationError(
      job.contentId,
      { code: 'generation_failed', message: error.slice(0, 500), jobId, at: new Date().toISOString() },
      jobId,
    ).catch(() => {})
    return 'failed'
  },

  /** 崩溃恢复：lease 过期的 claimed/running → 重新入队或 timeout（T6.1.1 AC）；timeout 同步标记 Content */
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
        if (res.count === 1) {
          await markGenerationError(
            job.contentId,
            { code: 'generation_timeout', message: '生成超时（服务暂时不可用），你的创作没有丢，点「重新生成」再试一次。', jobId: job.id, at: now.toISOString() },
            job.id,
          ).catch(() => {})
        }
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

  /** 最近一次终态失败 Job（failed/timeout，无活跃 Job 时向用户展示失败原因） */
  async latestFailedJobForContent(contentId: string) {
    return db.generationJob.findFirst({
      where: { contentId, status: { in: ['failed', 'timeout'] } },
      orderBy: { createdAt: 'desc' },
    })
  },

  /**
   * 孤儿看门狗（Gate 7 修复核心）：
   * GENERATING/RENDERING 且无任何活跃 Job 且无失败标记、静默超过阈值 → 写入超时标记。
   * 覆盖：enqueue 失败 / 入队前异常 / 任何未来遗漏路径 / 存量脏数据。
   * 幂等：已有 lastErrorJson 的作品跳过；有活跃 Job 的跳过。
   */
  async sweepOrphanedGenerations(staleMs: number = WATCHDOG_STALE_MS, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - staleMs)
    const orphans = await db.content.findMany({
      where: {
        status: { in: ['GENERATING', 'RENDERING'] },
        lastErrorJson: null,
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
      take: 50,
    })
    let marked = 0
    for (const content of orphans) {
      const active = await db.generationJob.count({
        where: { contentId: content.id, status: { in: ['queued', 'claimed', 'running'] } },
      })
      if (active > 0) continue // 有活跃 Job：交给 lease/requeueStale 机制
      await markGenerationError(
        content.id,
        { code: 'generation_timeout', message: '生成长时间没有进展（可能遇到服务中断），你的创作没有丢，点「重新生成」再试一次。', at: now.toISOString() },
      )
      marked++
    }
    return marked
  },

  /** 最近一次完成的 storyboard job（render 阶段的镜头资产来源） */
  async latestSucceededJob(contentId: string, versionId: string | null, type: string) {
    return db.generationJob.findFirst({
      where: { contentId, type, status: 'succeeded', ...(versionId ? { versionId } : {}) },
      orderBy: { completedAt: 'desc' },
    })
  },

  /** 单作品生成模式（最近成功 storyboard 的真实产物路径；无生成记录 → null） */
  async generationModeForContent(contentId: string): Promise<GenerationModeInfo | null> {
    const job = await db.generationJob.findFirst({
      where: { contentId, type: 'video.storyboard', status: 'succeeded' },
      orderBy: { completedAt: 'desc' },
    })
    return computeGenerationMode(job?.outputJson)
  },

  /** 批量生成模式（列表页用；一次查询，内存分组——作品列表量级 << 千，无需聚合下推） */
  async generationModesForContents(
    list: Array<{ id: string; currentVersionId: string | null }>,
  ): Promise<Map<string, GenerationModeInfo | null>> {
    const out = new Map<string, GenerationModeInfo | null>()
    if (list.length === 0) return out
    const jobs = await db.generationJob.findMany({
      where: { contentId: { in: list.map((c) => c.id) }, type: 'video.storyboard', status: 'succeeded' },
      orderBy: { completedAt: 'desc' },
      select: { contentId: true, versionId: true, outputJson: true, completedAt: true },
    })
    const byContent = new Map<string, Array<{ versionId: string | null; outputJson: string | null }>>()
    for (const job of jobs) {
      const arr = byContent.get(job.contentId) ?? []
      arr.push({ versionId: job.versionId, outputJson: job.outputJson })
      byContent.set(job.contentId, arr)
    }
    for (const content of list) {
      const candidates = byContent.get(content.id) ?? []
      // 优先当前版本的产物；无则最近一次（历史版本也是真实生成记录）
      const chosen =
        candidates.find((j) => j.versionId && j.versionId === content.currentVersionId) ?? candidates[0]
      out.set(content.id, computeGenerationMode(chosen?.outputJson))
    }
    return out
  },

  async getJob(jobId: string) {
    return db.generationJob.findUnique({ where: { id: jobId } })
  },
}
