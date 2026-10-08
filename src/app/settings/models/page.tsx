'use client'

// 设置 → 模型服务（ADR-0004 / 2026-10-08 提供商化重构）
// 结构：按「模型提供商」组织——地址与密钥只录一次，旗下挂多个模型；
//       每个模型绑定能力通道（对话/生图/配音/视频）。同一把钥匙管多个通道，零重复配置。
// 页面两块：通道生效链总览（保留四通道心智模型）+ 提供商卡片列表（连接与模型两级管理）。
// 这是面向开发/运维的能力页（非大众创作流），直接使用 LLM Provider / API Key 等技术词汇。

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Boxes, Check, ChevronDown, ListChecks, Loader2, Pencil, Plug, PlugZap, Plus, Settings2, ShieldCheck, Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { sortModelsForChannel } from '@/lib/model-catalog'

// ---------- 类型 ----------

interface ModelRow {
  id: string
  providerId: string
  channel: string
  modelName: string
  extraJson: string | null
  enabled: boolean
  priority: number
  lastTestStatus: string | null
  lastTestMessage: string | null
  lastTestedAt: string | null
  createdAt: string
}

interface ProviderRow {
  id: string
  label: string
  providerType: string
  baseUrl: string
  apiKey: string // 打码值
  enabled: boolean
  lastTestStatus: string | null
  lastTestMessage: string | null
  lastTestedAt: string | null
  models: ModelRow[]
  createdAt: string
}

// ---------- 常量 ----------

const CHANNELS = [
  { key: 'llm', name: '对话模型', full: '对话（LLM Provider）', builtin: '内置对话服务' },
  { key: 'image', name: '生图', full: '画面（Image Provider）', builtin: '内置画面服务' },
  { key: 'tts', name: '配音', full: '配音（TTS Provider）', builtin: '内置配音服务' },
  { key: 'video', name: '视频', full: '视频（Video Provider · 实验性）', builtin: '内置组合式视频' },
] as const

const CHANNEL_NAME: Record<string, string> = Object.fromEntries(CHANNELS.map((c) => [c.key, c.name]))
const BUILTIN: Record<string, string> = Object.fromEntries(CHANNELS.map((c) => [c.key, c.builtin]))

