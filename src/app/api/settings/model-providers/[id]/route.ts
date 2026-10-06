// PATCH /api/settings/model-providers/:id —— 更新配置（启停/优先级/字段）
// DELETE /api/settings/model-providers/:id —— 删除配置
// 约定：apiKey 传掩码值（含 ••••••••）= 不修改原密钥
import { providerConfigService } from '@/core/settings/provider-config-service'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = (await req.json()) as Record<string, unknown>
    const outcome = await providerConfigService.update(id, body)
    if (!outcome.ok) {
      return Response.json({ error: outcome.error }, { status: outcome.status })
    }
    return Response.json({ item: outcome.item })
  } catch {
    return Response.json({ error: '更新失败（配置可能不存在）' }, { status: 404 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await providerConfigService.remove(id)
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: '删除失败（配置可能不存在）' }, { status: 404 })
  }
}
