// 生成流编排（§63 主链的 GENERATING/RENDERING 段）
// 职责：密封配方 → 状态机推进 → Job 入队（HTTP 快速返回，§53 绝不长请求挂生成）
import { db } from '@/lib/db'
import { DomainValidationError, NotFoundError } from '@/core/errors'
import { contentRepo } from '@/core/repositories/content-repo'
import { versionRepo } from '@/core/repositories/version-repo'
import { contentService } from '@/core/content/content-service'
import { versionService } from '@/core/content/version-service'
import { planService } from '@/core/planning/plan-service'
import { jobService } from '@/core/jobs/job-service'
import { serializeStructure, type VersionStructureInput } from '@/core/content/schemas'

async function requireOwnedContent(contentId: string, actorId: string) {
  const content = await contentRepo.findById(db, contentId)
  if (!content) throw new NotFoundError('作品', contentId)
  if (content.ownerId !== actorId) throw new DomainValidationError('只有作者可以继续这个创作')
  return content
}

async function assertNoActiveJob(contentId: string) {
  const active = await jobService.activeJobForContent(contentId)
  if (active) throw new DomainValidationError('生成正在进行中，稍等它完成（也可以刷新查看进度）')
}

/** 合法路径推进到 GENERATING（READY→REVIEW→GENERATING / REVIEW→GENERATING / STORYBOARD→GENERATING） */
async function advanceToGenerating(contentId: string, actorId: string) {
  const content = await contentRepo.findById(db, contentId)
  if (!content) throw new NotFoundError('作品', contentId)
  switch (content.status) {
    case 'READY':
      await contentService.advanceStatus(contentId, 'REVIEW', actorId)
      await contentService.advanceStatus(contentId, 'GENERATING', actorId)
      return
    case 'REVIEW':
    case 'STORYBOARD':
      await contentService.advanceStatus(contentId, 'GENERATING', actorId)
      return
    case 'GENERATING':
      return
    default:
      throw new DomainValidationError(`当前阶段（${content.status}）不能开始生成`)
  }
}

export interface StartGenerationResult {
  versionId: string
  versionNumber: number
  jobId: string
  reusedVersion: boolean
}

export const generationFlow = {
  /**
   * 开始 AI 生成（STORYBOARD→GENERATING）
   * 配方密封规则：无版本 → 初版密封；结构变化 → 新版本（regenerate）；否则复用现版本
   */
  async startStoryboardGeneration(contentId: string, actorId: string): Promise<StartGenerationResult> {
    const content = await requireOwnedContent(contentId, actorId)
    if (content.status !== 'STORYBOARD') {
      throw new DomainValidationError(`只有分镜确认后才能开始生成（当前：${content.status}）`)
    }
    await assertNoActiveJob(contentId)

    const structure = await planService.buildVersionStructure(contentId)
    const sealed = serializeStructure(structure)

    const current = content.currentVersionId ? await versionRepo.findById(db, content.currentVersionId) : null
    let versionId: string
    let versionNumber: number
    let reusedVersion = false

    if (current && current.structureJson === sealed) {
      // 复用现版本（remix 后首次生成 / 重新生成）
      versionId = current.id
      versionNumber = current.versionNumber
      reusedVersion = true
    } else {
      const version = await versionService.createVersion(contentId, actorId, {
        method: current ? 'regenerate' : 'initial',
        changelog: current ? '调整了创作结构，重新生成' : '初稿配方',
        structure: structure as VersionStructureInput,
      })
      versionId = version.id
      versionNumber = version.versionNumber
    }

    await contentService.advanceStatus(contentId, 'GENERATING', actorId)
    const job = await jobService.enqueue({
      contentId,
      versionId,
      type: 'video.storyboard',
      payload: { contentId, versionId, actorId },
    })
    return { versionId, versionNumber, jobId: job.id, reusedVersion }
  },

  /** 渲染成片（REVIEW→RENDERING + 入队合成 Job） */
  async startRender(contentId: string, actorId: string): Promise<{ jobId: string }> {
    const content = await requireOwnedContent(contentId, actorId)
    if (content.status !== 'REVIEW') {
      throw new DomainValidationError(`只有预览满意后才能渲染成片（当前：${content.status}）`)
    }
    await assertNoActiveJob(contentId)
    const versionId = content.currentVersionId
    if (!versionId) throw new DomainValidationError('作品还没有可渲染的版本')

    await contentService.advanceStatus(contentId, 'RENDERING', actorId)
    const job = await jobService.enqueue({
      contentId,
      versionId,
      type: 'video.render',
      payload: { contentId, versionId, actorId },
    })
    return { jobId: job.id }
  },

  /** 重新生成（REVIEW/READY：同版本重跑画面+配音；T9.1.1 AC「重新生成→新 Job（同 Version）」） */
  async regenerate(contentId: string, actorId: string): Promise<StartGenerationResult> {
    const content = await requireOwnedContent(contentId, actorId)
    if (content.status !== 'REVIEW' && content.status !== 'READY') {
      throw new DomainValidationError(`只有预览或就绪状态才能重新生成（当前：${content.status}）`)
    }
    await assertNoActiveJob(contentId)
    const versionId = content.currentVersionId
    if (!versionId) throw new DomainValidationError('作品还没有可生成的版本')
    const version = await versionRepo.findById(db, versionId)
    if (!version) throw new NotFoundError('版本', versionId)

    await advanceToGenerating(contentId, actorId)
    const job = await jobService.enqueue({
      contentId,
      versionId,
      type: 'video.storyboard',
      payload: { contentId, versionId, actorId },
    })
    return { versionId, versionNumber: version.versionNumber, jobId: job.id, reusedVersion: true }
  },

  /**
   * 应用修订（修订定位器输出 + 新版本 + 重跑生成）
   * 「修订 = 新 ContentVersion（永不覆盖）+ 受影响部分重生成」（§24）
   */
  async applyRevision(
    contentId: string,
    actorId: string,
    input: { structure: VersionStructureInput; changelog: string },
  ): Promise<StartGenerationResult> {
    const content = await requireOwnedContent(contentId, actorId)
    if (content.status !== 'REVIEW' && content.status !== 'READY' && content.status !== 'STORYBOARD') {
      throw new DomainValidationError(`当前阶段（${content.status}）不支持修改后重新生成`)
    }
    await assertNoActiveJob(contentId)

    const version = await versionService.createVersion(contentId, actorId, {
      method: 'revision',
      changelog: input.changelog,
      structure: input.structure,
    })

    await advanceToGenerating(contentId, actorId)
    const job = await jobService.enqueue({
      contentId,
      versionId: version.id,
      type: 'video.storyboard',
      payload: { contentId, versionId: version.id, actorId },
    })
    return { versionId: version.id, versionNumber: version.versionNumber, jobId: job.id, reusedVersion: false }
  },
}
