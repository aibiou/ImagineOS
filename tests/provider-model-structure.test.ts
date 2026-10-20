// 提供商-模型两级结构测试（2026-10-08 提供商化重构）
// 产品负责人指令：按提供商配置——地址与密钥只录一次，旗下挂多个模型绑不同能力通道。
// 覆盖：一次配置多模型多通道（连接零重复落库）/ readAll 扁平行语义（label/enabled/updatedAt）
//      / 密钥修改级联重置测试账 + 签名可感知 / 总开关 / 级联删除 / 去重约束 / 掩码哨兵。
// 铁律：走 vitest 隔离库（tests/global-setup.ts 每轮重建），不触网。
import { describe, it, expect, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  providerConfigService,
  maskApiKey,
  type ProviderConfigRow,
} from '@/core/settings/provider-config-service'
import { buildChainsFromConfigs } from '@/ai/router/registry'

const db = new PrismaClient()

afterAll(async () => {
  await db.modelProvider.deleteMany()
  await db.$disconnect()
})

describe('提供商化结构：一次配置连接，多模型多通道', () => {
  it('createProvider + addModel×3通道：DB 连接只存一份（提供商表 1 行），模型表 3 行', async () => {
    const created = await providerConfigService.createProvider({
      label: '智谱',
      providerType: 'openai-compat',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'sk-zhipu-test-key-123456',
    })
    if (!created.ok) throw new Error(`提供商创建失败：${JSON.stringify(created)}`)
    const pid = (created.item as { id: string }).id

    for (const [channel, modelName] of [
      ['llm', 'glm-4-flash'],
      ['image', 'cogview-3-flash'],
      ['video', 'cogvideox-3'],
    ] as const) {
      const m = await providerConfigService.addModel(pid, { channel, modelName, priority: 10 })
      if (!m.ok) throw new Error(JSON.stringify(m))
    }

    // 连接零重复：密钥/地址只在 ModelProvider 一行
    const providers = await db.modelProvider.findMany({ where: { label: '智谱' }, include: { models: true } })
    expect(providers).toHaveLength(1)
    expect(providers[0]?.apiKey).toBe('sk-zhipu-test-key-123456')
    expect(providers[0]?.models).toHaveLength(3)
    expect(new Set(providers[0]?.models.map((m) => m.channel))).toEqual(new Set(['llm', 'image', 'video']))

    // 对外列表打码
    const list = await providerConfigService.list()
    const zhipu = list.find((p) => p.label === '智谱')
    expect(zhipu?.apiKey).toBe(maskApiKey('sk-zhipu-test-key-123456'))
    expect(zhipu?.models).toHaveLength(3)
  })

  it('readAll() 扁平行：label=提供商·模型、enabled=模型∧提供商、id=模型 id', async () => {
    const zhipu = await db.modelProvider.findUnique({ where: { label: '智谱' }, include: { models: true } })
    if (!zhipu) throw new Error('前置：智谱应存在')
    // 停用一个模型（cogview），观察扁平行
    const cogview = zhipu.models.find((m) => m.modelName === 'cogview-3-flash')
    if (!cogview) throw new Error('前置：cogview 应存在')
    await db.modelProviderModel.update({ where: { id: cogview.id }, data: { enabled: false } })

    const rows: ProviderConfigRow[] = await providerConfigService.readAll()
    const zhipuRows = rows.filter((r) => r.baseUrl === 'https://open.bigmodel.cn/api/paas/v4')
    expect(zhipuRows).toHaveLength(3)

    const llmRow = zhipuRows.find((r) => r.channel === 'llm')
    expect(llmRow?.id).toBe(zhipu.models.find((m) => m.channel === 'llm')?.id) // id = 模型 id
    expect(llmRow?.label).toBe('智谱·glm-4-flash') // 链显示 + provider.id 唯一性来源
    expect(llmRow?.apiKey).toBe('sk-zhipu-test-key-123456') // 明文（AI 层内部用）
    expect(llmRow?.enabled).toBe(true)

    const imageRow = zhipuRows.find((r) => r.channel === 'image')
    expect(imageRow?.enabled).toBe(false) // 模型停用 → 扁平 false

    // 还原
    await db.modelProviderModel.update({ where: { id: cogview.id }, data: { enabled: true } })
  })

  it('buildChainsFromConfigs 消费扁平行：同提供商三通道各归其链', async () => {
    const rows = await providerConfigService.readAll()
    const zhipu = await db.modelProvider.findUnique({ where: { label: '智谱' } })
    if (!zhipu) throw new Error('前置')
    const chains = buildChainsFromConfigs(rows.filter((r) => r.baseUrl === 'https://open.bigmodel.cn/api/paas/v4'))
    expect(chains.text.map((p) => p.model)).toEqual(['glm-4-flash'])
    expect(chains.image.map((p) => p.model)).toEqual(['cogview-3-flash'])
    expect(chains.video.map((p) => p.model)).toEqual(['cogvideox-3'])
    expect(chains.text[0]?.id).toBe('openai-compat:智谱·glm-4-flash') // provider.id 唯一（模型粒度）
  })

  it('提供商总开关关掉 → 旗下全部模型退出候选链（连接与模型配置保留）', async () => {
    const zhipu = await db.modelProvider.findUnique({ where: { label: '智谱' } })
    if (!zhipu) throw new Error('前置')
    await providerConfigService.updateProvider(zhipu.id, { enabled: false })

    const rows = await providerConfigService.readAll()
    const zhipuRows = rows.filter((r) => r.baseUrl === 'https://open.bigmodel.cn/api/paas/v4')
    expect(zhipuRows.every((r) => r.enabled === false)).toBe(true)
    const chains = buildChainsFromConfigs(zhipuRows)
    expect(chains.text).toHaveLength(0)
    expect(chains.image).toHaveLength(0)

    // 模型行仍在（可随时恢复）
    const count = await db.modelProviderModel.count({ where: { providerId: zhipu.id } })
    expect(count).toBe(3)
    await providerConfigService.updateProvider(zhipu.id, { enabled: true })
  })

  it('改密钥：提供商连接账重置 + 旗下全部模型验证账级联重置；扁平行 updatedAt 变化可被 configSignature 感知', async () => {
    const zhipu = await db.modelProvider.findUnique({ where: { label: '智谱' }, include: { models: true } })
    if (!zhipu) throw new Error('前置')

    // 先把模型验证账置为 ok（模拟已验证）
    await db.modelProviderModel.updateMany({
      where: { providerId: zhipu.id },
      data: { lastTestStatus: 'ok', lastTestMessage: 'x', lastTestedAt: new Date() },
    })
    const before = await providerConfigService.readAll()
    const beforeSig = before.filter((r) => r.baseUrl.includes('bigmodel')).map((r) => `${r.id}:${r.updatedAt.toISOString()}`).join('|')

    // 改密钥（新值）
    const out = await providerConfigService.updateProvider(zhipu.id, { apiKey: 'sk-zhipu-rotated-key-999' })
    expect(out.ok).toBe(true)

    const fresh = await db.modelProvider.findUnique({ where: { id: zhipu.id }, include: { models: true } })
    expect(fresh?.apiKey).toBe('sk-zhipu-rotated-key-999') // 一处修改
    expect(fresh?.lastTestStatus).toBe('untested') // 连接账重置
    expect(fresh?.models.every((m) => m.lastTestStatus === 'untested')).toBe(true) // 全部模型账级联重置

    // 密钥只存一份：所有扁平行立即共用新钥
    const after = await providerConfigService.readAll()
    const afterRows = after.filter((r) => r.baseUrl.includes('bigmodel'))
    expect(afterRows.every((r) => r.apiKey === 'sk-zhipu-rotated-key-999')).toBe(true)

    // updatedAt 前后变化（签名感知密钥轮换——registry 会重建链）
    const afterSig = afterRows.map((r) => `${r.id}:${r.updatedAt.toISOString()}`).join('|')
    expect(afterSig).not.toBe(beforeSig)
  })

  it('掩码哨兵：PATCH 传打码密钥 = 不修改（编辑表单回显安全）', async () => {
    const zhipu = await db.modelProvider.findUnique({ where: { label: '智谱' } })
    if (!zhipu) throw new Error('前置')
    // 真实表单回显场景：label 一并提交，密钥传打码值
    const out = await providerConfigService.updateProvider(zhipu.id, { label: zhipu.label, apiKey: maskApiKey(zhipu.apiKey) })
    expect(out.ok).toBe(true)
    const fresh = await db.modelProvider.findUnique({ where: { id: zhipu.id } })
    expect(fresh?.apiKey).toBe(zhipu.apiKey) // 原值不动
    expect(fresh?.lastTestStatus).toBe('untested') // 未动连接字段——测试账不重置（保持上一轮改钥后的 untested）
  })

  it('同提供商同通道同模型名去重；不同通道同名放行', async () => {
    const zhipu = await db.modelProvider.findUnique({ where: { label: '智谱' } })
    if (!zhipu) throw new Error('前置')
    const dup = await providerConfigService.addModel(zhipu.id, { channel: 'llm', modelName: 'glm-4-flash' })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toContain('去重')
    const cross = await providerConfigService.addModel(zhipu.id, { channel: 'tts', modelName: 'glm-4-flash' })
    expect(cross.ok).toBe(true)
  })

  it('removeModel 保留提供商；removeProvider 级联删模型', async () => {
    const zhipu = await db.modelProvider.findUnique({ where: { label: '智谱' }, include: { models: true } })
    if (!zhipu) throw new Error('前置')
    const tts = zhipu.models.find((m) => m.channel === 'tts')
    if (!tts) throw new Error('前置：tts 模型应存在')

    await providerConfigService.removeModel(tts.id)
    const afterDelModel = await db.modelProvider.findUnique({ where: { id: zhipu.id }, include: { models: true } })
    expect(afterDelModel?.models).toHaveLength(3) // 连接与其余模型保留

    await providerConfigService.removeProvider(zhipu.id)
    const gone = await db.modelProvider.findUnique({ where: { id: zhipu.id } })
    expect(gone).toBeNull()
    const orphanModels = await db.modelProviderModel.count({ where: { providerId: zhipu.id } })
    expect(orphanModels).toBe(0) // 级联清干净
  })
})