/** 新建提供商预设（只预填地址——模型在保存后于卡片内添加） */
const PROVIDER_PRESETS = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1' },
  { label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
  { label: '智谱GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { label: '蚂蚁百灵', baseUrl: 'https://api.ant-ling.com/v1' },
]

const INPUT_CLS = 'border-white/25! bg-black/40! text-zinc-100!'
const SELECT_CLS =
  'h-9 w-full rounded-md border border-white/25 bg-black/40 px-3 text-sm text-zinc-100 outline-none focus-visible:border-violet-400/60 [&>option]:bg-zinc-900 [&>option]:text-zinc-100'

// ---------- 小组件 ----------

function TestBadge({ status }: { status: string | null }) {
  if (status === 'ok') return <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/15">连接正常</Badge>
  if (status === 'fail' || status === 'failed') return <Badge variant="destructive">验证失败</Badge>
  if (status === 'untested') return <Badge variant="secondary">未测试</Badge>
  return <Badge variant="secondary">未测试</Badge>
}

function ChannelBadge({ channel }: { channel: string }) {
  const cls: Record<string, string> = {
    llm: 'border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/10',
    image: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/10',
    tts: 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/10',
    video: 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/10',
  }
  return <Badge variant="outline" className={`text-[11px] ${cls[channel] ?? ''}`}>{CHANNEL_NAME[channel] ?? channel}</Badge>
}

/** 通道当前生效链：启用的模型（priority 升序）→ 内置兜底 */
function ChainOverview({ providers }: { providers: ProviderRow[] }) {
  return (
    <Card className="border-white/10 bg-zinc-900/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">通道生效链</CardTitle>
          <span className="text-xs text-zinc-500">四条能力通道各自独立排序：自定义模型按优先级 → 内置兜底</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {CHANNELS.map((ch) => {
          const active = providers
            .filter((p) => p.enabled)
            .flatMap((p) => p.models.filter((m) => m.enabled && m.channel === ch.key).map((m) => ({ id: m.id, label: `${p.label}·${m.modelName}`, priority: m.priority, createdAt: m.createdAt })))
            .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt))
          return (
            <div key={ch.key} className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-300">
              <span className="w-[5.5rem] shrink-0 text-zinc-400">{ch.name}</span>
              {active.length === 0 ? (
                <>
                  <Badge variant="secondary" className="text-[11px]">{ch.builtin}</Badge>
                  <span className="text-zinc-500">（未配置自定义模型）</span>
                </>
              ) : (
                <>
                  {active.map((m, i) => (
                    <span key={m.id} className="flex items-center gap-1.5">
                      {i > 0 ? <span className="text-zinc-600">→</span> : null}
                      <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/30 hover:bg-violet-500/15">{m.label}</Badge>
                    </span>
                  ))}
                  <span className="text-zinc-600">→</span>
                  <Badge variant="secondary" className="text-[11px]">{ch.builtin}（兜底）</Badge>
                </>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ---------- 模型行 ----------

function ModelItem({
  model,
  providerLabel,
  verifying,
  verifyResult,
  onVerify,
  onToggle,
  onDelete,
  onSaved,
}: {
  model: ModelRow
  providerLabel: string
  verifying: boolean
  verifyResult: string | null
  onVerify: (m: ModelRow) => void
  onToggle: (m: ModelRow) => void
  onDelete: (m: ModelRow) => void
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return <ModelEditForm model={model} onSaved={() => { setEditing(false); onSaved() }} onCancel={() => setEditing(false)} />
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-black/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <ChannelBadge channel={model.channel} />
        <span className="min-w-0 break-all font-mono text-sm font-medium text-zinc-100">{model.modelName}</span>
        <TestBadge status={model.lastTestStatus} />
        {model.enabled ? (
          <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/30 hover:bg-violet-500/15">候选 · 第 {model.priority} 顺位</Badge>
        ) : (
          <Badge variant="secondary">已停用</Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
            编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onVerify(model)}
            disabled={verifying}
            title={`真实调用一次该模型（连接验证在提供商级已通过：${providerLabel}）`}
          >
            {verifying ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
            验证
          </Button>
          <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => onDelete(model)}>
            <Trash2 className="size-4" />
            删除
          </Button>
        </div>
      </div>
      {model.extraJson ? (
        <div className="text-[11px] text-zinc-400">附加参数：<span className="font-mono text-zinc-300">{model.extraJson}</span></div>
      ) : null}
      {verifyResult ?? model.lastTestMessage ? (
        <div className="text-xs text-zinc-300">{verifyResult ?? model.lastTestMessage}</div>
      ) : null}
      <div className="flex items-center gap-3">
        <Switch checked={model.enabled} onCheckedChange={() => onToggle(model)} aria-label="启用/停用模型" />
        <span className="text-[11px] text-zinc-500">参与该通道候选链（失败自动切换下一个）</span>
      </div>
    </div>
  )
}

// ---------- 模型编辑表单 ----------

function ModelEditForm({ model, onSaved, onCancel }: { model: ModelRow; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ channel: model.channel, modelName: model.modelName, priority: String(model.priority), extraJson: model.extraJson ?? '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/settings/model-providers/models/${model.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: form.channel,
          modelName: form.modelName.trim(),
          priority: Number(form.priority) || 100,
          extraJson: form.extraJson.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '保存失败')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-violet-500/25 bg-zinc-900/80 p-3">
      <div className="text-sm font-medium text-zinc-100">编辑模型</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>能力通道</Label>
          <div className="relative">
            <select value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))} className={`${SELECT_CLS} appearance-none pr-8`}>
              {CHANNELS.map((c) => (
                <option key={c.key} value={c.key}>{c.full}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>模型名称</Label>
          <Input className={INPUT_CLS} value={form.modelName} onChange={(e) => setForm((f) => ({ ...f, modelName: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>优先级（数字越小越先用）</Label>
          <Input className={INPUT_CLS} type="number" min={1} max={999} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>附加参数（JSON，可选）</Label>
          <Input className={INPUT_CLS} value={form.extraJson} placeholder='如 {"size":"1024x1536"}' onChange={(e) => setForm((f) => ({ ...f, extraJson: e.target.value }))} />
        </div>
      </div>
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div> : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving || !form.modelName.trim()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          保存修改
        </Button>
        <Button variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </div>
  )
}

// ---------- 添加模型表单（提供商内嵌；地址密钥已就位，只填模型） ----------

function AddModelForm({ providerId, onSaved, onCancel }: { providerId: string; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ channel: 'llm', modelName: '', priority: '10', extraJson: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 模型列表拉取（用提供商已存密钥，密钥不出服务器）
  const [modelList, setModelList] = useState<string[] | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchMsg, setFetchMsg] = useState<string | null>(null)

  const grouped = useMemo(
    () => (modelList ? sortModelsForChannel(form.channel, modelList) : { recommended: [], others: [] }),
    [modelList, form.channel],
  )

  const fetchModels = async () => {
    setFetchingModels(true)
    setFetchMsg(null)
    try {
      const res = await fetch('/api/settings/model-providers/remote-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setModelList(null)
        setFetchMsg(`✗ ${data.error ?? '获取失败'}`)
        return
      }
      const models: string[] = Array.isArray(data.models) ? data.models : []
      setModelList(models)
      const g = sortModelsForChannel(form.channel, models)
      setFetchMsg(
        models.length === 0
          ? '✓ 连接成功，但该服务未返回任何模型——请手动填写模型名'
          : `✓ 获取到 ${models.length} 个模型（推荐 ${g.recommended.length} 个），可在下方列表选择`,
      )
    } catch (e) {
      setFetchMsg(`✗ ${e instanceof Error ? e.message : '获取失败'}`)
    } finally {
      setFetchingModels(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/settings/model-providers/${providerId}/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: form.channel,
          modelName: form.modelName.trim(),
          priority: Number(form.priority) || 100,
          extraJson: form.extraJson.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '保存失败')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-violet-500/25 bg-zinc-900/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-100">添加模型</span>
        <span className="text-xs text-zinc-400">地址与密钥复用本提供商——只需选通道 + 填模型名</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>能力通道</Label>
          <div className="relative">
            <select value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))} className={`${SELECT_CLS} appearance-none pr-8`}>
              {CHANNELS.map((c) => (
                <option key={c.key} value={c.key}>{c.full}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label>模型名称（Model Name）</Label>
            <button
              type="button"
              onClick={fetchModels}
              disabled={fetchingModels}
              title="用本提供商已存密钥拉取可用模型列表（零消耗）"
              className="flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-300 transition hover:border-violet-400/60 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {fetchingModels ? <Loader2 className="size-3 animate-spin" /> : <ListChecks className="size-3" aria-hidden />}
              获取模型列表
            </button>
          </div>
          <Input className={INPUT_CLS} value={form.modelName} placeholder="如 deepseek-chat（或点右上按钮自动获取）" onChange={(e) => setForm((f) => ({ ...f, modelName: e.target.value }))} />
          {modelList && modelList.length > 0 ? (
            <div className="relative">
              <select
                value={form.modelName && modelList.includes(form.modelName) ? form.modelName : ''}
                onChange={(e) => setForm((f) => ({ ...f, modelName: e.target.value }))}
                className={`${SELECT_CLS} appearance-none pr-8`}
                aria-label="从可用模型列表中选择"
              >
                <option value="">从 {modelList.length} 个可用模型中选择…</option>
                {grouped.recommended.length > 0 ? (
                  <optgroup label={`推荐（匹配${CHANNEL_NAME[form.channel] ?? form.channel}能力）`}>
                    {grouped.recommended.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </optgroup>
                ) : null}
                {grouped.others.length > 0 ? (
                  <optgroup label="其他可用模型">
                    {grouped.others.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
            </div>
          ) : null}
          {fetchMsg ? (
            <p className={`text-[11px] ${fetchMsg.startsWith('✓') ? 'text-emerald-300/90' : 'text-red-300/90'}`}>{fetchMsg}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label>优先级（数字越小越先用）</Label>
          <Input className={INPUT_CLS} type="number" min={1} max={999} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>附加参数（JSON，可选）</Label>
          <Input className={INPUT_CLS} value={form.extraJson} placeholder='如 {"size":"1024x1536"} 或 {"voice":"alloy"}' onChange={(e) => setForm((f) => ({ ...f, extraJson: e.target.value }))} />
        </div>
      </div>
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div> : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving || !form.modelName.trim()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          保存并加入候选链
        </Button>
        <Button variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </div>
  )
}

// ---------- 提供商编辑表单（连接级：显示名/地址/密钥） ----------

function ProviderEditForm({ provider, onSaved, onCancel }: { provider: ProviderRow; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ label: provider.label, baseUrl: provider.baseUrl, apiKey: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = { label: form.label.trim(), baseUrl: form.baseUrl.trim() }
      if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim()
      const res = await fetch(`/api/settings/model-providers/${provider.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '保存失败')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-violet-500/25 bg-zinc-900/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-100">编辑提供商</span>
        <span className="text-xs text-zinc-400">修改地址或密钥后，旗下全部模型的测试状态自动重置为「未测试」</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>显示名</Label>
          <Input className={INPUT_CLS} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>接口地址（Endpoint）</Label>
          <Input className={INPUT_CLS} value={form.baseUrl} placeholder="https://api.example.com/v1" onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>密钥（API Key）</Label>
          <Input
            className={INPUT_CLS}
            type="password"
            value={form.apiKey}
            placeholder="留空 = 保持原密钥不变；输入新值则覆盖（旗下所有模型即刻共用新钥匙）"
            onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
          />
          <p className="text-[11px] text-zinc-400">当前密钥：<span className="font-mono text-zinc-300">{provider.apiKey}</span>（前3后4，中间打码）——改一次，旗下所有模型全部生效</p>
        </div>
      </div>
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div> : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving || !form.label.trim() || !form.baseUrl.trim()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          保存修改
        </Button>
        <Button variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </div>
  )
}

// ---------- 提供商卡片 ----------

function ProviderCard({
  provider,
  autoOpen,
  testing,
  testResult,
  verifyingId,
  verifyResults,
  onTest,
  onSaved,
  onDeleteProvider,
  onToggleProvider,
  onVerifyModel,
  onToggleModel,
  onDeleteModel,
}: {
  provider: ProviderRow
  autoOpen?: boolean
  testing: boolean
  testResult: string | null
  verifyingId: string | null
  verifyResults: Record<string, string>
  onTest: (p: ProviderRow) => void
  onSaved: () => void
  onDeleteProvider: (p: ProviderRow) => void
  onToggleProvider: (p: ProviderRow) => void
  onVerifyModel: (m: ModelRow) => void
  onToggleModel: (m: ModelRow) => void
  onDeleteModel: (m: ModelRow) => void
}) {
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(Boolean(autoOpen))

  if (editing) {
    return (
      <ProviderEditForm
        provider={provider}
        onSaved={() => { setEditing(false); onSaved() }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <Card className="border-white/10 bg-zinc-900/40">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Boxes className="size-4 text-violet-400" aria-hidden />
          <CardTitle className="text-base">{provider.label}</CardTitle>
          <Badge variant="outline" className="text-[11px] text-zinc-400">{provider.providerType}</Badge>
          <TestBadge status={provider.lastTestStatus} />
          {provider.models.length > 0 ? (
            <Badge variant="secondary" className="text-[11px]">{provider.models.filter((m) => m.enabled).length}/{provider.models.length} 模型启用</Badge>
          ) : (
            <Badge variant="secondary" className="text-[11px]">还没有模型</Badge>
          )}
          {!provider.enabled ? <Badge variant="secondary">已整体停用</Badge> : null}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => onTest(provider)} disabled={testing} title="验证地址 + 密钥（GET /models 零消耗）">
              {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
              测试连接
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
              编辑
            </Button>
            <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => onDeleteProvider(provider)}>
              <Trash2 className="size-4" />
              删除
            </Button>
          </div>
        </div>
        <div className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 bg-black/40">
          <div className="flex gap-3 px-3 py-2 text-sm">
            <span className="w-[4.5rem] shrink-0 text-zinc-400">接口地址</span>
            <span className="min-w-0 break-all font-mono text-zinc-100">{provider.baseUrl}</span>
          </div>
          <div className="flex gap-3 px-3 py-2 text-sm">
            <span className="w-[4.5rem] shrink-0 text-zinc-400">密钥</span>
            <span className="min-w-0 break-all font-mono text-zinc-100">{provider.apiKey}</span>
          </div>
        </div>
        {testResult ?? provider.lastTestMessage ? (
          <div className="text-xs text-zinc-300">{testResult ?? provider.lastTestMessage}</div>
        ) : null}
        <div className="flex items-center gap-3 pt-1">
          <Switch checked={provider.enabled} onCheckedChange={() => onToggleProvider(provider)} aria-label="提供商总开关" />
          <span className="text-[11px] text-zinc-500">总开关——关掉后旗下所有模型整体退出候选链（密钥与配置保留）</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {provider.models.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/15 px-4 py-5 text-center text-xs text-zinc-400">
            还没有添加模型——点下方按钮，选一个通道 + 填模型名即可（地址密钥不用再填）。
          </div>
        ) : (
          provider.models.map((m) => (
            <ModelItem
              key={m.id}
              model={m}
              providerLabel={provider.label}
              verifying={verifyingId === m.id}
              verifyResult={verifyResults[m.id] ?? null}
              onVerify={onVerifyModel}
              onToggle={onToggleModel}
              onDelete={onDeleteModel}
              onSaved={onSaved}
            />
          ))
        )}
        {adding ? (
          <AddModelForm
            providerId={provider.id}
            onSaved={() => { setAdding(false); onSaved() }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            添加模型
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- 新建提供商表单 ----------

function AddProviderForm({ onSaved, onCancel }: { onSaved: (newProviderId: string) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ label: '', baseUrl: '', apiKey: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchMsg, setFetchMsg] = useState<string | null>(null)
  const [modelList, setModelList] = useState<string[] | null>(null)

  const applyPreset = (p: { label: string; baseUrl: string }) => {
    setForm((f) => ({ ...f, baseUrl: p.baseUrl, label: f.label || p.label }))
  }

  const fetchModels = async () => {
    setFetchingModels(true)
    setFetchMsg(null)
    try {
      const res = await fetch('/api/settings/model-providers/remote-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setModelList(null)
        setFetchMsg(`✗ ${data.error ?? '获取失败'}`)
        return
      }
      const models: string[] = Array.isArray(data.models) ? data.models : []
      setModelList(models)
      setFetchMsg(
        models.length === 0
          ? '✓ 连接成功，但该服务未返回任何模型（保存后再手动添加模型名）'
          : `✓ 密钥可用——获取到 ${models.length} 个模型，保存后进卡片里添加`,
      )
    } catch (e) {
      setFetchMsg(`✗ ${e instanceof Error ? e.message : '获取失败'}`)
    } finally {
      setFetchingModels(false)
    }
  }

  const canFetch = form.baseUrl.trim().length > 0 && form.apiKey.trim().length > 0

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/model-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: form.label.trim(),
          providerType: 'openai-compat',
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error + (data.detail ? `：${data.detail}` : ''))
      onSaved(data.provider?.id ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-violet-500/25 bg-zinc-900/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-100">添加提供商</span>
        <span className="text-xs text-zinc-400">配置一次地址与密钥；保存后可在卡片里为对话/生图/配音/视频各通道添加模型</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {PROVIDER_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => applyPreset(p)}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300 transition hover:border-violet-400/40 hover:text-white"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>显示名</Label>
          <Input className={INPUT_CLS} value={form.label} placeholder="如：DeepSeek" onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>接口地址（Endpoint）</Label>
          <Input className={INPUT_CLS} value={form.baseUrl} placeholder="https://api.example.com/v1" onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <Label>密钥（API Key）</Label>
            <button
              type="button"
              onClick={fetchModels}
              disabled={fetchingModels || !canFetch}
              title={canFetch ? '保存前先验证密钥可用性并拉取模型列表（零消耗）' : '请先填写接口地址与密钥'}
              className="flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-300 transition hover:border-violet-400/60 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {fetchingModels ? <Loader2 className="size-3 animate-spin" /> : <ListChecks className="size-3" aria-hidden />}
              验证密钥并获取模型列表
            </button>
          </div>
          <Input
            className={INPUT_CLS}
            type="password"
            value={form.apiKey}
            placeholder="仅保存在本机沙箱数据库，页面显示时打码"
            onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
          />
          {fetchMsg ? (
            <p className={`text-[11px] ${fetchMsg.startsWith('✓') ? 'text-emerald-300/90' : 'text-red-300/90'}`}>{fetchMsg}</p>
          ) : null}
          {modelList && modelList.length > 0 ? (
            <p className="text-[11px] text-zinc-500">示例：{modelList.slice(0, 6).join('、')}{modelList.length > 6 ? ' 等' : ''}——保存后进卡片添加</p>
          ) : null}
        </div>
      </div>
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div> : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving || !form.label.trim() || !form.baseUrl.trim() || !form.apiKey.trim()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
          保存提供商
        </Button>
        <Button variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </div>
  )
}

// ---------- 页面 ----------

export default function ModelSettingsPage() {
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, string>>({})
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [verifyResults, setVerifyResults] = useState<Record<string, string>>({})
  const [addingProvider, setAddingProvider] = useState(false)
  const [justAddedId, setJustAddedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/model-providers')
      const data = await res.json()
      setProviders(data.providers ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggleProvider = async (p: ProviderRow) => {
    await fetch(`/api/settings/model-providers/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !p.enabled }),
    })
    load()
  }

  const testProvider = async (p: ProviderRow) => {
    setTestingId(p.id)
    try {
      const res = await fetch(`/api/settings/model-providers/${p.id}/test`, { method: 'POST' })
      const data = await res.json()
      setTestResults((r) => ({ ...r, [p.id]: data.ok ? `✓ ${data.message}` : `✗ ${data.message ?? data.error}` }))
      load()
    } finally {
      setTestingId(null)
    }
  }

  const removeProvider = async (p: ProviderRow) => {
    const modelCount = p.models.length
    const go = window.confirm(
      modelCount > 0
        ? `删除提供商「${p.label}」及其旗下 ${modelCount} 个模型？删除后这些模型立即退出候选链，生成任务回到下一候选。`
        : `删除提供商「${p.label}」？`,
    )
    if (!go) return
    await fetch(`/api/settings/model-providers/${p.id}`, { method: 'DELETE' })
    load()
  }

  const toggleModel = async (m: ModelRow) => {
    await fetch(`/api/settings/model-providers/models/${m.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !m.enabled }),
    })
    load()
  }

  const verifyModel = async (m: ModelRow) => {
    setVerifyingId(m.id)
    try {
      const res = await fetch(`/api/settings/model-providers/models/${m.id}/test`, { method: 'POST' })
      const data = await res.json()
      setVerifyResults((r) => ({ ...r, [m.id]: data.ok ? `✓ ${data.message}` : `✗ ${data.message ?? data.error}` }))
      load()
    } finally {
      setVerifyingId(null)
    }
  }

  const removeModel = async (m: ModelRow) => {
    if (!window.confirm(`删除模型「${m.modelName}」（通道：${CHANNEL_NAME[m.channel] ?? m.channel}）？提供商连接保留。`)) return
    await fetch(`/api/settings/model-providers/models/${m.id}`, { method: 'DELETE' })
    load()
  }

  /** 模型验证入口（图像通道先确认——真实消耗一次生图额度） */
  const confirmVerifyModel = (m: ModelRow) => {
    if (m.channel === 'image') {
      const go = window.confirm('图像模型验证会真实生成 1 张测试图（消耗少量额度），继续？')
      if (!go) return
    }
    void verifyModel(m)
  }

  const totalModels = useMemo(() => providers.reduce((n, p) => n + p.models.length, 0), [providers])

  return (
    <main className="dark min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="rounded-lg p-2 transition hover:bg-white/5" aria-label="返回首页">
            <ArrowLeft className="size-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Settings2 className="size-5 text-violet-400" />
            <h1 className="text-lg font-semibold tracking-tight">模型服务</h1>
            {providers.length > 0 ? (
              <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/30 hover:bg-violet-500/15">
                {providers.length} 个提供商 · {totalModels} 个模型
              </Badge>
            ) : null}
          </div>
          <div className="ml-auto hidden text-xs text-zinc-400 sm:block">按提供商配置 · 一次连接多模型复用 · 内置兜底</div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <section className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-transparent p-5">
          <h2 className="text-base font-semibold">一个提供商，配置一次</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">
            在这里接入任何 OpenAI 兼容的模型服务（OpenAI、DeepSeek、SiliconFlow、智谱、蚂蚁百灵、Agnes 等）。
            每个提供商只录一次接口地址和密钥，然后按需添加模型——同一个提供商的对话、生图、配音、视频模型共用同一套鉴权，
            互不重复。创作任务按各通道优先级依次调用：自定义模型在前，内置服务兜底，失败自动切换。
          </p>
          <div className="mt-4 grid gap-2 text-xs text-zinc-300 sm:grid-cols-3">
            <div className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-semibold text-violet-300">1</span>
              <span>添加提供商：名称 + 接口地址 + API Key（可先「验证密钥」确认可用再保存）</span>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-semibold text-violet-300">2</span>
              <span>在提供商卡片里「添加模型」：选能力通道 + 模型名（可一键拉取列表），地址密钥零重填</span>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-semibold text-violet-300">3</span>
              <span>「测试连接」验密钥、「验证」真实调用模型一次——通过即入候选链，失败自动切换下一家</span>
            </div>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-400">
            <ShieldCheck className="size-3.5" aria-hidden />
            密钥只保存在本机沙箱数据库，页面显示时打码（前 3 后 4）；改密钥在提供商级改一次，旗下所有模型即刻生效。
          </p>
        </section>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-zinc-400"><Loader2 className="size-6 animate-spin" /></div>
        ) : (
          <>
            <ChainOverview providers={providers} />

            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-200">模型提供商</h2>
                <span className="text-xs text-zinc-500">地址与密钥在这里管理；模型挂在各提供商卡片内</span>
                <div className="ml-auto">
                  <Button size="sm" onClick={() => { setAddingProvider(true); setJustAddedId(null) }}>
                    <Plus className="size-4" />
                    添加提供商
                  </Button>
                </div>
              </div>

              {addingProvider ? (
                <AddProviderForm
                  onSaved={(newId) => { setAddingProvider(false); setJustAddedId(newId); load() }}
                  onCancel={() => setAddingProvider(false)}
                />
              ) : null}

              {providers.length === 0 && !addingProvider ? (
                <div className="rounded-lg border border-dashed border-white/15 px-4 py-8 text-center text-sm text-zinc-400">
                  还没有配置任何提供商——点「添加提供商」，把你的 API Key 填进来即可接管对应通道；不配置则继续使用内置服务。
                </div>
              ) : null}

              {providers.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  autoOpen={justAddedId === p.id}
                  testing={testingId === p.id}
                  testResult={testResults[p.id] ?? null}
                  verifyingId={verifyingId}
                  verifyResults={verifyResults}
                  onTest={testProvider}
                  onSaved={load}
                  onDeleteProvider={removeProvider}
                  onToggleProvider={toggleProvider}
                  onVerifyModel={confirmVerifyModel}
                  onToggleModel={(m) => void toggleModel(m)}
                  onDeleteModel={(m) => void removeModel(m)}
                />
              ))}
            </section>
          </>
        )}

        <footer className="pb-8 text-center text-xs text-zinc-600">
          <Link href="/" className="transition hover:text-zinc-400">← 回到 ImagineOS</Link>
        </footer>
      </div>
    </main>
  )
}
