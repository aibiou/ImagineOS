// 新表（ModelProvider/ModelProviderModel）连通性探测：LLM 逐行最小 ping（近零消耗）。
// image/video 不做消耗性探测（走真实管线时自然验证）。
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function ping(baseUrl, apiKey, model) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 4 }),
      signal: AbortSignal.timeout(30_000),
    })
    const ms = Date.now() - t0
    if (!res.ok) return `❌ HTTP ${res.status}（${ms}ms）: ${(await res.text()).slice(0, 120)}`
    return `✅ ${ms}ms`
  } catch (e) {
    return `❌ ${e instanceof Error ? e.message : e}`
  }
}

async function main() {
  const providers = await db.modelProvider.findMany({ where: { enabled: true }, include: { models: { where: { enabled: true } } } })
  for (const p of providers) {
    for (const m of p.models.filter((m) => m.channel === 'llm')) {
      console.log(`${p.label} · ${m.modelName} → ${await ping(p.baseUrl, p.apiKey, m.modelName)}`)
    }
  }
}

main().finally(() => db.$disconnect())
