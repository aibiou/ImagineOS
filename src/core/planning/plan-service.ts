// Creative Plan 持久化服务（§18–§19）
// 工作副本语义：Story/Scene/Shot 表是创作过程中的可编辑工作区；
// 进入生成（GENERATING）前，配方密封进 ContentVersion.structureJson（不可变快照）。
import { db, SQLITE_TX_TIMEOUT } from '@/lib/db'
import { DomainValidationError, NotFoundError } from '@/core/errors'
import { contentRepo } from '@/core/repositories/content-repo'
import { provenanceRepo } from '@/core/repositories/provenance-repo'
import { versionRepo } from '@/core/repositories/version-repo'
import { contentService } from '@/core/content/content-service'
import {
  CreativeDirectionSchema,
  type CreativeDirection,
  type StorySnapshot,
  type VersionStructure,
  type VersionStructureInput,
} from '@/core/content/schemas'
import { z } from 'zod'

const DirectionsPayloadSchema = z.object({
  directions: z.array(CreativeDirectionSchema).min(2).max(4),
})

export const planService = {
  async getPlan(contentId: string) {
    return db.creativePlan.findFirst({ where: { contentId }, orderBy: { createdAt: 'asc' } })
  },

  parseDirections(row: { directionsJson: string | null }): CreativeDirection[] | null {
    if (!row.directionsJson) return null
    try {
      const parsed = DirectionsPayloadSchema.safeParse(JSON.parse(row.directionsJson))
      return parsed.success ? parsed.data.directions : null
    } catch {
      return null
    }
  },

  parseConcept(row: { conceptJson: string | null }): VersionStructure['concept'] | null {
    if (!row.conceptJson) return null
    try {
      return JSON.parse(row.conceptJson) as VersionStructure['concept']
    } catch {
      return null
    }
  },

  /** 保存创作方向批次（INTENT 阶段；重新生成=整批替换） */
  async saveDirections(contentId: string, directions: CreativeDirection[], actorId: string): Promise<void> {
    const plan = await this.getPlan(contentId)
    const data = { directionsJson: JSON.stringify({ directions }) }
    if (plan) {
      await db.creativePlan.update({ where: { id: plan.id }, data })
    } else {
      await db.creativePlan.create({ data: { contentId, ...data } })
    }
    await provenanceRepo.append(db, {
      contentId,
      eventType: 'ai_generated',
      actorType: 'ai',
      provider: 'creative-planner',
      model: 'default',
      payload: { stage: 'directions.generate', count: directions.length },
    })
    void actorId
  },

  /** 选定方向 → 冻结 Concept（§18）→ INTENT→PLANNING */
  async selectDirection(contentId: string, directionId: string, actorId: string): Promise<CreativeDirection> {
    const plan = await this.getPlan(contentId)
    if (!plan) throw new DomainValidationError('还没有创作方向（先生成一批方向）')
    const directions = this.parseDirections(plan)
    if (!directions?.length) throw new DomainValidationError('创作方向数据损坏，请重新生成')
    const direction = directions.find((d) => d.id === directionId)
    if (!direction) throw new NotFoundError('创作方向', directionId)

    const concept = {
      directionId: direction.id,
      name: direction.name,
      oneLiner: direction.oneLiner,
      emotion: direction.emotion,
      visualDirection: direction.visualDirection,
    }
    await db.creativePlan.update({
      where: { id: plan.id },
      data: { conceptJson: JSON.stringify(concept), selectedDirectionId: direction.id },
    })
    await contentService.advanceStatus(contentId, 'PLANNING', actorId)
    return direction
  },

  async requireConcept(contentId: string): Promise<{
    directionId?: string
    name: string
    oneLiner: string
    emotion?: string
    visualDirection?: string
  }> {
    const plan = await this.getPlan(contentId)
    if (!plan) throw new DomainValidationError('还没有创作方向（先选择一个方向）')
    const concept = this.parseConcept(plan)
    if (!concept) throw new DomainValidationError('方向还未选定（先冻结 Concept）')
    if (!concept.name || !concept.oneLiner) {
      throw new DomainValidationError('方向数据不完整，请重新选择方向')
    }
    return concept as { directionId?: string; name: string; oneLiner: string; emotion?: string; visualDirection?: string }
  },

  /** 保存故事草稿（叙述弧+场景）→ 覆盖工作副本 → PLANNING→STORY */
  async saveStoryDraft(contentId: string, story: StorySnapshot, actorId: string): Promise<void> {
    await this.replaceWorkingStory(contentId, { ...story, scenes: story.scenes.map((s) => ({ ...s, shots: [] })) })
    await contentService.advanceStatus(contentId, 'STORY', actorId)
    await provenanceRepo.append(db, {
      contentId,
      eventType: 'ai_generated',
      actorType: 'ai',
      provider: 'creative-planner',
      model: 'default',
      payload: { stage: 'story.generate', scenes: story.scenes.length },
    })
  },

  /** 保存分镜（镜头填入场景）→ STORY→STORYBOARD */
  async saveStoryboard(contentId: string, story: StorySnapshot, actorId: string): Promise<void> {
    await this.replaceWorkingStory(contentId, story)
    await contentService.advanceStatus(contentId, 'STORYBOARD', actorId)
    const shotCount = story.scenes.reduce((n, s) => n + s.shots.length, 0)
    await provenanceRepo.append(db, {
      contentId,
      eventType: 'ai_generated',
      actorType: 'ai',
      provider: 'creative-planner',
      model: 'default',
      payload: { stage: 'storyboard.generate', shots: shotCount },
    })
  },

  /** 读取工作副本 Story（draftJson 优先，行级数据兜底；无则 null） */
  async getWorkingStory(contentId: string): Promise<StorySnapshot | null> {
    const story = await db.story.findFirst({ where: { contentId }, orderBy: { createdAt: 'asc' } })
    if (!story) return null
    if (story.draftJson) {
      try {
        return JSON.parse(story.draftJson) as StorySnapshot
      } catch {
        // 脏数据 → 走行级兜底
      }
    }
    const scenes = await db.scene.findMany({
      where: { storyId: story.id },
      orderBy: { index: 'asc' },
      include: { shots: { orderBy: { index: 'asc' } } },
    })
    return {
      logline: story.logline ?? undefined,
      narrationStyle: story.narrationStyle ?? undefined,
      emotionArc: story.arcJson ? (JSON.parse(story.arcJson) as string[]) : undefined,
      scenes: scenes.map((sc) => ({
        index: sc.index,
        summary: sc.summary ?? undefined,
        shots: sc.shots.map((sh) => ({
          index: sh.index,
          visualDescription: sh.visualDescription ?? undefined,
          cameraMotion: sh.cameraMotion ?? undefined,
          durationMs: sh.durationMs ?? undefined,
          narrationLine: sh.narrationLine ?? undefined,
          emotion: sh.emotion ?? undefined,
        })),
      })),
    }
  },

  /**
   * 组装当前配方的完整 VersionStructure（生成前密封用）。
   * 优先级：当前版本快照（restore/remix 后的既有配方）> 工作副本（本轮回炉）。
   * 结构不变（JSON 等价）则沿用现版本，不新建。
   */
  async buildVersionStructure(contentId: string): Promise<VersionStructureInput> {
    const content = await contentRepo.findById(db, contentId)
    if (!content) throw new NotFoundError('作品', contentId)

    const intentRow = await db.intent.findFirst({ where: { contentId }, orderBy: { createdAt: 'asc' } })
    const workingStory = await this.getWorkingStory(contentId)
    const plan = await this.getPlan(contentId)
    const concept = plan?.conceptJson ? (JSON.parse(plan.conceptJson) as VersionStructure['concept']) : undefined

    // 当前版本已有密封配方（remix/restore 场景）且工作副本为空 → 直接沿用
    if (content.currentVersionId && !workingStory) {
      const current = await versionRepo.findById(db, content.currentVersionId)
      if (current?.structureJson) return JSON.parse(current.structureJson) as VersionStructureInput
    }

    // 工作副本存在 → 以工作副本为准（回炉重修场景）
    const current = content.currentVersionId ? await versionRepo.findById(db, content.currentVersionId) : null
    const currentStructure: VersionStructureInput | null = current?.structureJson
      ? (JSON.parse(current.structureJson) as VersionStructureInput)
      : null

    const structure: VersionStructureInput = {
      ...currentStructure,
      concept: concept ?? currentStructure?.concept,
      story: workingStory ?? currentStructure?.story,
      intentSummary: intentRow?.rawExpression ? intentRow.rawExpression.slice(0, 120) : currentStructure?.intentSummary,
    }
    return structure
  },

  // ---------- 内部 ----------

  async replaceWorkingStory(contentId: string, story: StorySnapshot): Promise<void> {
    await db.$transaction(async (tx) => {
      const existing = await tx.story.findFirst({ where: { contentId } })
      if (existing) {
        await tx.story.delete({ where: { id: existing.id } }) // 级联清掉 scenes/shots
      }
      const created = await tx.story.create({
        data: {
          contentId,
          logline: story.logline ?? null,
          arcJson: story.emotionArc ? JSON.stringify(story.emotionArc) : null,
          narrationStyle: story.narrationStyle ?? null,
          draftJson: JSON.stringify(story), // 完整配方快照（含 imagePrompt）
        },
      })
      // 行级镜像（结构化查询用；imagePrompt 等配方字段只在 draftJson）
      for (const sc of story.scenes) {
        const scene = await tx.scene.create({
          data: { storyId: created.id, index: sc.index, summary: sc.summary ?? null },
        })
        for (const sh of sc.shots) {
          await tx.shot.create({
            data: {
              sceneId: scene.id,
              index: sh.index,
              visualDescription: sh.visualDescription ?? null,
              cameraMotion: sh.cameraMotion ?? null,
              durationMs: sh.durationMs ?? null,
              narrationLine: sh.narrationLine ?? null,
              emotion: sh.emotion ?? null,
            },
          })
        }
      }
    }, SQLITE_TX_TIMEOUT)
  },
}
