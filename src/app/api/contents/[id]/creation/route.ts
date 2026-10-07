// GET /api/contents/:id/creation —— 创作空间聚合（/create/[id] 页面轮询的数据源）
// 返回：作品 + 意图 + 方向/Concept + 工作故事 + 活跃 Job 进度 + 视觉资产（分镜图/成片/封面）
import { getSessionUser, domainErrorToResponse } from '../../../_lib/session'
import { contentService } from '@/core/content/content-service'
import { intentService } from '@/core/intent/intent-service'
import { planService } from '@/core/planning/plan-service'
import { jobService, parseLastError } from '@/core/jobs/job-service'
import { assetService } from '@/core/assets/asset-service'
import { parseStructure } from '@/core/content/schemas'

function assetUrl(id: string): string {
  return `/api/assets/${id}`
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getSessionUser()
    const { content, isOwner } = await contentService.getOwnedOrVisibleContent(id, user?.id ?? null)

    // 意图
    const intentRow = await intentService.getIntent(id)
    const intentRecord = intentRow ? intentService.parseRecord(intentRow) : null

    // 方向与 Concept
    const planRow = await planService.getPlan(id)
    const directions = planRow ? planService.parseDirections(planRow) : null
    const concept = planRow ? planService.parseConcept(planRow) : null

    // 故事：工作副本优先，回退当前版本密封配方（remix/restore 场景）
    let story = await planService.getWorkingStory(id)
    if (!story && content.currentVersion?.structureJson) {
      story = parseStructure(content.currentVersion.structureJson).story ?? null
    }

    // 血缘（remix 起点展示）
    const remixOf = await contentService.getRemixLineage(id)

    // 活跃 Job 进度；无活跃 Job 时回查最近终态失败 Job（失败必须可见，不能无限「AI 生成中」）
    const activeJob = await jobService.activeJobForContent(id)
    let job: Record<string, unknown> | null = null
    if (activeJob) {
      const output = activeJob.outputJson ? (JSON.parse(activeJob.outputJson) as Record<string, unknown>) : {}
      job = {
        id: activeJob.id,
        type: activeJob.type,
        status: activeJob.status,
        retryCount: activeJob.retryCount,
        ...output,
      }
    } else {
      const failedJob = await jobService.latestFailedJobForContent(id)
      if (failedJob) {
        job = {
          id: failedJob.id,
          type: failedJob.type,
          status: failedJob.status,
          retryCount: failedJob.retryCount,
          error: failedJob.error ?? null,
          failedAt: failedJob.completedAt ?? failedJob.updatedAt,
        }
      }
    }

    // 失败标记（Job 永久失败 / 看门狗超时 / 入队失败 → 对用户可见的错误消息）
    const lastError = parseLastError(content.lastErrorJson)

    // 视觉资产（当前版本）
    const assets: Record<string, unknown> = { final: null, poster: null, shots: [] }
    const versionId = content.currentVersionId
    if (versionId) {
      const renderJob = await jobService.latestSucceededJob(id, versionId, 'video.render')
      if (renderJob?.outputJson) {
        const parsed = JSON.parse(renderJob.outputJson) as { finalAssetId?: string; posterAssetId?: string; durationMs?: number }
        if (parsed.finalAssetId) {
          assets.final = { url: assetUrl(parsed.finalAssetId), durationMs: parsed.durationMs ?? null }
        }
        if (parsed.posterAssetId) {
          assets.poster = { url: assetUrl(parsed.posterAssetId) }
        }
      }
      // 分镜图像（最近一次成功的 storyboard）
      const sbJob = await jobService.latestSucceededJob(id, versionId, 'video.storyboard')
      if (sbJob?.outputJson) {
        const parsed = JSON.parse(sbJob.outputJson) as {
          shotAssets?: Array<{ shotIndex: number; imageAssetId: string; ttsAssetId?: string }>
        }
        const entries = parsed.shotAssets ?? []
        const ids = entries.flatMap((e) => [e.imageAssetId, ...(e.ttsAssetId ? [e.ttsAssetId] : [])])
        const rows = await assetService.getByIds(ids)
        const byId = new Map(rows.map((r) => [r.id, r]))
        assets.shots = entries
          .sort((a, b) => a.shotIndex - b.shotIndex)
          .map((e) => ({
            shotIndex: e.shotIndex,
            imageUrl: byId.has(e.imageAssetId) ? assetUrl(e.imageAssetId) : null,
            audioUrl: e.ttsAssetId && byId.has(e.ttsAssetId) ? assetUrl(e.ttsAssetId) : null,
          }))
      }
    }

    // 当前版本摘要（用户语言层由前端字典处理）
    const version = content.currentVersion
      ? {
          number: content.currentVersion.versionNumber,
          changelog: content.currentVersion.changelog,
          createdAt: content.currentVersion.createdAt,
        }
      : null

    return Response.json({
      content: {
        id: content.id,
        title: content.title,
        status: content.status,
        visibility: content.visibility,
        remixPermission: content.remixPermission,
        updatedAt: content.updatedAt,
        owner: content.owner,
        isOwner,
        versionCount: content._count.versions,
        remixCount: content._count.remixSources,
      },
      intent: intentRow
        ? {
            rawExpression: intentRow.rawExpression,
            record: intentRecord,
          }
        : null,
      plan: { directions, concept },
      story,
      version,
      job,
      lastError: lastError
        ? { code: lastError.code, message: lastError.message, at: lastError.at, jobId: lastError.jobId ?? null }
        : null,
      assets,
      remixOf: remixOf
        ? {
            sourceContentId: remixOf.sourceContentId,
            sourceVersionId: remixOf.sourceVersionId,
          }
        : null,
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
