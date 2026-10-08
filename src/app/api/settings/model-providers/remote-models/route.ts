// POST /api/settings/model-providers/remote-models —— 拉取可用模型列表（GET {baseUrl}/models，零消耗）
// 用途：表单「获取模型列表」按钮。取密钥两种模式：
//   { providerId }        —— 已有提供商（用已存密钥；明文只在服务端出现）
//   { baseUrl, apiKey }   —— 新建提供商表单（密钥已在表单中输入，尚未保存）
import {
  ModelProviderSchema,
  fetchAvailableModels,
  providerConfigService,
} from '@/core/settings/provider-config-service'

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>

    let baseUrl: string
    let apiKey: string
    if (typeof body.providerId === 'string' && body.providerId.length > 0) {
      const provider = await providerConfigService.readProviderById(body.providerId)
      if (!provider) return Response.json({ error: '提供商不存在' }, { status: 404 })
      baseUrl = provider.baseUrl
      apiKey = provider.apiKey
    } else {
      const base = ModelProviderSchema.shape.baseUrl.safeParse(body.baseUrl)
      const key = ModelProviderSchema.shape.apiKey.safeParse(body.apiKey)
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
