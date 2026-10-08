// GET /api/settings/model-providers —— 提供商列表（含内嵌模型；密钥打码）
// POST /api/settings/model-providers —— 新增提供商（一次配置地址+密钥；模型随后在卡片内添加）
// ADR-0004 + 2026-10-08 提供商化重构：按提供商配置，不再按模型/通道重复录入连接。
// Alpha 单租户沙箱：配置为全局（非按用户）；密钥明文落库、对外一律打码。
import { providerConfigService } from '@/core/settings/provider-config-service'

export async function GET() {
  try {
    const providers = await providerConfigService.list()
    return Response.json({ providers })
  } catch {
    return Response.json({ error: '读取模型提供商配置失败' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const outcome = await providerConfigService.createProvider(body)
    if (!outcome.ok) {
      return Response.json({ error: outcome.error, detail: outcome.detail }, { status: 422 })
    }
    return Response.json({ provider: outcome.item }, { status: 201 })
  } catch {
    return Response.json({ error: '保存提供商失败' }, { status: 500 })
  }
}
