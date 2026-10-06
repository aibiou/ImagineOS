// POST /api/contents/:id/revision/apply —— 应用修订：新版本（永不覆盖）+ 重跑生成（§24）
// body: { structure: VersionStructure, changelog: string, feedback?: string }
import { requireSessionUser, domainErrorToResponse, readJson } from '../../../../_lib/session'
import { generationFlow } from '@/core/content/generation-flow'
import { VersionStructureSchema } from '@/core/content/schemas'
import { z } from 'zod'

const BodySchema = z.object({
  structure: VersionStructureSchema,
  changelog: z.string().trim().min(2).max(200),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await readJson<unknown>(req)
    const parsed = BodySchema.safeParse(body ?? {})
    if (!parsed.success) {
      return Response.json(
        { error: 'invalid_input', message: parsed.error.issues[0]?.message ?? '修订方案无效，请重新描述' },
        { status: 400 },
      )
    }
    const { user } = await requireSessionUser()
    const result = await generationFlow.applyRevision(id, user.id, {
      structure: parsed.data.structure,
      changelog: parsed.data.changelog,
    })
    return Response.json({
      ...result,
      message: '已按你的想法修改，正在重新生成。旧版本随时可以在版本历史里找回。',
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
