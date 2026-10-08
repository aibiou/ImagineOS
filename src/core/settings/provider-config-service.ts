// 模型服务配置领域服务（ADR-0004 / M1.5 Phase B；2026-10-08 提供商化重构）
// 两级结构：ModelProvider（地址+密钥一次配置）→ ModelProviderModel（模型绑定能力通道）。
// 职责：提供商/模型 CRUD + zod 校验 + 密钥打码 + 连接测试 + 模型真实验证 + 链缓存失效通知。
// 边界：本模块只依赖 db 与纯 fetch（测试），不绑定任何模型 SDK（§87）。
// AI 层（src/ai/router/provider-config）经 readAll() 读扁平行构建候选链——形状与旧单表完全一致。

import { z } from 'zod'
import { db } from '@/lib/db'

// ---------- 类型与校验 ----------

export const PROVIDER_CHANNELS = ['llm', 'image', 'tts', 'video'] as const
export type ProviderChannel = (typeof PROVIDER_CHANNELS)[number]

export const PROVIDER_TYPES = ['openai-compat'] as const
export type ProviderType = (typeof PROVIDER_TYPES)[number]

/** 提供商（连接级）输入 */
export const ModelProviderSchema = z.object({
  label: z.string().trim().min(1).max(40),
  providerType: z.enum(PROVIDER_TYPES),
  baseUrl: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(/^https?:\/\//i, '接口地址必须以 http(s):// 开头'),
  apiKey: z.string().trim().min(8).max(400),
  enabled: z.boolean().optional().default(true),
})

/** 模型（能力通道绑定）输入 */
export const ModelProviderModelSchema = z.object({
  channel: z.enum(PROVIDER_CHANNELS),
  modelName: z.string().trim().min(1).max(120),
  extraJson: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .nullable()
    .refine((v) => !v || (() => { try { JSON.parse(v); return true } catch { return false } })(), '附加参数必须是合法 JSON'),
  enabled: z.boolean().optional().default(true),
  priority: z.number().int().min(1).max(999).optional().default(100),
})

export type ModelProviderInput = z.infer<typeof ModelProviderSchema>
export type ModelProviderModelInput = z.infer<typeof ModelProviderModelSchema>

/** 扁平行形态（AI 层消费；与旧单表 ModelProviderConfig 完全同形——registry/openai-compat 零改动） */
export interface ProviderConfigRow {
  id: string
  channel: string
  label: string
  providerType: string
  baseUrl: string
  apiKey: string
  modelName: string
  extraJson: string | null
  enabled: boolean
  priority: number
  lastTestStatus: string | null
  lastTestMessage: string | null
  lastTestedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** DB 行形态（Prisma ModelProvider，含模型） */
export interface ProviderRowWithModels {
  id: string
  label: string
  providerType: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  lastTestStatus: string | null
  lastTestMessage: string | null
  lastTestedAt: Date | null
  createdAt: Date
  updatedAt: Date
  models: Array<{
    id: string
    providerId: string
    channel: string
    modelName: string
    extraJson: string | null
    enabled: boolean
    priority: number
    lastTestStatus: string | null
    lastTestMessage: string | null
    lastTestedAt: Date | null
    createdAt: Date
    updatedAt: Date
  }>
}

// ---------- 掩码 ----------

const MASK = '••••••••'

/** 打码密钥：保留前 3 后 4（长度不足全掩） */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return MASK
  return `${key.slice(0, 3)}${MASK}${key.slice(-4)}`
}

/** 掩码哨兵：PATCH 收到掩码值 → 视为「不修改」 */
export function isMaskedKey(v: string): boolean {
  return v.includes(MASK)
}

// ---------- 变更通知（AI 层链缓存失效钩子，避免 core → ai 反向依赖） ----------

type Listener = () => void
const listeners = new Set<Listener>()

/** AI 层注册：配置写入后收到通知以失效候选链缓存 */
export function onProviderConfigChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifyChanged(): void {
  for (const l of listeners) {
    try { l() } catch { /* 通知失败不影响写入 */ }
  }
}

// ---------- 内部读取与打码 ----------

async function loadProviders(): Promise<ProviderRowWithModels[]> {
  return (await db.modelProvider.findMany({
    orderBy: { createdAt: 'asc' },
    include: { models: { orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] } },
  })) as ProviderRowWithModels[]
}

