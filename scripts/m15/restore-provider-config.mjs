// 环境恢复：把产品负责人确认的最终供给配置（worklog 019/022 现场记录）写入新表
// ModelProvider + ModelProviderModel。幂等：已有同名提供商则跳过。
// 配置口径（用户确认「勿动」）：
//   agnes-com：一把钥匙管 llm(agnes-3.0-flash) + image(agnes-image-2.5-flash) + video(agnes-video-2.5-flash)，priority=10
//   ant-ling ：Ling-3.1-flash（免费优先），priority=5
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const PROVIDERS = [
  {
    label: 'agnes-com',
    providerType: 'openai-compat',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    apiKey: 'sk-Hp62wP4gWNyfPvuBbIiMhsuEgIq64N9y3lNffgzJo2ngqMw2',
    enabled: true,
    models: [
      { channel: 'llm', modelName: 'agnes-3.0-flash', priority: 10 },
      { channel: 'image', modelName: 'agnes-image-2.5-flash', priority: 10 },
      { channel: 'video', modelName: 'agnes-video-2.5-flash', priority: 10 },
    ],
  },
  {
    label: 'ant-ling',
    providerType: 'openai-compat',
    baseUrl: 'https://api.ant-ling.com/v1',
    apiKey: 'sk-studio-8428cf55ea9443c2b1ca1997edaab76e',
    enabled: true,
    models: [
      { channel: 'llm', modelName: 'Ling-3.1-flash', priority: 5 },
    ],
  },
]

async function main() {
  for (const p of PROVIDERS) {
    const existing = await db.modelProvider.findUnique({ where: { label: p.label }, include: { models: true } })
    if (existing) {
      console.log(`[${p.label}] 已存在（${existing.models.length} 模型）——跳过（幂等）`)
      continue
    }
    const provider = await db.modelProvider.create({
      data: {
        label: p.label,
        providerType: p.providerType,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        enabled: p.enabled,
        lastTestStatus: 'untested',
      },
    })
    for (const m of p.models) {
      await db.modelProviderModel.create({
        data: {
          providerId: provider.id,
          channel: m.channel,
          modelName: m.modelName,
          enabled: true,
          priority: m.priority,
          lastTestStatus: 'untested',
        },
      })
      console.log(`[${p.label}] + ${m.channel}: ${m.modelName} (priority=${m.priority})`)
    }
  }
  const total = await db.modelProvider.findMany({ include: { models: true } })
  console.log(`\n当前提供商：${total.map((t) => `${t.label}[${t.models.map((m) => `${m.channel}:${m.modelName}`).join(', ')}]`).join(' | ')}`)
}

main().finally(() => db.$disconnect())
