// Season Service（serial-season-027 §1/§6）——连续剧季规划的领域编排核心
// 架构（§87）：本模块零 AI 依赖——LLM 生成（generateSeasonBible）由 workers/pipeline-executor
//   调用后注入本服务落盘。职责边界：
//   1. startSeasonPlan：幂等入队 season.plan（计算型 Job，仿 revision.plan 范式）
//   2. prepareSeasonPlan：意图/方向守卫 + 分集几何编译（诚实拒绝 < 240s）
//   3. persistSeason：圣经落盘（anchorHash 冻结）→ 逐集孵化 Episode 行 + Episode Content
//      （Intent 合成 + Concept 预冻结 → 直达 PLANNING）——事务原子、幂等
//   4. seasonContextFor：剧集 Content → SeasonEpisodeContext（story.draft/storyboard.plan 注入用）
//   5. getSeasonView：季视图（集列表 + 各集状态——前端/轮询用）
// 设计纪律：
//   - 圣经一次生成一次落盘：episode 生成永远读同一份 bibleJson（字节一致——防飘逸 L1）
//   - 幂等：已有 Season 直接返回；persist 重复调用不重复孵化
//   - 诚实失败：非长片意图（< 240s）明确拒绝，不静默降级
import { db } from '@/lib/db'
import { DomainValidationError, NotFoundError } from '@/core/errors'
import { intentService } from '@/core/intent/intent-service'
import { planService } from '@/core/planning/plan-service'
import { jobService } from '@/core/jobs/job-service'
import { provenanceRepo } from '@/core/repositories/provenance-repo'
import {
  episodeSecHintFromExpression,
  planSeasonGeometry,
  type SeasonGeometry,
} from '@/core/content/season-geometry'
import {
  SeasonBibleSchema,
  anchorHashOf,
  type SeasonBible,
  type SeasonEpisodeContext,
} from '@/core/content/season-bible'

export interface SeasonPlanPreparation {
  geometry: SeasonGeometry
  anchorHash: string
}

export interface SeasonPlanOutcome {
  seasonId: string
  anchorHash: string
  geometry: SeasonGeometry
  bible: SeasonBible
  episodeContentIds: string[]
}

