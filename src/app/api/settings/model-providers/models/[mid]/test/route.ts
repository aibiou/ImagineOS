// POST /api/settings/model-providers/models/:mid/test —— 模型真实验证（按通道最小真实调用）
// llm：真实对话一次（max_tokens 极小）；tts：真实合成一句；image：真实生图（UI 侧二次确认）；
// video：不做实调（成本高），按服务模型列表存在性说明。结果落模型级测试账。
import { providerConfigService } from '@/core/settings/provider-config-service'

export async function POST(_req: Request, { params }: { params: Promise<{ mid: string }> }) {
  try {
    const { mid } = await params
    const outcome = await providerConfigService.verifyModel(mid)
    if (outcome === null) return Response.json({ error: '模型不存在' }, { status: 404 })
    if (!outcome.ok) {
      return Response.json({ error: outcome.error }, { status: outcome.status })
    }
    return Response.json({
      ok: outcome.result.ok,
      message: outcome.result.detail,
      latencyMs: outcome.result.latencyMs,
      modelVerified: outcome.result.ok,
      modelsCount: outcome.result.modelsCount,
    })
  } catch {
    return Response.json({ error: '验证失败（模型可能不存在）' }, { status: 500 })
  }
}
