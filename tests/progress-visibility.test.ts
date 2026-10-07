// 生成进度渐进可见（gate7-blackbox-fix-009，2026-10-07 用户反馈「怎么黑盒的」）
// 背景：storyboard 生成中（native-first 下 60–250s/镜，全程 5–20 分钟）前端只见黑色占位格——
//   reportProgress 只报 {current,total,label}，已完成镜头资产不在载荷里，API 也不透出。
// 修复语义（本文件锁定）：
//   1. reportProgress 携带 shotAssets 快照 → 持久化到 outputJson
//   2. 后续 reportProgress 不带 shotAssets（如 narration 阶段）→ 浅合并不丢已上报资产
//   3. fail() 可重试回队 → outputJson 保留（重试期间已见图片不消失，轮询不闪断）
//   4. complete() 全量 shotAssets 覆盖（终态含 videoAssetId/ttsAssetId 完整形态）
import { describe, expect, it, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { jobService } from '@/core/jobs/job-service'

beforeEach(async () => {
  await db.generationJob.deleteMany({ where: { status: { in: ['queued', 'claimed'] } } })
})

async function seedRunningStoryboardJob() {
  const { user } = await userRepo.createSessionUser(db)
  const c = await contentService.startCreation({ ownerId: user.id, text: '渐进可见走查' })
  for (const to of ['INTENT', 'PLANNING', 'STORY', 'STORYBOARD', 'GENERATING'] as const) {
    await contentService.advanceStatus(c.id, to, user.id)
  }
  const job = await jobService.enqueue({ contentId: c.id, versionId: null, type: 'video.storyboard' })
  // reportProgress 仅在 claimed/running 态生效（queued 会被忽略）——模拟 worker 已认领
  await db.generationJob.update({ where: { id: job.id }, data: { status: 'running' } })
  return job
}

const readOutput = async (jobId: string) => {
  const job = await db.generationJob.findUnique({ where: { id: jobId } })
  return job?.outputJson ? (JSON.parse(job.outputJson) as Record<string, unknown>) : {}
}

describe('storyboard 生成进度渐进可见', () => {
  it('图片资产入进度快照 → outputJson 持久化（前端轮询即可渲染）', async () => {
    const job = await seedRunningStoryboardJob()
    await jobService.reportProgress(job.id, {
      stage: 'images', current: 0, total: 5, label: '正在生成 AI 视频镜头（0/5）…',
      shotAssets: [{ shotIndex: 0, imageAssetId: 'ast_img_0' }],
    })
    const out = await readOutput(job.id)
    expect(out.shotAssets).toEqual([{ shotIndex: 0, imageAssetId: 'ast_img_0' }])
    expect(out.label).toContain('AI 视频')
  })

  it('native 视频后到补齐 → 快照含 videoAssetId；后续不带 shotAssets 的上报浅合并不丢', async () => {
    const job = await seedRunningStoryboardJob()
    await jobService.reportProgress(job.id, {
      shotAssets: [{ shotIndex: 0, imageAssetId: 'ast_img_0', videoAssetId: 'ast_vid_0' }],
    })
    // narration 阶段上报不带 shotAssets —— 已见资产必须保留（黑盒回归防护）
    await jobService.reportProgress(job.id, { stage: 'narration', current: 2, total: 5, label: '正在为镜头配音…' })
    const out = await readOutput(job.id)
    expect(out.shotAssets).toEqual([{ shotIndex: 0, imageAssetId: 'ast_img_0', videoAssetId: 'ast_vid_0' }])
    expect(out.stage).toBe('narration')
  })

  it('可重试失败回队 → outputJson 保留（重试期间已见图片不消失）', async () => {
    const job = await seedRunningStoryboardJob()
    await jobService.reportProgress(job.id, {
      stage: 'images', current: 1, total: 5,
      shotAssets: [{ shotIndex: 0, imageAssetId: 'ast_img_0' }],
    })
    const outcome = await jobService.fail(job.id, '暂时性网络错误')
    expect(outcome).toBe('requeued')
    const out = await readOutput(job.id)
    expect(out.shotAssets).toEqual([{ shotIndex: 0, imageAssetId: 'ast_img_0' }])
  })

  it('complete() 全量覆盖 → 终态含完整 shotAssets（videoAssetId/ttsAssetId）', async () => {
    const job = await seedRunningStoryboardJob()
    await jobService.reportProgress(job.id, {
      shotAssets: [{ shotIndex: 0, imageAssetId: 'ast_img_0' }],
    })
    await jobService.complete(job.id, {
      stage: 'done', shots: 2,
      shotAssets: [
        { shotIndex: 0, imageAssetId: 'ast_img_0', videoAssetId: 'ast_vid_0', ttsAssetId: 'ast_tts_0' },
        { shotIndex: 1, imageAssetId: 'ast_img_1' },
      ],
    })
    const out = await readOutput(job.id)
    expect(out.shotAssets).toHaveLength(2)
    expect(out.shotAssets).toEqual([
      { shotIndex: 0, imageAssetId: 'ast_img_0', videoAssetId: 'ast_vid_0', ttsAssetId: 'ast_tts_0' },
      { shotIndex: 1, imageAssetId: 'ast_img_1' },
    ])
    const after = await db.generationJob.findUnique({ where: { id: job.id } })
    expect(after?.status).toBe('succeeded')
  })
})
