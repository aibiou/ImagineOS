// ModelProviderConfig（每行带连接）→ ModelProvider + ModelProviderModel（提供商级连接）数据迁移
// 用法（三段式，配合 bun run db:push 在中间切表）：
//   1. node scripts/m15/provider-migration.mjs extract   —— 旧表行抽到 JSON 备份（$queryRaw，不依赖 client 类型）
//   2. bun run db:push                                    —— 新表建、旧表删（schema 已切换）
//   3. node scripts/m15/provider-migration.mjs restore    —— 备份按「同 providerType+baseUrl+apiKey」分组恢复
// 分组规则：同一把钥匙 + 同一地址 = 同一提供商；提供商显示名 = 组内各行显示名的公共前缀（单行组=原样）。
// 幂等：restore 前检查新表是否已有数据（有则跳过，防重复执行）。

import { PrismaClient } from '@prisma/client'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const db = new PrismaClient()
const HERE = dirname(fileURLToPath(import.meta.url))
const BACKUP = join(HERE, 'provider-config-backup.json')

async function extract() {
  // 旧表可能已不存在（重复执行）——先探测
  const tables = await db.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' AND name='ModelProviderConfig'`
  if (tables.length === 0) {
    console.log('旧表 ModelProviderConfig 不存在——无需抽取')
    return
  }
  const rows = await db.$queryRaw`SELECT id, channel, label, providerType, baseUrl, apiKey, modelName, extraJson, enabled, priority, lastTestStatus, lastTestMessage, lastTestedAt, createdAt FROM ModelProviderConfig`
  writeFileSync(BACKUP, JSON.stringify(rows, null, 2))
  console.log(`已备份 ${rows.length} 行 → ${BACKUP}`)
}

/** 组内各行 label 的公共前缀（单行=原样；多行如「DeepSeek 对话/DeepSeek 生图」→「DeepSeek」） */
function commonLabel(labels) {
  if (labels.length === 1) return labels[0]
  let prefix = labels[0]
  for (const l of labels) {
    while (!l.startsWith(prefix)) prefix = prefix.slice(0, -1)
  }
  return prefix.replace(/[\s··\-—_/]+$/, '') || labels[0]
}

async function restore() {
  if (!existsSync(BACKUP)) {
    console.error(`备份文件不存在：${BACKUP}——先执行 extract`)
    process.exit(1)
  }
  const existing = await db.modelProvider.count()
  if (existing > 0) {
    console.log(`新表已有 ${existing} 个提供商——跳过恢复（幂等保护）`)
    return
  }
  const rows = JSON.parse(readFileSync(BACKUP, 'utf-8'))
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('备份为空——无可恢复数据')
    return
  }

  // 分组：providerType + baseUrl + apiKey = 同一提供商
  const groups = new Map()
  for (const r of rows) {
    const key = `${r.providerType}|${r.baseUrl}|${r.apiKey}`
    if (!groups.has(key)) groups.set(key, { providerType: r.providerType, baseUrl: r.baseUrl, apiKey: r.apiKey, labels: [], models: [] })
    const g = groups.get(key)
    g.labels.push(r.label)
    g.models.push({
      channel: r.channel,
      modelName: r.modelName,
      extraJson: r.extraJson ?? null,
      enabled: r.enabled === 1 || r.enabled === true,
      priority: typeof r.priority === 'number' ? r.priority : 100,
      lastTestStatus: r.lastTestStatus ?? null,
      lastTestMessage: r.lastTestMessage ?? null,
      lastTestedAt: r.lastTestedAt ?? null,
    })
  }

  for (const g of groups.values()) {
    const label = commonLabel(g.labels)
    const provider = await db.modelProvider.create({
      data: {
        label,
        providerType: g.providerType,
        baseUrl: g.baseUrl,
        apiKey: g.apiKey,
        enabled: true,
        lastTestStatus: 'untested', // 连接级账重开（旧行的测试状态属模型级语义，落在模型上）
        models: { create: g.models },
      },
      include: { models: true },
    })
    console.log(`✓ 提供商「${label}」+ ${provider.models.length} 个模型（${g.baseUrl}）`)
    for (const m of provider.models) {
      console.log(`   · [${m.channel}] ${m.modelName}（priority ${m.priority}，lastTest=${m.lastTestStatus ?? 'null'}）`)
    }
  }
  const total = await db.modelProviderModel.count()
  console.log(`恢复完成：${groups.size} 个提供商 / ${total} 个模型`)
}

const cmd = process.argv[2]
if (cmd === 'extract') await extract()
else if (cmd === 'restore') await restore()
else {
  console.log('用法：node scripts/m15/provider-migration.mjs extract|restore')
  process.exit(1)
}
await db.$disconnect()
