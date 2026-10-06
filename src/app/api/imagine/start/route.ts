// POST /api/imagine/start —— 主链第一环（§63）
// "我想做一个45秒的视频，记录我小时候和父亲一起骑自行车。" → Content(IDEA) + Intent.rawExpression
import { requireSessionUser, domainErrorToResponse, readJson } from '../../_lib/session'
import { contentService } from '@/core/content/content-service'
import { StartCreationInputSchema } from '@/core/content/schemas'

export async function POST(req: Request) {
  try {
    const body = await readJson<unknown>(req)
    const parsed = StartCreationInputSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return Response.json(
        { error: 'invalid_input', message: parsed.error.issues[0]?.message ?? '输入无效' },
        { status: 400 },
      )
    }
    const { user } = await requireSessionUser()
    const content = await contentService.startCreation({
      ownerId: user.id,
      text: parsed.data.text,
    })
    return Response.json(
      {
        contentId: content.id,
        title: content.title,
        status: content.status,
        createUrl: `/create/${content.id}`,
        message: '表达已收到。去创作空间，把它变成作品。',
      },
      { status: 201 },
    )
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
