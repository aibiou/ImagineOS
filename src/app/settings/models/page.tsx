'use client'

// 设置 → 模型服务（ADR-0004 / 产品负责人 2026-10-06 指令）
// 目标：不因单一模型配额限制阻塞 ImagineOS——把外部模型服务配置进来，
//       生成任务自动按「自定义优先 → 内置兜底」的顺序调用，失败自动切换。
// 这是面向开发/运维的能力页（非大众创作流），按指令要求直接使用 LLM Provider /
// API Key / Endpoint 等技术词汇；创作流页面仍遵守用户语言规则。
// 2026-10-06 增补：内联编辑（改密钥/模型名不再删了重建）+ 通道生效链可视化 + 三步引导。

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Check, ChevronDown, ListChecks, Loader2, Pencil, Plug, PlugZap, Plus, Settings2, ShieldCheck, Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { sortModelsForChannel } from '@/lib/model-catalog'

// ---------- 常量 ----------

interface ConfigRow {
  id: string
  channel: string
  label: string
  providerType: string
  baseUrl: string
  apiKey: string // 打码值
  modelName: string
  extraJson: string | null
  enabled: boolean
  priority: number
  lastTestStatus: string | null
  lastTestMessage: string | null
  lastTestedAt: string | null
}

const CHANNELS = [
  {
    key: 'llm',
    name: '对话模型（LLM Provider）',
    desc: '理解你的表达、规划故事与分镜。所有文字理解与创作都走这条通道。',
    builtin: '内置对话服务',
    presets: [
      { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelName: 'gpt-4o-mini' },
      { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', modelName: 'deepseek-chat' },
      { label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', modelName: 'Qwen/Qwen2.5-72B-Instruct' },
      { label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', modelName: 'moonshot-v1-8k' },
      { label: '智谱GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelName: 'glm-4-flash' },
    ],
  },
  {
    key: 'image',
    name: '画面模型（Image Provider）',
    desc: '生成每一镜的画面。注意各家的尺寸参数不同，可用附加参数覆盖（如 {"size":"1024x1536"}）。',
    builtin: '内置画面服务',
    presets: [
      { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelName: 'gpt-image-1' },
      { label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', modelName: 'Kwai-Kolors/Kolors' },
      { label: '智谱GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelName: 'cogview-3-flash' },
    ],
  },
  {
    key: 'tts',
    name: '配音模型（TTS Provider）',
    desc: '朗读旁白。音色可用附加参数指定（如 {"voice":"alloy"}）。',
    builtin: '内置配音服务',
    presets: [
      { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelName: 'gpt-4o-mini-tts' },
      { label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', modelName: 'FunAudioLLM/CosyVoice2-0.5B' },
    ],
  },
  {
    key: 'video',
    name: '视频模型（Video Provider · 实验性）',
    desc: '让画面真正动起来（原生视频）。当前按 SiliconFlow 风格的提交/查询接口实现；不可用时自动回退内置通道。',
    builtin: '内置组合式视频',
    presets: [
      { label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', modelName: 'Wan2.2-T2V-A14B' },
    ],
  },
] as const

// ---------- 小组件 ----------

function TestBadge({ row }: { row: ConfigRow }) {
  if (row.lastTestStatus === 'ok') return <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/15">连接正常</Badge>
  if (row.lastTestStatus === 'fail') return <Badge variant="destructive">连接失败</Badge>
  return <Badge variant="secondary">未测试</Badge>
}

/** 通道当前生效链：启用的自定义（priority 升序）→ 内置兜底 */
function ChainPreview({ rows, builtin }: { rows: ConfigRow[]; builtin: string }) {
  const active = rows.filter((r) => r.enabled)
  if (active.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-300">
        <span className="text-zinc-400">当前调用：</span>
        <Badge variant="secondary" className="text-[11px]">{builtin}</Badge>
        <span className="text-zinc-400">（未配置自定义服务）</span>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-300">
      <span className="text-zinc-400">当前调用顺序：</span>
      {active.map((r, i) => (
        <span key={r.id} className="flex items-center gap-1.5">
          {i > 0 ? <span className="text-zinc-600">→</span> : null}
          <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/30 hover:bg-violet-500/15">
            {i + 1}. {r.label}
          </Badge>
        </span>
      ))}
      <span className="text-zinc-600">→</span>
      <Badge variant="secondary" className="text-[11px]">{builtin}（兜底）</Badge>
    </div>
  )
}

// ---------- 统一表单（新增 / 编辑） ----------

interface FormState {
  label: string
  baseUrl: string
  apiKey: string
  modelName: string
  priority: string
  extraJson: string
}

const EMPTY_FORM: FormState = { label: '', baseUrl: '', apiKey: '', modelName: '', priority: '10', extraJson: '' }

// 高对比输入框（暗色实底 + 清晰边框；! 确保覆盖组件默认令牌）
const INPUT_CLS = 'border-white/25! bg-black/40! text-zinc-100!'

// 高对比原生 select（与输入框同风格）
const SELECT_CLS =
  'h-9 w-full rounded-md border border-white/25 bg-black/40 px-3 text-sm text-zinc-100 outline-none focus-visible:border-violet-400/60 [&>option]:bg-zinc-900 [&>option]:text-zinc-100'

function ProviderForm({
  mode,
  channelKey,
  presets,
  allRows,
  initial,
  onSaved,
  onCancel,
}: {
  mode: 'add' | 'edit'
  channelKey: string
  presets: readonly { label: string; baseUrl: string; modelName: string }[]
  allRows: ConfigRow[]
  initial?: ConfigRow
  onSaved: () => void
  onCancel: () => void
}) {
  const editing = mode === 'edit'
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          label: initial.label,
          baseUrl: initial.baseUrl,
          apiKey: '',
          modelName: initial.modelName,
          priority: String(initial.priority),
          extraJson: initial.extraJson ?? '',
        }
      : EMPTY_FORM,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 模型列表拉取（一键获取该密钥可用模型，免去手敲）
  const [modelList, setModelList] = useState<string[] | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchMsg, setFetchMsg] = useState<string | null>(null)

  // 复用已有连接（仅 add 模式）：按 baseUrl 去重跨通道展开——「配一次连接，加多个模型」。
  // 同一服务商（如 OpenAI）的同一把钥匙往往管多个通道/多个模型，全部免重复输入。
  const connections = useMemo(() => {
    const map = new Map<string, ConfigRow>()
    for (const r of allRows) if (!map.has(r.baseUrl)) map.set(r.baseUrl, r)
    return [...map.values()]
  }, [allRows])
  const [reuseId, setReuseId] = useState('')
  const reusing = !editing && connections.length > 0 && reuseId !== ''
  const reuseSource = reusing ? (connections.find((c) => c.id === reuseId) ?? null) : null

  const grouped = useMemo(
    () => (modelList ? sortModelsForChannel(channelKey, modelList) : { recommended: [], others: [] }),
    [modelList, channelKey],
  )

  /** 复用模式：密钥在服务端；编辑模式未改密钥：复用已存密钥（configId）；新连接：密钥在表单 */
  const canFetchModels = reusing || (form.baseUrl.trim().length > 0 && (editing || form.apiKey.trim().length > 0))

  const fetchModels = async () => {
    setFetchingModels(true)
    setFetchMsg(null)
    try {
      const payload: Record<string, unknown> =
        reusing
          ? { configId: reuseId }
          : editing && !form.apiKey.trim()
            ? { configId: initial?.id }
            : { baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim() }
      const res = await fetch('/api/settings/model-providers/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setModelList(null)
        setFetchMsg(`✗ ${data.error ?? '获取失败'}`)
        return
      }
      const models: string[] = Array.isArray(data.models) ? data.models : []
      setModelList(models)
      const g = sortModelsForChannel(channelKey, models)
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

  const applyPreset = (p: { label: string; baseUrl: string; modelName: string }) => {
    setForm((f) => ({ ...f, baseUrl: p.baseUrl, modelName: p.modelName, label: editing ? f.label : (f.label || p.label) }))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        // 复用模式下显示名缺省 = 模型名（加模型最小输入就一个模型名；服务端同样兑底）
        label: form.label.trim() || (reusing ? form.modelName.trim() : ''),
        modelName: form.modelName.trim(),
        priority: Number(form.priority) || 100,
        extraJson: form.extraJson.trim() || null,
      }
      if (reusing) {
        payload.reuseConfigId = reuseId // 地址/密钥/协议由服务端从源配置复制，密钥不出服务器
      } else {
        payload.baseUrl = form.baseUrl.trim()
        if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim()
      }
      const res = await fetch(
        editing ? `/api/settings/model-providers/${initial?.id}` : '/api/settings/model-providers',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            editing
              ? payload
              : reusing
                ? { ...payload, channel: channelKey }
                : { ...payload, channel: channelKey, providerType: 'openai-compat', apiKey: form.apiKey.trim() },
          ),
        },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error + (data.detail ? `：${data.detail}` : ''))
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const requiredOk = reusing
    ? form.modelName.trim().length > 0
    : Boolean(form.label.trim() && form.baseUrl.trim() && form.modelName.trim() && (editing || form.apiKey.trim()))

  return (
    <div className={`space-y-3 rounded-xl border p-4 ${editing ? 'border-violet-500/25 bg-zinc-900/80' : 'border-violet-500/25 bg-zinc-900/80'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-100">{editing ? '编辑服务' : reusing ? '添加模型（复用连接）' : '添加自定义服务'}</span>
        <span className="text-xs text-zinc-400">
          {editing
            ? '修改后保存即生效（密钥留空 = 保持不变）'
            : reusing
              ? '地址与密钥复用所选连接——只需选一个模型'
              : connections.length > 0
                ? '新服务商从预填开始；已有服务商加模型点「复用已有连接」'
                : '选一个服务商可自动填充地址与模型名'}
        </span>
      </div>
      {/* add 模式且已有可复用连接：新建 / 复用 二选一 */}
      {!editing && connections.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setReuseId('')}
            className={`rounded-full border px-3 py-1 text-xs transition ${reuseId === '' ? 'border-violet-400/60 bg-violet-500/15 text-violet-200' : 'border-white/10 bg-white/5 text-zinc-300 hover:border-violet-400/40 hover:text-white'}`}
          >
            新建连接
          </button>
          <button
            type="button"
            onClick={() => setReuseId(connections[0]?.id ?? '')}
            className={`rounded-full border px-3 py-1 text-xs transition ${reuseId !== '' ? 'border-violet-400/60 bg-violet-500/15 text-violet-200' : 'border-white/10 bg-white/5 text-zinc-300 hover:border-violet-400/40 hover:text-white'}`}
          >
            复用已有连接（免重复填地址与密钥）
          </button>
        </div>
      ) : null}
      {/* 复用模式：选择连接（按地址去重，跨通道可选——同一把钥匙常常管多个通道） */}
      {reusing ? (
        <div className="space-y-1.5">
          <Label htmlFor={`reuse-${channelKey}`}>复用哪个连接</Label>
          <div className="relative">
            <select
              id={`reuse-${channelKey}`}
              value={reuseId}
              onChange={(e) => setReuseId(e.target.value)}
              className={`${SELECT_CLS} appearance-none pr-8`}
              aria-label="选择要复用的连接"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} · {c.baseUrl} · {c.apiKey}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          </div>
          {reuseSource ? (
            <p className="text-[11px] text-zinc-400">
              接口地址与密钥复用「{reuseSource.label}」（{reuseSource.baseUrl}，密钥 {reuseSource.apiKey}）；换密钥去源配置里改，这里不用重填。
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
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
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`label-${mode}-${channelKey}`}>显示名{reusing ? '（留空 = 用模型名）' : ''}</Label>
          <Input id={`label-${mode}-${channelKey}`} className={INPUT_CLS} value={form.label} placeholder={reusing ? `如：${form.modelName || 'deepseek-reasoner'}` : '如：DeepSeek 对话'} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`model-${mode}-${channelKey}`}>模型名称（Model Name）</Label>
            <button
              type="button"
              onClick={fetchModels}
              disabled={fetchingModels || !canFetchModels}
              title={canFetchModels ? '用当前地址与密钥拉取可用模型列表（零消耗）' : '请先填写接口地址与密钥'}
              className="flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-300 transition hover:border-violet-400/60 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {fetchingModels ? <Loader2 className="size-3 animate-spin" /> : <ListChecks className="size-3" aria-hidden />}
              获取模型列表
            </button>
          </div>
          <Input id={`model-${mode}-${channelKey}`} className={INPUT_CLS} value={form.modelName} placeholder="如 deepseek-chat（或点右上按钮自动获取）" onChange={(e) => setForm((f) => ({ ...f, modelName: e.target.value }))} />
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
                  <optgroup label={`推荐（匹配${channelKey === 'llm' ? '对话' : channelKey === 'image' ? '生图' : channelKey === 'tts' ? '配音' : '视频'}能力）`}>
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
        {!reusing ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`base-${mode}-${channelKey}`}>接口地址（Endpoint）</Label>
            <Input id={`base-${mode}-${channelKey}`} className={INPUT_CLS} value={form.baseUrl} placeholder="https://api.example.com/v1" onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
          </div>
        ) : null}
        {!reusing ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`key-${mode}-${channelKey}`}>密钥（API Key）</Label>
            <Input
              id={`key-${mode}-${channelKey}`}
              className={INPUT_CLS}
              type="password"
              value={form.apiKey}
              placeholder={editing ? '留空 = 保持原密钥不变；输入新值则覆盖' : '仅保存在本机沙箱数据库，页面显示时打码'}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            />
            {editing && initial?.apiKey ? (
              <p className="text-[11px] text-zinc-400">当前密钥：<span className="font-mono text-zinc-300">{initial.apiKey}</span>（前3后4，中间打码）</p>
            ) : null}
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor={`prio-${mode}-${channelKey}`}>优先级（数字越小越先用）</Label>
          <Input id={`prio-${mode}-${channelKey}`} className={INPUT_CLS} type="number" min={1} max={999} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`extra-${mode}-${channelKey}`}>附加参数（JSON，可选）</Label>
          <Input id={`extra-${mode}-${channelKey}`} className={INPUT_CLS} value={form.extraJson} placeholder='如 {"voice":"alloy"}' onChange={(e) => setForm((f) => ({ ...f, extraJson: e.target.value }))} />
        </div>
      </div>
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div> : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving || !requiredOk}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : editing ? <Check className="size-4" /> : <Plug className="size-4" />}
          {editing ? '保存修改' : '保存并加入候选链'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </div>
  )
}

// ---------- 配置卡片（查看 + 内联编辑） ----------

function ConfigCard({
  row,
  sharedCount,
  onToggle,
  onTest,
  onDelete,
  onSaved,
  testing,
  testResult,
}: {
  row: ConfigRow
  sharedCount?: number
  onToggle: (row: ConfigRow) => void
  onTest: (row: ConfigRow) => void
  onDelete: (row: ConfigRow) => void
  onSaved: () => void
  testing: boolean
  testResult: string | null
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <ProviderForm
        mode="edit"
        channelKey={row.channel}
        presets={CHANNELS.find((c) => c.key === row.channel)?.presets ?? []}
        allRows={[]}
        initial={row}
        onSaved={() => { setEditing(false); onSaved() }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-zinc-900/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-zinc-100">{row.label}</span>
        <Badge variant="outline" className="text-[11px] text-zinc-400">{row.providerType}</Badge>
        <TestBadge row={row} />
        {(sharedCount ?? 1) > 1 ? (
          <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-[11px] text-sky-300 hover:bg-sky-500/10" title="同一服务商的多个模型共用同一地址与密钥——换密钥改任意一项后其余项需分别更新">
            与其他 {(sharedCount ?? 1) - 1} 项共用连接
          </Badge>
        ) : null}
        {row.enabled ? (
          <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/30 hover:bg-violet-500/15">候选中 · 第 {row.priority} 顺位</Badge>
        ) : (
          <Badge variant="secondary">已停用</Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
            编辑
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onTest(row)} disabled={testing} title="验证连接 + 真实调用所选模型（对话/配音/生图各一次最小调用；视频通道跳过实调）">
            {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
            测试验证
          </Button>
          <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => onDelete(row)}>
            <Trash2 className="size-4" />
            删除
          </Button>
        </div>
      </div>
      <div className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 bg-black/40">
        <div className="flex gap-3 px-3 py-2 text-sm">
          <span className="w-[4.5rem] shrink-0 text-zinc-400">模型</span>
          <span className="min-w-0 break-all font-mono font-medium text-zinc-100">{row.modelName}</span>
        </div>
        <div className="flex gap-3 px-3 py-2 text-sm">
          <span className="w-[4.5rem] shrink-0 text-zinc-400">接口地址</span>
          <span className="min-w-0 break-all font-mono text-zinc-100">{row.baseUrl}</span>
        </div>
        <div className="flex gap-3 px-3 py-2 text-sm">
          <span className="w-[4.5rem] shrink-0 text-zinc-400">密钥</span>
          <span className="min-w-0 break-all font-mono text-zinc-100">{row.apiKey}</span>
        </div>
        {row.extraJson ? (
          <div className="flex gap-3 px-3 py-2 text-sm">
            <span className="w-[4.5rem] shrink-0 text-zinc-400">附加参数</span>
            <span className="min-w-0 break-all font-mono text-zinc-100">{row.extraJson}</span>
          </div>
        ) : null}
      </div>
      {testResult ? <div className="text-xs text-zinc-300">{testResult}</div> : row.lastTestMessage ? <div className="text-xs text-zinc-300">{row.lastTestMessage}</div> : null}
      <div className="flex items-center gap-3 pt-1">
        <Switch checked={row.enabled} onCheckedChange={() => onToggle(row)} aria-label="启用/停用" />
        <span className="text-xs text-zinc-300">参与生成任务的候选链（失败自动切换到下一个）</span>
      </div>
    </div>
  )
}

// ---------- 添加表单（包装统一 ProviderForm） ----------

function AddForm({ channelKey, presets, allRows, onSaved }: { channelKey: string; presets: readonly { label: string; baseUrl: string; modelName: string }[]; allRows: ConfigRow[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {allRows.length > 0 ? '添加模型 / 服务' : '添加自定义服务'}
      </Button>
    )
  }
  return (
    <ProviderForm
      mode="add"
      channelKey={channelKey}
      presets={presets}
      allRows={allRows}
      onSaved={() => { setOpen(false); onSaved() }}
      onCancel={() => setOpen(false)}
    />
  )
}

// ---------- 页面 ----------

export default function ModelSettingsPage() {
  const [items, setItems] = useState<ConfigRow[]>([])
  const [loading, setLoading] = useState(true)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/model-providers')
      const data = await res.json()
      setItems(data.items ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggle = async (row: ConfigRow) => {
    await fetch(`/api/settings/model-providers/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !row.enabled }),
    })
    load()
  }

  const test = async (row: ConfigRow) => {
    if (row.channel === 'image') {
      const go = window.confirm('图像模型验证会真实生成 1 张测试图（消耗少量额度），继续？')
      if (!go) return
    }
    setTestingId(row.id)
    try {
      const res = await fetch(`/api/settings/model-providers/${row.id}/test`, { method: 'POST' })
      const data = await res.json()
      setTestResults((r) => ({ ...r, [row.id]: data.ok ? `✓ ${data.message}` : `✗ ${data.message ?? data.error}` }))
      load()
    } finally {
      setTestingId(null)
    }
  }

  const remove = async (row: ConfigRow) => {
    if (!window.confirm(`删除「${row.label}」？删除后生成任务立即回到内置通道。`)) return
    await fetch(`/api/settings/model-providers/${row.id}`, { method: 'DELETE' })
    load()
  }

  const configuredCount = useMemo(() => items.length, [items])

  // 按接口地址统计共用连接的项数（「配一次连接，加多个模型」的可见反馈）
  const sharedByBaseUrl = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of items) m.set(r.baseUrl, (m.get(r.baseUrl) ?? 0) + 1)
    return m
  }, [items])

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
            {configuredCount > 0 ? (
              <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/30 hover:bg-violet-500/15">已配置 {configuredCount} 项</Badge>
            ) : null}
          </div>
          <div className="ml-auto hidden text-xs text-zinc-400 sm:block">自定义优先 · 内置兜底 · 失败自动切换</div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <section className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-transparent p-5">
          <h2 className="text-base font-semibold">不因单一模型配额限制阻塞创作</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">
            在这里接入任何 OpenAI 兼容的模型服务（OpenAI、DeepSeek、SiliconFlow、Moonshot、智谱等）。
            配置保存后，创作任务会按优先级依次尝试：自定义服务在前，内置服务兜底——任何一家失败或限流，自动切换到下一家，不打断你的创作。
          </p>
          <div className="mt-4 grid gap-2 text-xs text-zinc-300 sm:grid-cols-3">
            <div className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-semibold text-violet-300">1</span>
              <span>选服务商预填地址 → 粘贴 API Key → 点「获取模型列表」从可用模型中选择；同一服务商加更多模型时用「复用已有连接」，地址密钥不重填</span>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-semibold text-violet-300">2</span>
              <span>保存后点「测试验证」——真实调用一次所选模型，确认它真的能用</span>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-semibold text-violet-300">3</span>
              <span>验证通过即加入候选链，正常去创作；失败自动切换下一家</span>
            </div>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-400">
            <ShieldCheck className="size-3.5" aria-hidden />
            密钥只保存在本机沙箱数据库，页面显示时打码（前 3 后 4）；随时可编辑或删除。
          </p>
        </section>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-zinc-400"><Loader2 className="size-6 animate-spin" /></div>
        ) : (
          CHANNELS.map((ch) => {
            const rows = items.filter((i) => i.channel === ch.key)
            return (
              <Card key={ch.key} className="border-white/10 bg-zinc-900/40">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{ch.name}</CardTitle>
                    {rows.length > 0 ? (
                      <Badge variant="secondary" className="text-[11px]">{rows.filter((r) => r.enabled).length}/{rows.length} 启用</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[11px]">内置兜底已就位</Badge>
                    )}
                  </div>
                  <CardDescription>{ch.desc}</CardDescription>
                  <div className="pt-2">
                    <ChainPreview rows={rows} builtin={ch.builtin} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {rows.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/15 px-4 py-6 text-center text-xs text-zinc-400">
                      这条通道还没有自定义服务——点击下方按钮，把你的 API Key 填进来即可接管；不配置则继续使用内置服务。
                      {items.length > 0 ? <span className="block pt-1 text-zinc-500">已配置过其他通道？添加时可选「复用已有连接」，地址密钥都不用重填。</span> : null}
                    </div>
                  ) : (
                    rows.map((row) => (
                      <ConfigCard
                        key={row.id}
                        row={row}
                        sharedCount={sharedByBaseUrl.get(row.baseUrl)}
                        onToggle={toggle}
                        onTest={test}
                        onDelete={remove}
                        onSaved={load}
                        testing={testingId === row.id}
                        testResult={testResults[row.id] ?? null}
                      />
                    ))
                  )}
                  <AddForm channelKey={ch.key} presets={ch.presets} allRows={items} onSaved={load} />
                </CardContent>
              </Card>
            )
          })
        )}

        <footer className="pb-8 text-center text-xs text-zinc-600">
          <Link href="/" className="transition hover:text-zinc-400">← 回到 ImagineOS</Link>
        </footer>
      </div>
    </main>
  )
}