/** 幂等入队 season.plan（有活跃 Job 复用，有 Season 直接返回已完成语义） */
async function startSeasonPlan(contentId: string, actorId: string): Promise<{ jobId: string; alreadyRunning: boolean; alreadyPlanned: boolean }> {
  const content = await db.content.findUnique({ where: { id: contentId } })
  if (!content) throw new NotFoundError('作品', contentId)
  const existing = await db.season.findUnique({ where: { contentId } })
  if (existing) return { jobId: '', alreadyRunning: false, alreadyPlanned: true }

  const active = await db.generationJob.findFirst({
    where: { contentId, type: 'season.plan', status: { in: ['queued', 'claimed', 'running'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (active) return { jobId: active.id, alreadyRunning: true, alreadyPlanned: false }

  const job = await jobService.enqueue({
    contentId,
    versionId: content.currentVersionId,
    type: 'season.plan',
    payload: { contentId, versionId: content.currentVersionId, actorId },
  })
  return { jobId: job.id, alreadyRunning: false, alreadyPlanned: false }
}

/** 季规划前置（领域守卫）：意图/方向必须就绪；时长达分集量级；返回几何。
 *  幂等：已有 Season → 直接返回既有几何（执行器可短路）。 */
async function prepareSeasonPlan(contentId: string): Promise<SeasonPlanPreparation & { existing?: SeasonPlanOutcome }> {
  const record = await intentService.requireRecord(contentId)
  await planService.requireConcept(contentId)
  const master = await db.content.findUnique({ where: { id: contentId } })
  if (!master) throw new NotFoundError('作品', contentId)

  const existingRow = await db.season.findUnique({ where: { contentId }, include: { episodes: true } })
  if (existingRow) {
    const bible = SeasonBibleSchema.parse(JSON.parse(existingRow.bibleJson))
    const geometry: SeasonGeometry = {
      serial: true,
      totalSec: existingRow.totalSec,
      episodeCount: existingRow.episodeCount,
      episodeSec: existingRow.episodeSec,
      hintApplied: false,
    }
    return {
      geometry,
      anchorHash: existingRow.anchorHash,
      existing: {
        seasonId: existingRow.id,
        anchorHash: existingRow.anchorHash,
        geometry,
        bible,
        episodeContentIds: existingRow.episodes.map((e) => e.contentId),
      },
    }
  }

  const rawExpression = await intentService.requireRawExpression(contentId)
  const totalSec = record.fields.duration ?? 45
  const hint = episodeSecHintFromExpression(rawExpression)
  const geometry = planSeasonGeometry(totalSec, hint)
  if (!geometry.serial) {
    throw new DomainValidationError(`总时长 ${totalSec} 秒未达分集量级（需 ≥ 240 秒）——单集作品请走常规创作流程`)
  }
  return { geometry, anchorHash: '' }
}

/** 圣经落盘 + 剧集孵化（幂等事务：Season、Episode、Episode Content、Intent、CreativePlan 原子成组）。
 *  bible 由执行器生成后传入（领域层零 AI 依赖）。 */
async function persistSeason(
  contentId: string,
  input: { bible: SeasonBible; geometry: SeasonGeometry },
  actorId: string | null,
): Promise<SeasonPlanOutcome> {
  const { bible, geometry } = input
  const record = await intentService.requireRecord(contentId)
  const master = await db.content.findUnique({ where: { id: contentId } })
  if (!master) throw new NotFoundError('作品', contentId)
  const rawExpression = await intentService.requireRawExpression(contentId)
  const anchorHash = anchorHashOf(bible)

  const { seasonId, episodeContentIds } = await db.$transaction(async (tx) => {
    // 幂等：已有 Season（并发/重试）→ 不重复孵化
    const already = await tx.season.findUnique({ where: { contentId }, include: { episodes: true } })
    if (already) {
      return { seasonId: already.id, episodeContentIds: already.episodes.map((e) => e.contentId) }
    }

    const season = await tx.season.create({
      data: {
        contentId,
        bibleJson: JSON.stringify(bible),
        anchorHash,
        episodeCount: geometry.episodeCount,
        episodeSec: geometry.episodeSec,
        totalSec: geometry.totalSec,
      },
    })

    const created: string[] = []
    for (const ep of bible.episodes) {
      const content = await tx.content.create({
        data: {
          ownerId: master.ownerId,
          title: `第 ${ep.index + 1} 集 · ${ep.title}`,
          description: ep.synopsis,
          projectId: master.projectId,
          status: 'IDEA',
          contentType: 'episode',
        },
      })
      // 集意图（合成）：topic 含本集梗概与悬念语境；duration = 每集时长（镜头预算的正确目标）；
      //   人物/画幅/风格从主片意图继承——单集管线无需再走方向选择（concept 预冻结）
      const fields = {
        ...record.fields,
        topic: `连续剧第 ${ep.index + 1} 集「${ep.title}」：${ep.synopsis}`,
        duration: Math.round(geometry.episodeSec),
        format: 'episode',
        characters: bible.characters
          .filter((c) => ep.charactersUsed.includes(c.name))
          .map((c) => ({ name: c.name, description: c.description ?? c.wardrobe ?? '' })),
      }
      await tx.intent.create({
        data: {
          contentId: content.id,
          rawExpression: `${rawExpression}（分集 ${ep.index + 1}/${geometry.episodeCount}：${ep.synopsis}）`,
          fieldsJson: JSON.stringify({ fields, sources: { ...record.sources, duration: 'user' } }),
        },
      })
      // 集 Concept（预冻结）：方向 = 圣经本集大纲——观众只选一次方向（主片层），25 集不再问
      const directionId = `season-ep-${ep.index}`
      const conceptJson = {
        directionId,
        name: ep.title,
        oneLiner: ep.synopsis,
        emotion: ep.emotionBeat,
        visualDirection: bible.lookBook,
      }
      await tx.creativePlan.create({
        data: {
          contentId: content.id,
          directionsJson: JSON.stringify([
            { id: directionId, name: ep.title, oneLiner: ep.synopsis, emotion: ep.emotionBeat, visualDirection: bible.lookBook },
          ]),
          selectedDirectionId: directionId,
          conceptJson: JSON.stringify(conceptJson),
        },
      })
      await tx.episode.create({
        data: {
          seasonId: season.id,
          contentId: content.id,
          index: ep.index,
          title: ep.title,
          synopsis: ep.synopsis,
          cliffhanger: ep.cliffhanger,
        },
      })
      // 集状态推进：IDEA → PLANNING（intent + concept 已就绪，等 story.draft 入队）
      await tx.content.update({ where: { id: content.id }, data: { status: 'PLANNING' } })
      await provenanceRepo.append(tx, {
        contentId: content.id,
        actorType: 'system',
        actorId: actorId ?? 'system',
        eventType: 'episode_bootstrapped',
        payload: { seasonId: season.id, episodeIndex: ep.index, anchorHash, fromContentId: contentId },
      })
      created.push(content.id)
    }

    await provenanceRepo.append(tx, {
      contentId,
      actorType: 'system',
      actorId: actorId ?? 'system',
      eventType: 'season_planned',
      payload: {
        seasonId: season.id,
        anchorHash,
        episodeCount: geometry.episodeCount,
        episodeSec: geometry.episodeSec,
        totalSec: geometry.totalSec,
      },
    })
    return { seasonId: season.id, episodeContentIds: created }
  })

  return { seasonId, anchorHash, geometry, bible, episodeContentIds }
}

/** 剧集 Content → 集生成上下文（story.draft / storyboard.plan 注入；非剧集返回 undefined） */
async function seasonContextFor(contentId: string): Promise<SeasonEpisodeContext | undefined> {
  const content = await db.content.findUnique({ where: { id: contentId }, include: { episodeEntry: { include: { season: true } } } })
  const entry = content?.episodeEntry
  if (!entry) return undefined
  let bible: SeasonBible
  try {
    bible = SeasonBibleSchema.parse(JSON.parse(entry.season.bibleJson))
  } catch {
    return undefined // 圣经损坏：诚实缺席（不注入），单集路径照常可走
  }
  const episode = bible.episodes.find((e) => e.index === entry.index)
  if (!episode) return undefined
  const geometry: SeasonGeometry = {
    serial: true,
    totalSec: entry.season.totalSec,
    episodeCount: entry.season.episodeCount,
    episodeSec: entry.season.episodeSec,
    hintApplied: false,
  }
  return { bible, episode, geometry }
}

/** 季视图（集列表 + 各集状态——API/UI 用） */
async function getSeasonView(contentId: string) {
  const season = await db.season.findUnique({
    where: { contentId },
    include: {
      episodes: {
        orderBy: { index: 'asc' },
        include: { content: { select: { id: true, title: true, status: true, currentVersionId: true } } },
      },
    },
  })
  if (!season) return null
  return {
    seasonId: season.id,
    anchorHash: season.anchorHash,
    episodeCount: season.episodeCount,
    episodeSec: season.episodeSec,
    totalSec: season.totalSec,
    episodes: season.episodes.map((e) => ({
      index: e.index,
      title: e.title,
      synopsis: e.synopsis,
      cliffhanger: e.cliffhanger,
      contentId: e.contentId,
      status: e.content.status,
    })),
  }
}

export const seasonService = {
  startSeasonPlan,
  prepareSeasonPlan,
  persistSeason,
  seasonContextFor,
  getSeasonView,
}
