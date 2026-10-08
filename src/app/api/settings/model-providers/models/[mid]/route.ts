// PATCH /api/settings/model-providers/models/:mid —— 更新模型（模型名/通道/优先级/附加参数/启停）
// DELETE /api/settings/model-providers/models/:mid —— 删除模型（提供商连接保留）
// 注意：路径静态段 models 优先于兄弟动态段 [id]，不冲突。
import { providerConfigService } from '@/core/settings/provider-config-service'

export async function PATCH(req: Request, { params }: { params: Promise<{ mid: string }> }) {
  try {
    const { mid } = await params
    const body = (await req.json()) as Record<string, unknown>
    const outcome = await providerConfigService.updateModel(mid, body)
    if (!outcome.ok) {
      return Response.json({ error: outcome.error }, { status: outcome.status })
    }
    return Response.json({ model: outcome.item })
  } catch {
    return Response.json({ error: '更新失败（模型可能不存在）' }, { status: 404 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ mid: string }> }) {
  try {
    const { mid } = await params
    await providerConfigService.removeModel(mid)
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: '删除失败（模型可能不存在）' }, { status: 404 })
  }
}