/** 对外形态：密钥打码 */
function maskProvider(p: ProviderRowWithModels) {
  return { ...p, apiKey: maskApiKey(p.apiKey), models: p.models.map((m) => ({ ...m })) }
}

// ---------- CRUD ----------

export const providerConfigService = {
  /** 全量列表（提供商 + 内嵌模型；apiKey 打码） */
  async list(): Promise<Array<ProviderRowWithModels & { apiKey: string }>> {
    const rows = await loadProviders()
    return rows.map(maskProvider)
  },

  /** 新增提供商（一次配置地址与密钥；模型随后添加） */
  async createProvider(input: unknown): Promise<{ ok: true; item: Record<string, unknown> } | { ok: false; error: string; detail?: string }> {
    const parsed = ModelProviderSchema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        error: '提供商校验失败',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；'),
      }
    }
    const { enabled, ...rest } = parsed.data
    try {
      const row = await db.modelProvider.create({
        data: { ...rest, enabled: enabled ?? true, lastTestStatus: 'untested' },
        include: { models: true },
      })
      notifyChanged()
      return { ok: true, item: maskProvider(row as unknown as ProviderRowWithModels) }
    } catch (e) {
      const code = (e as { code?: string }).code
      const msg = e instanceof Error ? e.message : String(e)
      if (code === 'P2002' || /unique/i.test(msg)) {
        return { ok: false, error: '已有同名提供商——换一个显示名' }
      }
      return { ok: false, error: '创建失败', detail: msg }
    }
  },

  /** 更新提供商（apiKey 传掩码 = 不修改；地址/密钥变化 → 提供商连接测试账 + 旗下全部模型验证账重置为 untested） */
  async updateProvider(id: string, body: Record<string, unknown>): Promise<{ ok: true; item: Record<string, unknown> } | { ok: false; error: string; status: number }> {
    const existing = await db.modelProvider.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: '提供商不存在', status: 404 }

    const patch: Record<string, unknown> = {}
    for (const key of ['label', 'baseUrl', 'apiKey'] as const) {
      if (body[key] === undefined) continue
      if (key === 'apiKey' && typeof body[key] === 'string' && isMaskedKey(body[key])) continue // 掩码 = 不修改
      const v = ModelProviderSchema.shape[key].safeParse(body[key])
      if (!v.success) return { ok: false, error: `${key} 不合法：${v.error.issues[0]?.message ?? ''}`, status: 422 }
      patch[key] = v.data
    }
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled)
    if (Object.keys(patch).length === 0) return { ok: false, error: '没有可更新字段', status: 422 }

    // 连接三元组变化：提供商连接账重置 + 级联旗下全部模型的验证账重置（鉴权已换，旧验证结论作废）
    const connectionChanged = patch.baseUrl !== undefined || patch.apiKey !== undefined
    if (connectionChanged) {
      patch.lastTestStatus = 'untested'
      patch.lastTestMessage = null
      patch.lastTestedAt = null
    }

    const row = await db.modelProvider.update({ where: { id }, data: patch, include: { models: true } })
    if (connectionChanged) {
      await db.modelProviderModel.updateMany({
        where: { providerId: id },
        data: { lastTestStatus: 'untested', lastTestMessage: null, lastTestedAt: null },
      })
    }
    notifyChanged()
    const fresh = connectionChanged
      ? ((await db.modelProvider.findUnique({ where: { id }, include: { models: true } })) as unknown as ProviderRowWithModels)
      : (row as unknown as ProviderRowWithModels)
    return { ok: true, item: maskProvider(fresh) }
  },

  /** 删除提供商（级联删除旗下模型） */
  async removeProvider(id: string): Promise<{ ok: boolean }> {
    await db.modelProvider.delete({ where: { id } })
    notifyChanged()
    return { ok: true }
  },

  /** 为提供商添加模型（绑定能力通道；地址与密钥复用提供商，密钥不经过客户端） */
  async addModel(providerId: string, input: unknown): Promise<{ ok: true; item: Record<string, unknown> } | { ok: false; error: string; detail?: string; status?: number }> {
    const provider = await db.modelProvider.findUnique({ where: { id: providerId } })
    if (!provider) return { ok: false, error: '提供商不存在', status: 404 }
    const parsed = ModelProviderModelSchema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        error: '模型校验失败',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；'),
      }
    }
    const { extraJson, enabled, priority, ...rest } = parsed.data
    try {
      const model = await db.modelProviderModel.create({
        data: {
          ...rest,
          providerId,
          extraJson: extraJson ?? null,
          enabled: enabled ?? true,
          priority: priority ?? 100,
          lastTestStatus: 'untested',
        },
      })
      notifyChanged()
      return { ok: true, item: model }
    } catch (e) {
      const code = (e as { code?: string }).code
      const msg = e instanceof Error ? e.message : String(e)
      if (code === 'P2002' || /unique/i.test(msg)) {
        return { ok: false, error: '该模型已在同一通道下配置过（同提供商同通道同模型名去重）' }
      }
      return { ok: false, error: '添加失败', detail: msg }
    }
  },

  /** 更新模型（模型名/优先级/附加参数/启停/换通道） */
  async updateModel(modelId: string, body: Record<string, unknown>): Promise<{ ok: true; item: Record<string, unknown> } | { ok: false; error: string; status: number }> {
    const existing = await db.modelProviderModel.findUnique({ where: { id: modelId } })
    if (!existing) return { ok: false, error: '模型不存在', status: 404 }

    const patch: Record<string, unknown> = {}
    for (const key of ['channel', 'modelName', 'priority'] as const) {
      if (body[key] === undefined) continue
      const v = ModelProviderModelSchema.shape[key].safeParse(body[key])
      if (!v.success) return { ok: false, error: `${key} 不合法：${v.error.issues[0]?.message ?? ''}`, status: 422 }
      patch[key] = v.data
    }
    if (body.extraJson !== undefined) {
      if (body.extraJson === null || body.extraJson === '') {
        patch.extraJson = null
      } else {
        const v = ModelProviderModelSchema.shape.extraJson.safeParse(body.extraJson)
        if (!v.success) return { ok: false, error: '附加参数必须是合法 JSON', status: 422 }
        patch.extraJson = v.data
      }
    }
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled)

    if (Object.keys(patch).length === 0) return { ok: false, error: '没有可更新字段', status: 422 }
    if (patch.modelName !== undefined || patch.channel !== undefined) {
      patch.lastTestStatus = 'untested'
      patch.lastTestMessage = null
      patch.lastTestedAt = null
    }

    try {
      const row = await db.modelProviderModel.update({ where: { id: modelId }, data: patch })
      notifyChanged()
      return { ok: true, item: row }
    } catch (e) {
      const code = (e as { code?: string }).code
      const msg = e instanceof Error ? e.message : String(e)
      if (code === 'P2002' || /unique/i.test(msg)) {
        return { ok: false, error: '该模型已在同一通道下配置过', status: 422 }
      }
      return { ok: false, error: '更新失败', status: 500 }
    }
  },

  /** 删除模型（提供商与连接保留） */
  async removeModel(modelId: string): Promise<{ ok: boolean }> {
    await db.modelProviderModel.delete({ where: { id: modelId } })
    notifyChanged()
    return { ok: true }
  },

  /** 提供商连接测试并落账（GET {baseUrl}/models 零消耗）：
   *  返回 null = 提供商不存在（路由层转 404）。 */
  async testProviderConnection(id: string): Promise<ConnectionTestResult | null> {
    const row = await db.modelProvider.findUnique({ where: { id } })
    if (!row) return null
    const result = await testOpenAiCompatConnection({ baseUrl: row.baseUrl, apiKey: row.apiKey })
    await db.modelProvider.update({
      where: { id },
      data: {
        lastTestStatus: result.ok ? 'ok' : 'failed',
        lastTestMessage: result.message,
        lastTestedAt: new Date(),
      },
    })
    return result
  },

  /** 模型真实验证并落账（按通道最小真实调用；需 join 提供商取密钥）。
   *  返回 null = 模型不存在。 */
  async verifyModel(modelId: string): Promise<
    | { ok: true; provider: { id: string; label: string }; result: ModelVerifyResult & { modelsCount: number } }
    | { ok: false; error: string; status: number }
    | null
  > {
    const model = await db.modelProviderModel.findUnique({ where: { id: modelId }, include: { provider: true } })
    if (!model) return null
    const list = await fetchAvailableModels({ baseUrl: model.provider.baseUrl, apiKey: model.provider.apiKey })
    const verify = await verifyModelForChannel(model.channel, {
      baseUrl: model.provider.baseUrl,
      apiKey: model.provider.apiKey,
      modelName: model.modelName,
      extraJson: model.extraJson,
    }, list.ok ? list.models : [])
    const message = `模型「${model.modelName}」${verify.ok ? '验证通过' : '验证失败'}：${verify.detail}`
    await db.modelProviderModel.update({
      where: { id: modelId },
      data: {
        lastTestStatus: verify.ok ? 'ok' : 'fail',
        lastTestMessage: message.slice(0, 500),
        lastTestedAt: new Date(),
      },
    })
    return {
      ok: true,
      provider: { id: model.provider.id, label: model.provider.label },
      result: { ...verify, modelsCount: list.ok ? list.models.length : 0, detail: message },
    }
  },

  /** 内部读取（含明文密钥；仅供 AI 层链构建——不对外暴露）。
   *  扁平行 = 提供商 join 模型；形状与旧单表 ModelProviderConfig 完全一致：
   *  - id = 模型 id（链构建/冷却/轮转的粒度）
   *  - label = 「提供商·模型」（保证 openai-compat:{label} 的 provider.id 唯一）
   *  - enabled = 模型启停 AND 提供商总开关
   *  - updatedAt = max(提供商, 模型)（configSignature 能感知密钥变更——密钥在提供商行上） */
  async readAll(): Promise<ProviderConfigRow[]> {
    const providers = await loadProviders()
    const rows: ProviderConfigRow[] = []
    for (const p of providers) {
      for (const m of p.models) {
        rows.push({
          id: m.id,
          channel: m.channel,
          label: `${p.label}·${m.modelName}`,
          providerType: p.providerType,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          modelName: m.modelName,
          extraJson: m.extraJson,
          enabled: m.enabled && p.enabled,
          priority: m.priority,
          lastTestStatus: m.lastTestStatus,
          lastTestMessage: m.lastTestMessage,
          lastTestedAt: m.lastTestedAt,
          createdAt: m.createdAt,
          updatedAt: p.updatedAt > m.updatedAt ? p.updatedAt : m.updatedAt,
        })
      }
    }
    return rows
  },

  /** 按 id 内部读取提供商（含明文密钥；供「拉取模型列表」路由复用已存密钥） */
  async readProviderById(id: string): Promise<ProviderRowWithModels | null> {
    return (await db.modelProvider.findUnique({ where: { id }, include: { models: true } })) as ProviderRowWithModels | null
  },
}

