// POST /api/settings/model-providers/:id/test —— 提供商连接测试（GET /models 零消耗）并落账
// 连接级验证：地址 + 密钥是否可用。模型级真实调用验证走 POST /models/:mid/test。
import { providerConfigService } from '@/core/settings/provider-config-service'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const result = await providerConfigService.testProviderConnection(id)
    if (!result) return Response.json({ error: '提供商不存在' }, { status: 404 })
    return Response.json(result)
  } catch {
    return Response.json({ error: '测试失败（提供商可能不存在）' }, { status: 500 })
  }
}
