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

  /** 新增（校验通过才落库；成功后通知链失效） */
  async create(input: unknown): Promise<{ ok: true; item: Record<string, unknown> } | { ok: false; error: string; detail?: string }> {
    const parsed = ModelProviderConfigSchema.safeParse(input)
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

/** 执行连接测试并落库测试结果 */
export async function runConnectionTest(id: string): Promise<
  { ok: true; result: ConnectionTestResult } | { ok: false; error: string; status: number }
> {
  const row = await db.modelProviderConfig.findUnique({ where: { id } })
  if (!row) return { ok: false, error: '配置不存在', status: 404 }

  let result: ConnectionTestResult
  switch (row.providerType) {
    case 'openai-compat':
      result = await testOpenAiCompatConnection({
        baseUrl: row.baseUrl,
        apiKey: row.apiKey,
        modelName: row.modelName,
      })
      break
    default:
      return { ok: false, error: `暂不支持的服务商类型：${row.providerType}`, status: 422 }
  }

  await db.modelProviderConfig.update({
    where: { id },
    data: {
      lastTestStatus: result.ok ? 'ok' : 'fail',
      lastTestMessage: result.message.slice(0, 500),
      lastTestedAt: new Date(),
    },
  })
  return { ok: true, result }
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
