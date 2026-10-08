// POST /api/settings/model-providers/:id/test —— 连接测试（GET /models 零消耗）并落账
// 补齐 UI「测试」按钮的调用端点（此前 service 有 testOpenAiCompatConnection 但无路由，按钮 404）。
// 落账字段：lastTestStatus（ok/failed）/ lastTestMessage / lastTestedAt（配置卡片直接展示）。
import { providerConfigService } from '@/core/settings/provider-config-service'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const result = await providerConfigService.testConnection(id)
    if (!result) return Response.json({ error: '配置不存在' }, { status: 404 })
    return Response.json(result)
  } catch {
    return Response.json({ error: '测试失败（配置可能不存在）' }, { status: 500 })
  }
}