// ---------- 连接测试 ----------

export interface ConnectionTestResult {
  ok: boolean
  message: string
  latencyMs: number
}

/** 拼接 baseUrl 与路径（容忍尾斜杠差异） */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

/**
 * OpenAI 兼容连接测试：GET {baseUrl}/models（标准端点，零消耗）。
 */
export async function testOpenAiCompatConnection(row: {
  baseUrl: string
  apiKey: string
}): Promise<ConnectionTestResult> {
  const startedAt = Date.now()
  const url = joinUrl(row.baseUrl, '/models')
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${row.apiKey}` },
      signal: controller.signal,
    })
    clearTimeout(timer)
    const latencyMs = Date.now() - startedAt
    if (!res.ok) {
      const bodyText = (await res.text()).slice(0, 200)
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: `密钥无效（HTTP ${res.status}）`, latencyMs }
      }
      return { ok: false, message: `HTTP ${res.status}：${bodyText || '无返回内容'}`, latencyMs }
    }
    let countHint = ''
    try {
      const data = (await res.json()) as { data?: Array<{ id?: string }> }
      const ids = Array.isArray(data?.data) ? data.data.map((m) => m?.id).filter(Boolean) : []
      if (ids.length > 0) countHint = `，服务返回 ${ids.length} 个模型`
    } catch {
      /* /models 返回非 JSON 不影响判定 */
    }
    return { ok: true, message: `连接成功（${latencyMs}ms${countHint}）`, latencyMs }
  } catch (e) {
    const latencyMs = Date.now() - startedAt
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: `连接失败：${msg.includes('abort') ? '超时（>15s）' : msg}`, latencyMs }
  }
}

// ---------- 模型列表拉取（GET /models，零消耗；供表单「获取模型列表」按钮） ----------

export interface ModelListResult {
  ok: boolean
  models: string[]
  message: string
  latencyMs: number
}

/** 拉取该密钥有权限的模型列表（OpenAI 兼容 /models 端点；部分服务不实现则明确提示手填） */
export async function fetchAvailableModels(row: { baseUrl: string; apiKey: string }): Promise<ModelListResult> {
  const startedAt = Date.now()
  const url = joinUrl(row.baseUrl, '/models')
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${row.apiKey}` },
      signal: controller.signal,
    })
    clearTimeout(timer)
    const latencyMs = Date.now() - startedAt
    if (!res.ok) {
      const bodyText = (await res.text()).slice(0, 200)
      if (res.status === 401 || res.status === 403) {
        return { ok: false, models: [], message: `密钥无效（HTTP ${res.status}）`, latencyMs }
      }
      if (res.status === 404) {
        return { ok: false, models: [], message: '该服务不提供 /models 列表（404）——请手动填写模型名', latencyMs }
      }
      return { ok: false, models: [], message: `HTTP ${res.status}：${bodyText || '无返回内容'}`, latencyMs }
    }
    const data = (await res.json().catch(() => null)) as { data?: Array<{ id?: string } | string> } | null
    const raw = Array.isArray(data?.data) ? (data?.data ?? []) : []
    const ids = raw
      .map((m) => (typeof m === 'string' ? m : m?.id))
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
    return { ok: true, models: ids, message: `获取到 ${ids.length} 个模型（${latencyMs}ms）`, latencyMs }
  } catch (e) {
    const latencyMs = Date.now() - startedAt
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, models: [], message: `连接失败：${msg.includes('abort') ? '超时（>15s）' : msg}`, latencyMs }
  }
}

