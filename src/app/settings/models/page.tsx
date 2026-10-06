'use client'

// 设置 → 模型服务（ADR-0004 / 产品负责人 2026-10-06 指令）
// 目标：不因单一模型配额限制阻塞 ImagineOS——把外部模型服务配置进来，
//       生成任务自动按「自定义优先 → 内置兜底」的顺序调用，失败自动切换。
// 这是面向开发/运维的能力页（非大众创作流），按指令要求直接使用 LLM Provider /
// API Key / Endpoint 等技术词汇；创作流页面仍遵守用户语言规则。

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Plug, PlugZap, Plus, Settings2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
    presets: [
      { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelName: 'gpt-4o-mini-tts' },
      { label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', modelName: 'FunAudioLLM/CosyVoice2-0.5B' },
    ],
  },
  {
    key: 'video',
    name: '视频模型（Video Provider · 实验性）',
    desc: '让画面真正动起来（原生视频）。当前按 SiliconFlow 风格的提交/查询接口实现；不可用时自动回退内置通道。',
    presets: [
      { label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', modelName: 'Wan2.2-T2V-A14B' },
    ],
  },
] as const

// ---------- 组件 ----------

function TestBadge({ row }: { row: ConfigRow }) {
  if (row.lastTestStatus === 'ok') return <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/15">连接正常</Badge>
  if (row.lastTestStatus === 'fail') return <Badge variant="destructive">连接失败</Badge>
  return <Badge variant="secondary">未测试</Badge>
}

