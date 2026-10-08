// 连接复用测试（产品负责人反馈：同一提供商多个模型不应重复填地址与密钥）
// 覆盖：create + reuseConfigId 服务端复制连接 / label 缺省 / 源不存在拒绝 / 跨通道复用 / 密钥不出客户端。
// 铁律：走 vitest 隔离库（tests/global-setup.ts 每轮重建），不触网。
import { describe, it, expect, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { providerConfigService, maskApiKey } from '@/core/settings/provider-config-service'

const db = new PrismaClient()

afterAll(async () => {
  await db.modelProviderConfig.deleteMany()
  await db.$disconnect()
})

describe('连接复用 create({ reuseConfigId })', () => {
  it('复用源配置：地址/密钥/协议服务端复制，客户端不传密钥也能建；label 缺省 = 模型名', async () => {
    const src = await providerConfigService.create({
      channel: 'llm',
      label: 'DeepSeek 对话',
      providerType: 'openai-compat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-reuse-source-key-123456',
      modelName: 'deepseek-chat',
    })
    if (!src.ok) throw new Error(`源配置创建失败：${JSON.stringify(src)}`)
    const srcId = (src.item as { id: string }).id

    // 复用：只传 channel + reuseConfigId + modelName（无 baseUrl / 无 apiKey / 无 label）
    const out = await providerConfigService.create({
      channel: 'llm',
      reuseConfigId: srcId,
      modelName: 'deepseek-reasoner',
    })
    if (!out.ok) throw new Error(`复用创建失败：${JSON.stringify(out)}`)
    const item = out.item as { baseUrl: string; apiKey: string; providerType: string; label: string; modelName: string }

    expect(item.baseUrl).toBe('https://api.deepseek.com/v1') // 连接复制
    expect(item.apiKey).toBe(maskApiKey('sk-reuse-source-key-123456')) // 返回仍打码
    expect(item.providerType).toBe('openai-compat')
    expect(item.label).toBe('deepseek-reasoner') // label 缺省 = 模型名
    expect(item.modelName).toBe('deepseek-reasoner')

    // DB 落库行持有与源一致的明文密钥（AI 层按行构建候选链，零改动成立的前提）
    const row = await db.modelProviderConfig.findFirst({ where: { modelName: 'deepseek-reasoner' } })
    expect(row?.apiKey).toBe('sk-reuse-source-key-123456')
    expect(row?.baseUrl).toBe('https://api.deepseek.com/v1')
  })

  it('跨通道复用：llm 连接可复用到 image 通道（同一把钥匙管多个通道）', async () => {
    const src = await db.modelProviderConfig.findFirst({ where: { modelName: 'deepseek-chat' } })
    if (!src) throw new Error('前置：源配置应存在')

    const out = await providerConfigService.create({
      channel: 'image',
      reuseConfigId: src.id,
      label: 'DeepSeek 生图（若支持）',
      modelName: 'deepseek-image-model',
    })
    if (!out.ok) throw new Error(JSON.stringify(out))
    const row = await db.modelProviderConfig.findFirst({ where: { modelName: 'deepseek-image-model' } })
    expect(row?.channel).toBe('image')
    expect(row?.baseUrl).toBe(src.baseUrl)
    expect(row?.apiKey).toBe(src.apiKey)
  })

  it('客户端传了 baseUrl/apiKey 也被源覆盖（复用语义 = 连接完全一致）', async () => {
    const src = await db.modelProviderConfig.findFirst({ where: { modelName: 'deepseek-chat' } })
    if (!src) throw new Error('前置：源配置应存在')

    const out = await providerConfigService.create({
      channel: 'llm',
      reuseConfigId: src.id,
      baseUrl: 'https://evil.example.com/v1', // 应被忽略
      apiKey: 'sk-should-be-ignored-9999',    // 应被忽略
      modelName: 'deepseek-coder',
      label: 'DeepSeek Coder',
    })
    if (!out.ok) throw new Error(JSON.stringify(out))
    const row = await db.modelProviderConfig.findFirst({ where: { modelName: 'deepseek-coder' } })
    expect(row?.baseUrl).toBe(src.baseUrl) // 恶意/误填地址不生效
    expect(row?.apiKey).toBe(src.apiKey)
  })

  it('源配置不存在 → 明确报错不落库', async () => {
    const before = await db.modelProviderConfig.count()
    const out = await providerConfigService.create({
      channel: 'llm',
      reuseConfigId: 'nonexistent-id-000',
      modelName: 'x',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('不存在')
    const after = await db.modelProviderConfig.count()
    expect(after).toBe(before) // 零写入
  })

  it('复用后删除源行：其余行独立存活（行级独立，删除不级联）', async () => {
    const rows = await db.modelProviderConfig.findMany({ where: { baseUrl: 'https://api.deepseek.com/v1' } })
    expect(rows.length).toBeGreaterThanOrEqual(3) // 源 + 至少 2 个复用行
    const src = rows.find((r) => r.modelName === 'deepseek-chat')
    if (!src) throw new Error('前置：源应存在')

    await providerConfigService.remove(src.id)
    const rest = await db.modelProviderConfig.findMany({ where: { baseUrl: 'https://api.deepseek.com/v1' } })
    expect(rest.length).toBe(rows.length - 1)
    expect(rest.every((r) => r.apiKey === src.apiKey)).toBe(true) // 复用行不受影响
  })
})
