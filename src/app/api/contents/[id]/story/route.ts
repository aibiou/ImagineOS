// POST /api/contents/:id/story —— 生成故事（叙述弧+场景）→ PLANNING→STORY（E4 / §19）
import { requireSessionUser, domainErrorToResponse } from '../../../_lib/session'
import { intentService } from '@/core/intent/intent-service'
import { planService } from '@/core/planning/plan-service'
import { generateStoryDraft } from '@/ai/planning/story'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user } = await requireSessionUser()
    const content = await intentService.requireContent(id)
    if (content.ownerId !== user.id) {
      return Response.json({ error: 'permission_denied', message: '只有作者可以继续这个创作' }, { status: 403 })
    }
    if (content.status !== 'PLANNING') {
      return Response.json({ error: 'illegal_transition', message: '先选定创作方向，再展开故事' }, { status: 422 })
    }

    const record = await intentService.requireRecord(id)
    const concept = await planService.requireConcept(id)

    const story = await generateStoryDraft(record, concept, {
      contentId: id,
      versionId: content.currentVersionId,
      purpose: 'story.generate',
      actorId: user.id,
    })
    await planService.saveStoryDraft(id, story, user.id)

    return Response.json({
      story,
      status: 'STORY',
      message: `故事已展开：「${story.logline}」`,
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
