// POST /api/settings/model-providers/models —— 拉取可用模型列表（GET {baseUrl}/models，零消耗）
// 用途：表单「获取模型列表」按钮——填好地址与密钥后一键拉取该密钥有权限的模型，免去手敲模型名。
// 取密钥两种模式：
//   { baseUrl, apiKey } —— 新增表单（密钥已在表单中输入）
//   { configId }        —— 编辑表单（未改密钥时复用已存密钥；明文只在服务端出现）
import {
  ModelProviderConfigSchema,
  fetchAvailableModels,
  providerConfigService,
} from '@/core/settings/provider-config-service'

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>

    let baseUrl: string
    let apiKey: string
    if (typeof body.configId === 'string' && body.configId.length > 0) {
      const row = await providerConfigService.readById(body.configId)
      if (!row) return Response.json({ error: '配置不存在' }, { status: 404 })
      baseUrl = row.baseUrl
      apiKey = row.apiKey
    } else {
      const base = ModelProviderConfigSchema.shape.baseUrl.safeParse(body.baseUrl)
      const key = ModelProviderConfigSchema.shape.apiKey.safeParse(body.apiKey)
      if (!base.success || !key.success) {
        return Response.json({ error: '接口地址或密钥不合法（地址须 http(s):// 开头，密钥至少 8 位）' }, { status: 422 })
      }
      baseUrl = base.data
      apiKey = key.data
    }

    const result = await fetchAvailableModels({ baseUrl, apiKey })
    if (!result.ok) {
      return Response.json({ error: result.message, latencyMs: result.latencyMs }, { status: 502 })
    }
    return Response.json({
      models: result.models,
      latencyMs: result.latencyMs,
      message: result.message,
    })
  } catch {
    return Response.json({ error: '拉取模型列表失败' }, { status: 500 })
  }
}
