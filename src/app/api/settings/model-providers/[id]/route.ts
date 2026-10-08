// PATCH /api/settings/model-providers/:id —— 更新提供商（显示名/地址/密钥/总开关）
// DELETE /api/settings/model-providers/:id —— 删除提供商（级联删除旗下全部模型）
// 约定：apiKey 传掩码值（含 ••••••••）= 不修改原密钥；地址/密钥变化自动级联重置测试账。
import { providerConfigService } from '@/core/settings/provider-config-service'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = (await req.json()) as Record<string, unknown>
    const outcome = await providerConfigService.updateProvider(id, body)
    if (!outcome.ok) {
      return Response.json({ error: outcome.error }, { status: outcome.status })
    }
    return Response.json({ provider: outcome.item })
  } catch {
    return Response.json({ error: '更新失败（提供商可能不存在）' }, { status: 404 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await providerConfigService.removeProvider(id)
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: '删除失败（提供商可能不存在）' }, { status: 404 })
  }
}
