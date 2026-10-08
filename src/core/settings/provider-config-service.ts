// 模型服务配置领域服务（ADR-0004 / M1.5 Phase B 解锁）
// 职责：配置 CRUD + zod 校验 + 密钥打码 + 连接测试 + 链缓存失效通知。
// 边界：本模块只依赖 db 与纯 fetch（连接测试），不绑定任何模型 SDK（§87）。
// AI 层（src/ai/router/provider-config）经本服务读取配置构建候选链。

import { z } from 'zod'
import { db } from '@/lib/db'

// ---------- 类型与校验 ----------

export const PROVIDER_CHANNELS = ['llm', 'image', 'tts', 'video'] as const
export type ProviderChannel = (typeof PROVIDER_CHANNELS)[number]

export const PROVIDER_TYPES = ['openai-compat'] as const
export type ProviderType = (typeof PROVIDER_TYPES)[number]

export const ModelProviderConfigSchema = z.object({
  channel: z.enum(PROVIDER_CHANNELS),
  label: z.string().trim().min(1).max(40),
  providerType: z.enum(PROVIDER_TYPES),
  baseUrl: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(/^https?:\/\//i, '接口地址必须以 http(s):// 开头'),
  apiKey: z.string().trim().min(8).max(400),
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

export type ModelProviderConfigInput = z.infer<typeof ModelProviderConfigSchema>

/** DB 行形态（Prisma ModelProviderConfig） */
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

// ---------- CRUD ----------

export const providerConfigService = {
  /** 全量列表（按通道分组排序；apiKey 打码） */
  async list(): Promise<Array<Omit<ProviderConfigRow, 'apiKey'> & { apiKey: string }>> {
    const rows = (await db.modelProviderConfig.findMany({
      orderBy: [{ channel: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
    })) as ProviderConfigRow[]
    return rows.map((r) => ({ ...r, apiKey: maskApiKey(r.apiKey) }))
  },

  /** 新增（校验通过才落库；成功后通知链失效）
   *  连接复用：传 reuseConfigId 时，baseUrl/apiKey/providerType 从源配置服务端复制
   *  （密钥不经过客户端）；label 缺省取 modelName——「配一次连接，加多个模型」。 */
  async create(input: unknown): Promise<{ ok: true; item: Record<string, unknown> } | { ok: false; error: string; detail?: string }> {
    let candidate: unknown = input
    if (input && typeof input === 'object' && typeof (input as Record<string, unknown>).reuseConfigId === 'string') {
      const reuseId = (input as Record<string, unknown>).reuseConfigId as string
      if (reuseId.length === 0) {
        return { ok: false, error: '复用的源配置 id 不能为空' }
      }
      const source = await db.modelProviderConfig.findUnique({ where: { id: reuseId } })
      if (!source) {
        return { ok: false, error: '要复用的连接不存在（可能已被删除），请重新选择' }
      }
      const raw: Record<string, unknown> = { ...(input as Record<string, unknown>) }
      delete raw.reuseConfigId
      // 连接三元组以源为准；客户端传不传都覆盖（复用语义 = 连接完全一致）
      raw.baseUrl = source.baseUrl
      raw.apiKey = source.apiKey
      raw.providerType = source.providerType
      // 显示名缺省 = 模型名（加模型的最小输入就一个模型名）
      if (typeof raw.label !== 'string' || raw.label.trim() === '') raw.label = raw.modelName
      candidate = raw
    }
    const parsed = ModelProviderConfigSchema.safeParse(candidate)
    if (!parsed.success) {
      return {
        ok: false,
        error: '配置校验失败',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；'),
      }
    }
    const { extraJson, enabled, priority, ...rest } = parsed.data
    const row = await db.modelProviderConfig.create({
      data: {
        ...rest,
        extraJson: extraJson ?? null,
        enabled: enabled ?? true,
        priority: priority ?? 100,
        lastTestStatus: 'untested',
      },
    })
    notifyChanged()
    return { ok: true, item: { ...row, apiKey: maskApiKey(row.apiKey) } }
  },

  /** 更新（apiKey 传掩码 = 不修改；连接相关字段变化重置测试状态） */
  async update(id: string, body: Record<string, unknown>): Promise<{ ok: true; item: Record<string, unknown> } | { ok: false; error: string; status: number }> {
    const existing = await db.modelProviderConfig.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: '配置不存在', status: 404 }

    const patch: Record<string, unknown> = {}
    const fields: Array<[string, 'label' | 'baseUrl' | 'apiKey' | 'modelName' | 'priority']> = [
      ['label', 'label'],
      ['baseUrl', 'baseUrl'],
      ['apiKey', 'apiKey'],
      ['modelName', 'modelName'],
      ['priority', 'priority'],
    ]
    for (const [key, schemaKey] of fields) {
      if (body[key] === undefined) continue
      if (key === 'apiKey' && typeof body[key] === 'string' && isMaskedKey(body[key])) continue // 掩码 = 不修改
      const v = ModelProviderConfigSchema.shape[schemaKey].safeParse(body[key])
      if (!v.success) return { ok: false, error: `${key} 不合法：${v.error.issues[0]?.message ?? ''}`, status: 422 }
      patch[key] = v.data
    }
    if (body.extraJson !== undefined) {
      if (body.extraJson === null || body.extraJson === '') {
        patch.extraJson = null
      } else {
        const v = ModelProviderConfigSchema.shape.extraJson.safeParse(body.extraJson)
        if (!v.success) return { ok: false, error: '附加参数必须是合法 JSON', status: 422 }
        patch.extraJson = v.data
      }
    }
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled)

    if (Object.keys(patch).length === 0) return { ok: false, error: '没有可更新字段', status: 422 }
    if (patch.apiKey !== undefined || patch.baseUrl !== undefined || patch.modelName !== undefined) {
      patch.lastTestStatus = 'untested'
      patch.lastTestMessage = null
      patch.lastTestedAt = null
    }

    const row = await db.modelProviderConfig.update({ where: { id }, data: patch })
    notifyChanged()
    return { ok: true, item: { ...row, apiKey: maskApiKey(row.apiKey) } }
  },

  /** 删除 */
  async remove(id: string): Promise<{ ok: boolean }> {
    await db.modelProviderConfig.delete({ where: { id } })
    notifyChanged()
    return { ok: true }
  },

  /** 内部读取（含明文密钥；仅供 AI 层链构建——不对外暴露） */
  async readAll(): Promise<ProviderConfigRow[]> {
    return (await db.modelProviderConfig.findMany({
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    })) as ProviderConfigRow[]
  },

  /** 按 id 内部读取（含明文密钥；供「拉取模型列表」路由复用已存密钥） */
  async readById(id: string): Promise<ProviderConfigRow | null> {
    return (await db.modelProviderConfig.findUnique({ where: { id } })) as ProviderConfigRow | null
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
 * 若模型名不在列表中仅提示（部分服务商不返回全量模型表）。
 */
export async function testOpenAiCompatConnection(row: {
  baseUrl: string
  apiKey: string
  modelName: string
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
    let modelHint = ''
    try {
      const data = (await res.json()) as { data?: Array<{ id?: string }> }
      const ids = Array.isArray(data?.data) ? data.data.map((m) => m?.id).filter(Boolean) : []
      if (ids.length > 0 && !ids.includes(row.modelName)) {
        modelHint = `；注意：模型列表（${ids.length} 个）中未见「${row.modelName}」，请确认名称`
      }
    } catch {
      /* /models 返回非 JSON 不影响判定 */
    }
    return { ok: true, message: `连接成功（${latencyMs}ms${modelHint}）`, latencyMs }
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

/** 执行连接测试 + 模型真实验证并落库测试结果 */
export async function runConnectionTest(id: string): Promise<
  { ok: true; result: ConnectionTestResult & { modelVerified: boolean; modelsCount: number } } | { ok: false; error: string; status: number }
> {
  const row = await db.modelProviderConfig.findUnique({ where: { id } })
  if (!row) return { ok: false, error: '配置不存在', status: 404 }

  let ok: boolean
  let message: string
  let modelVerified = false
  let modelsCount = 0

  const list = await fetchAvailableModels({ baseUrl: row.baseUrl, apiKey: row.apiKey })
  if (!list.ok) {
    ok = false
    message = `连接失败：${list.message}`
  } else {
    modelsCount = list.models.length
    const verify = await verifyModelForChannel(row.channel, row, list.models)
    ok = verify.ok
    modelVerified = verify.ok
    const listNote = list.models.length > 0 ? `（服务返回 ${list.models.length} 个模型）` : ''
    message = `连接成功${listNote}｜模型「${row.modelName}」${verify.ok ? '验证通过' : '验证失败'}：${verify.detail}`
  }

  await db.modelProviderConfig.update({
    where: { id },
    data: {
      lastTestStatus: ok ? 'ok' : 'fail',
      lastTestMessage: message.slice(0, 500),
      lastTestedAt: new Date(),
    },
  })
  return { ok: true, result: { ok, message, latencyMs: list.latencyMs, modelVerified, modelsCount } }
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
