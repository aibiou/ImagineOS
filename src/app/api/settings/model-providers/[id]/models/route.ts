// POST /api/settings/model-providers/:id/models —— 为提供商添加模型（绑定能力通道）
// 地址与密钥从提供商服务端取（密钥不经过客户端，永不再录入）。
import { providerConfigService } from '@/core/settings/provider-config-service'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const outcome = await providerConfigService.addModel(id, body)
    if (!outcome.ok) {
      return Response.json({ error: outcome.error, detail: outcome.detail }, { status: outcome.status ?? 422 })
    }
    return Response.json({ model: outcome.item }, { status: 201 })
  } catch {
    return Response.json({ error: '添加模型失败' }, { status: 500 })
  }
}