describe('同通道跨提供商候选链（扁平化后的既有语义回归）', () => {
  it('两个提供商各挂一个 llm 模型 → 按优先级入同一条链', async () => {
    const a = await providerConfigService.createProvider({
      label: 'AntLing', providerType: 'openai-compat',
      baseUrl: 'https://api.ant-ling.com/v1', apiKey: 'sk-antling-key-123456',
    })
    const b = await providerConfigService.createProvider({
      label: 'Agnes', providerType: 'openai-compat',
      baseUrl: 'https://apihub.agnes-ai.com/v1', apiKey: 'sk-agnes-key-1234567',
    })
    if (!a.ok || !b.ok) throw new Error('前置创建失败')
    await providerConfigService.addModel((a.item as { id: string }).id, { channel: 'llm', modelName: 'Ling-3.1-flash', priority: 5 })
    await providerConfigService.addModel((b.item as { id: string }).id, { channel: 'llm', modelName: 'agnes-3.0-flash', priority: 10 })

    const rows = await providerConfigService.readAll()
    const chains = buildChainsFromConfigs(rows)
    expect(chains.text.map((p) => p.id)).toEqual([
      'openai-compat:AntLing·Ling-3.1-flash',
      'openai-compat:Agnes·agnes-3.0-flash',
    ])
    // 清场（供后续测试轮转的干净库）
    await db.modelProvider.deleteMany()
  })
})
