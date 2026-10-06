// POST /api/contents/:id/storyboard —— 分镜（场景→镜头）→ STORY→STORYBOARD（E4 / §19）
import { requireSessionUser, domainErrorToResponse } from '../../../_lib/session'
import { intentService } from '@/core/intent/intent-service'
import { planService } from '@/core/planning/plan-service'
import { generateStoryboard } from '@/ai/planning/story'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user } = await requireSessionUser()
    const content = await intentService.requireContent(id)
    if (content.ownerId !== user.id) {
      return Response.json({ error: 'permission_denied', message: '只有作者可以继续这个创作' }, { status: 403 })
    }
    if (content.status !== 'STORY') {
      return Response.json({ error: 'illegal_transition', message: '先展开故事，再拆分镜头' }, { status: 422 })
    }

    const record = await intentService.requireRecord(id)
    const concept = await planService.requireConcept(id)
    const workingStory = await planService.getWorkingStory(id)
    if (!workingStory) {
      return Response.json({ error: 'domain_validation', message: '故事还没写（先展开故事）' }, { status: 422 })
    }

    const storyboard = await generateStoryboard(record, concept, workingStory, {
      contentId: id,
      versionId: content.currentVersionId,
      purpose: 'storyboard.generate',
      actorId: user.id,
    })
    await planService.saveStoryboard(id, storyboard, user.id)

    const shotCount = storyboard.scenes.reduce((n, s) => n + s.shots.length, 0)
    return Response.json({
      story: storyboard,
      status: 'STORYBOARD',
      shots: shotCount,
      message: `分镜已就绪：${storyboard.scenes.length} 个场景 · ${shotCount} 个镜头。`,
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
