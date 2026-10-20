// 查询 ModelProviderConfig（不输出密钥本体，仅掩码）+ 最近视频生成账本统计
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } })

const providers = await prisma.modelProvider.findMany({
  include: { models: { select: { channel: true, modelName: true, enabled: true, priority: true, lastTestStatus: true } } },
})
console.log(`=== ModelProvider 共 ${providers.length} 家 ===`)
for (const p of providers) {
  console.log(`[provider] ${p.label} ${p.providerType} ${p.baseUrl} enabled=${p.enabled} test=${p.lastTestStatus}`)
  for (const m of p.models ?? []) {
    console.log(`    [${m.channel}] ${m.modelName} priority=${m.priority} enabled=${m.enabled} test=${m.lastTestStatus}`)
  }
}

// 最近 24h 视频生成账本：成功/失败分布与失败原因
const since = new Date(Date.now() - 48 * 3600 * 1000)
const gens = await prisma.generation.findMany({
  where: { type: 'video.shot', createdAt: { gte: since } },
  select: { status: true, provider: true, model: true, outputJson: true, latencyMs: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
})
console.log(`\n=== 最近48h video.shot 账本 ${gens.length} 条 ===`)
for (const g of gens) {
  let err = ''
  try { err = g.outputJson ? (JSON.parse(g.outputJson).error ?? '') : '' } catch {}
  console.log(`${g.createdAt.toISOString()} ${g.status} ${g.provider}/${g.model} ${g.latencyMs ?? '-'}ms ${err ? 'ERR:' + String(err).slice(0, 80) : ''}`)
}

// 图像账本（质量门基线参考）
const imgGens = await prisma.generation.findMany({
  where: { type: 'image.shot', createdAt: { gte: since } },
  select: { status: true, provider: true, latencyMs: true },
})
const imgOk = imgGens.filter(g => g.status === 'succeeded').length
console.log(`\n=== 最近48h image.shot：${imgOk}/${imgGens.length} 成功 ===`)

// Generation 表结构确认（seed 字段是否存在）
const cols = await prisma.$queryRawUnsafe("PRAGMA table_info('Generation')")
console.log('\n=== Generation 表字段 ===')
console.log(cols.map(c => c.name).join(', '))

await prisma.$disconnect()
