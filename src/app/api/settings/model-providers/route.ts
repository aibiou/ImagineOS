// GET /api/settings/model-providers —— 自定义模型服务配置列表（密钥打码）
// POST /api/settings/model-providers —— 新增配置（写后即时失效 AI 层候选链缓存）
// ADR-0004：不因单一 Provider 配额限制阻塞 ImagineOS。
// Alpha 单租户沙箱：配置为全局（非按用户）；密钥明文落库、对外一律打码。
import { providerConfigService } from '@/core/settings/provider-config-service'

export async function GET() {
  try {
    const items = await providerConfigService.list()
    return Response.json({ items })
  } catch {
    return Response.json({ error: '读取模型服务配置失败' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const outcome = await providerConfigService.create(body)
    if (!outcome.ok) {
      return Response.json({ error: outcome.error, detail: outcome.detail }, { status: 422 })
    }
    return Response.json({ item: outcome.item }, { status: 201 })
  } catch {
    return Response.json({ error: '保存模型服务配置失败' }, { status: 500 })
  }
}