// ---------- 模型真实验证（按通道最小调用） ----------

export interface ModelVerifyResult {
  ok: boolean
  detail: string
  latencyMs: number
}

/** 服务内轻量请求（纯 fetch；core 层禁依赖 @/ai，故不复用适配器 helper） */
async function lightRequest(
  method: 'GET' | 'POST',
  url: string,
  apiKey: string,
  body?: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<{ ok: boolean; status: number; json: unknown; bytes: Buffer | null; contentType: string; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    })
    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300)
      // 尽量解析 JSON 错误体（供 jsonErrorMessage 提取可读信息）
      let json: unknown = null
      if (contentType.includes('application/json')) {
        try { json = JSON.parse(text) } catch { /* 保底用文本 */ }
      }
      return { ok: false, status: res.status, json, bytes: null, contentType, error: `HTTP ${res.status}：${text || '无返回内容'}` }
    }
    if (contentType.includes('application/json')) {
      return { ok: true, status: res.status, json: await res.json(), bytes: null, contentType }
    }
    return { ok: true, status: res.status, json: null, bytes: Buffer.from(await res.arrayBuffer()), contentType }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, status: 0, json: null, bytes: null, contentType: '', error: msg.includes('abort') ? `超时（>${timeoutMs}ms）` : msg }
  } finally {
    clearTimeout(timer)
  }
}