function ConfigCard({
  row,
  onToggle,
  onTest,
  onDelete,
  testing,
  testResult,
}: {
  row: ConfigRow
  onToggle: (row: ConfigRow) => void
  onTest: (row: ConfigRow) => void
  onDelete: (row: ConfigRow) => void
  testing: boolean
  testResult: string | null
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-zinc-100">{row.label}</span>
        <Badge variant="outline" className="text-[11px] text-zinc-400">{row.providerType}</Badge>
        <TestBadge row={row} />
        {row.enabled ? (
          <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/30 hover:bg-violet-500/15">候选中 · 第 {row.priority} 顺位</Badge>
        ) : (
          <Badge variant="secondary">已停用</Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onTest(row)} disabled={testing}>
            {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
            连接测试
          </Button>
          <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => onDelete(row)}>
            <Trash2 className="size-4" />
            删除
          </Button>
        </div>
      </div>
      <div className="grid gap-1.5 text-xs text-zinc-400">
        <div className="flex gap-2"><span className="text-zinc-500 w-16 shrink-0">模型</span><span className="text-zinc-200">{row.modelName}</span></div>
        <div className="flex gap-2"><span className="text-zinc-500 w-16 shrink-0">接口地址</span><span className="break-all">{row.baseUrl}</span></div>
        <div className="flex gap-2"><span className="text-zinc-500 w-16 shrink-0">密钥</span><span className="font-mono">{row.apiKey}</span></div>
        {row.extraJson ? (
          <div className="flex gap-2"><span className="text-zinc-500 w-16 shrink-0">附加参数</span><span className="font-mono break-all">{row.extraJson}</span></div>
        ) : null}
        {testResult ? <div className="pt-1 text-zinc-300">{testResult}</div> : row.lastTestMessage ? <div className="pt-1">{row.lastTestMessage}</div> : null}
      </div>
      <div className="flex items-center gap-3 pt-1">
        <Switch checked={row.enabled} onCheckedChange={() => onToggle(row)} aria-label="启用/停用" />
        <span className="text-xs text-zinc-400">参与生成任务的候选链（失败自动切换到下一个）</span>
      </div>
    </div>
  )
}

function AddForm({ channelKey, presets, onSaved }: { channelKey: string; presets: readonly { label: string; baseUrl: string; modelName: string }[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ label: '', baseUrl: '', apiKey: '', modelName: '', priority: '10', extraJson: '' })

  const applyPreset = (p: { label: string; baseUrl: string; modelName: string }) => {
    setForm((f) => ({ ...f, label: f.label || p.label, baseUrl: p.baseUrl, modelName: p.modelName }))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/model-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: channelKey,
          label: form.label.trim(),
          providerType: 'openai-compat',
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey.trim(),
          modelName: form.modelName.trim(),
          priority: Number(form.priority) || 100,
          ...(form.extraJson.trim() ? { extraJson: form.extraJson.trim() } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error + (data.detail ? `：${data.detail}` : ''))
      setForm({ label: '', baseUrl: '', apiKey: '', modelName: '', priority: '10', extraJson: '' })
      setOpen(false)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        添加自定义服务
      </Button>
    )
  }

  return (
    <div className="rounded-xl border border-violet-500/25 bg-zinc-900/80 p-4 space-y-3">
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
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`label-${channelKey}`}>显示名</Label>
          <Input id={`label-${channelKey}`} value={form.label} placeholder="如：DeepSeek 对话" onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`model-${channelKey}`}>模型名称（Model Name）</Label>
          <Input id={`model-${channelKey}`} value={form.modelName} placeholder="如 deepseek-chat" onChange={(e) => setForm((f) => ({ ...f, modelName: e.target.value }))} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`base-${channelKey}`}>接口地址（Endpoint）</Label>
          <Input id={`base-${channelKey}`} value={form.baseUrl} placeholder="https://api.example.com/v1" onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`key-${channelKey}`}>密钥（API Key）</Label>
          <Input id={`key-${channelKey}`} type="password" value={form.apiKey} placeholder="仅保存在本机沙箱数据库，页面显示时打码" onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`prio-${channelKey}`}>优先级（数字越小越先用）</Label>
          <Input id={`prio-${channelKey}`} type="number" min={1} max={999} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`extra-${channelKey}`}>附加参数（JSON，可选）</Label>
          <Input id={`extra-${channelKey}`} value={form.extraJson} placeholder='如 {"voice":"alloy"}' onChange={(e) => setForm((f) => ({ ...f, extraJson: e.target.value }))} />
        </div>
      </div>
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div> : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving || !form.label.trim() || !form.baseUrl.trim() || !form.apiKey.trim() || !form.modelName.trim()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
          保存并加入候选链
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
      </div>
    </div>
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

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="rounded-lg p-2 transition hover:bg-white/5" aria-label="返回首页">
            <ArrowLeft className="size-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Settings2 className="size-5 text-violet-400" />
            <h1 className="text-lg font-semibold tracking-tight">模型服务</h1>
          </div>
          <div className="ml-auto text-xs text-zinc-500">自定义优先 · 内置兜底 · 失败自动切换</div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <section className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-transparent p-5">
          <h2 className="text-base font-semibold">不因单一模型配额限制阻塞创作</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">
            在这里接入任何 OpenAI 兼容的模型服务（OpenAI、DeepSeek、SiliconFlow、Moonshot、智谱等）。
            配置保存后，创作任务会按优先级依次尝试：自定义服务在前，内置服务兜底——任何一家失败或限流，自动切换到下一家，不打断你的创作。
          </p>
        </section>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-zinc-500"><Loader2 className="size-6 animate-spin" /></div>
        ) : (
          CHANNELS.map((ch) => {
            const rows = items.filter((i) => i.channel === ch.key)
            return (
              <Card key={ch.key} className="border-white/10 bg-zinc-900/40">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{ch.name}</CardTitle>
                    <Badge variant="secondary" className="text-[11px]">内置兜底已就位</Badge>
                  </div>
                  <CardDescription>{ch.desc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {rows.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-500">
                      暂无自定义服务——当前这条通道直接使用内置服务
                    </div>
                  ) : (
                    rows.map((row) => (
                      <ConfigCard
                        key={row.id}
                        row={row}
                        onToggle={toggle}
                        onTest={test}
                        onDelete={remove}
                        testing={testingId === row.id}
                        testResult={testResults[row.id] ?? null}
                      />
                    ))
                  )}
                  <AddForm channelKey={ch.key} presets={ch.presets} onSaved={load} />
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
