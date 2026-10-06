// POST /api/contents/:id/revision/plan —— 修订定位（无副作用；返回"我将修改 X"确认点，R3 缓解）
// body: { feedback: string }
import { requireSessionUser, domainErrorToResponse, readJson } from '../../../../_lib/session'
import { intentService } from '@/core/intent/intent-service'
import { versionService } from '@/core/content/version-service'
import { parseStructure } from '@/core/content/schemas'
import { planRevision } from '@/ai/revision/locator'
import { z } from 'zod'

const BodySchema = z.object({ feedback: z.string().trim().min(2, '想怎么改？用一句话说说。').max(300) })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await readJson<unknown>(req)
    const parsed = BodySchema.safeParse(body ?? {})
    if (!parsed.success) {
      return Response.json(
        { error: 'invalid_input', message: parsed.error.issues[0]?.message ?? '输入无效' },
        { status: 400 },
      )
    }
    const { user } = await requireSessionUser()
    const content = await intentService.requireContent(id)
    if (content.ownerId !== user.id) {
      return Response.json({ error: 'permission_denied', message: '只有作者可以修改这个作品' }, { status: 403 })
    }
    const version = await versionService.getCurrentVersion(id)
    if (!version) {
      return Response.json({ error: 'domain_validation', message: '先完成一次生成，再修改' }, { status: 422 })
    }
    const structure = parseStructure(version.structureJson)

    const outcome = await planRevision(parsed.data.feedback, structure, {
      contentId: id,
      versionId: version.id,
      purpose: 'revision.locate',
      actorId: user.id,
    })
    return Response.json({
      plan: outcome.plan,
      structure: outcome.structure,
      feedback: parsed.data.feedback,
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