/** 从 JSON 错误体提取可读信息 */
function jsonErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  const err = j.error
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  if (typeof err === 'string') return err
  if (typeof j.message === 'string') return j.message
  return null
}

/**
 * 按通道对所选模型做真实最小调用，验证「这个模型真的能用」：
 * - llm：真实对话一次（max_tokens 极小，近零消耗）
 * - tts：真实合成一句（短文本，极小消耗）
 * - image：真实生成一张测试图（消耗一次生成额度，UI 侧已二次确认）
 * - video：不做真实生成（成本高）——按 /models 列表存在性给出说明
 */
export async function verifyModelForChannel(
  channel: string,
  row: { baseUrl: string; apiKey: string; modelName: string; extraJson: string | null },
  modelsFromList?: string[],
): Promise<ModelVerifyResult> {
  const extra = parseExtra(row)
  const startedAt = Date.now()

  if (channel === 'llm') {
    const out = await lightRequest(
      'POST',
      joinUrl(row.baseUrl, '/chat/completions'),
      row.apiKey,
      {
        model: row.modelName,
        messages: [{ role: 'user', content: '连接测试' }],
        max_tokens: 8,
        stream: false,
        ...(typeof extra.temperature === 'number' ? { temperature: extra.temperature } : {}),
      },
      30_000,
    )
    const latencyMs = Date.now() - startedAt
    if (!out.ok) {
      if (out.status === 404) return { ok: false, detail: `模型不存在或不可用（404）${jsonErrorMessage(out.json) ? `：${jsonErrorMessage(out.json)}` : ''}`, latencyMs }
      if (out.status === 401 || out.status === 403) return { ok: false, detail: `密钥无权调用该模型（HTTP ${out.status}）`, latencyMs }
      return { ok: false, detail: out.error ?? '请求失败', latencyMs }
    }
    const content = (out.json as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]?.message?.content
    const sample = (typeof content === 'string' ? content : '').trim().slice(0, 30)
    return { ok: true, detail: `真实对话成功${sample ? `，回复「${sample}」` : ''}（${latencyMs}ms）`, latencyMs }
  }

  if (channel === 'tts') {
    const out = await lightRequest(
      'POST',
      joinUrl(row.baseUrl, '/audio/speech'),
      row.apiKey,
      {
        model: row.modelName,
        input: '连接测试',
        voice: typeof extra.voice === 'string' ? extra.voice : 'alloy',
        response_format: typeof extra.response_format === 'string' ? extra.response_format : 'wav',
      },
      60_000,
    )
    const latencyMs = Date.now() - startedAt
    if (!out.ok) {
      if (out.status === 404) return { ok: false, detail: `模型不存在或不可用（404）${jsonErrorMessage(out.json) ? `：${jsonErrorMessage(out.json)}` : ''}`, latencyMs }
      return { ok: false, detail: out.error ?? jsonErrorMessage(out.json) ?? '请求失败', latencyMs }
    }
    if (!out.bytes || out.bytes.length < 256) {
      return { ok: false, detail: `返回音频异常（${out.bytes?.length ?? 0} 字节）`, latencyMs }
    }
    return { ok: true, detail: `真实合成成功（${out.bytes.length} 字节音频，${latencyMs}ms）`, latencyMs }
  }

  if (channel === 'image') {
    const out = await lightRequest(
      'POST',
      joinUrl(row.baseUrl, '/images/generations'),
      row.apiKey,
      {
        model: row.modelName,
        prompt: '连接测试',
        ...(typeof extra.size === 'string' ? { size: extra.size } : {}),
      },
      120_000,
    )
    const latencyMs = Date.now() - startedAt
    if (!out.ok) {
      if (out.status === 404) return { ok: false, detail: `模型不存在或不可用（404）${jsonErrorMessage(out.json) ? `：${jsonErrorMessage(out.json)}` : ''}`, latencyMs }
      if (out.status === 401 || out.status === 403) return { ok: false, detail: `密钥无权调用该模型（HTTP ${out.status}）`, latencyMs }
      return { ok: false, detail: out.error ?? jsonErrorMessage(out.json) ?? '请求失败', latencyMs }
    }
    type ImageEntry = { b64_json?: string; base64?: string; url?: string }
    const json = out.json as { data?: ImageEntry[]; images?: ImageEntry[] } | null
    const entry = json?.data?.[0] ?? json?.images?.[0]
    const hasB64 = typeof (entry?.b64_json ?? entry?.base64) === 'string'
    const hasUrl = typeof entry?.url === 'string'
    if (!hasB64 && !hasUrl) {
      return { ok: false, detail: '请求成功但返回中无图像数据（该模型可能不支持生图）', latencyMs }
    }
    return { ok: true, detail: `真实生成成功（已消耗一次测试生图，${latencyMs}ms）`, latencyMs }
  }

  // video：真实生成成本高且慢（分钟级），不做实调——按列表存在性说明
  if (Array.isArray(modelsFromList) && modelsFromList.length > 0) {
    if (modelsFromList.includes(row.modelName)) {
      return { ok: true, detail: '模型在服务列表中；视频生成成本高跳过实调，真实可用性以首个创作任务为准', latencyMs: Date.now() - startedAt }
    }
    return { ok: true, detail: `连接可用；模型列表（${modelsFromList.length} 个）中未见该模型，请确认名称——视频生成成本高跳过实调`, latencyMs: Date.now() - startedAt }
  }
  return { ok: true, detail: '该服务未返回模型列表；视频生成成本高跳过实调，真实可用性以首个创作任务为准', latencyMs: Date.now() - startedAt }
}

// ---------- 附加参数解析 ----------

/** 解析 extraJson → 对象（坏 JSON 忽略） */
export function parseExtra(row: { extraJson: string | null }): Record<string, unknown> {
  if (!row.extraJson) return {}
  try {
    const parsed = JSON.parse(row.extraJson)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
