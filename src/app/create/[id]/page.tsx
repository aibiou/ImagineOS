'use client'

// ImagineOS 创作空间 /create/[id]（M1 / T7X.3）
// 全链：理解 → 方向 → 故事 → 分镜 → AI 生成 → 预览 → 修订 → 渲染 → 发布
// 纪律：不重构首页（M0 评审 P1）；文案全部走产品语言字典（P0-3）
// 状态恢复：任何刷新/中断后，页面按 content.status 自动回到正确位置（AC of T8.2.4）

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Clapperboard,
  Film,
  GitBranch,
  History,
  Loader2,
  MessageCircleQuestion,
  Music4,
  PenLine,
  Play,
  Rocket,
  Sparkles,
  Wand2,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { CAMERA_LABEL, COPY, CREATE_STEPS, STAGE_LABEL, durationLabel, versionLabel, versionWithCount } from '@/app/_language'

// ---------- 类型（/api/contents/:id/creation 的返回形态） ----------

interface CreationBundle {
  content: {
    id: string
    title: string
    status: string
    visibility: string
    remixPermission: string
    updatedAt: string
    owner: { id: string; displayName: string; handle: string }
    isOwner: boolean
    versionCount: number
    remixCount: number
  }
  intent: { rawExpression: string; record: { fields: Record<string, unknown>; sources: Record<string, string>; interview?: { asked: string[]; remainingBudget: number; done: boolean } } | null } | null
  plan: { directions: Array<{ id: string; name: string; oneLiner: string; emotion?: string; visualDirection?: string; expectedDurationSec?: number }> | null; concept: { directionId?: string; name?: string; oneLiner?: string; emotion?: string; visualDirection?: string } | null }
  story: { logline?: string; narrationStyle?: string; emotionArc?: string[]; scenes: Array<{ index: number; summary?: string; location?: string; shots: Array<{ index: number; visualDescription?: string; cameraMotion?: string; durationMs?: number; narrationLine?: string; emotion?: string }> }> } | null
  version: { number: number; changelog: string | null; createdAt: string } | null
  job: { id: string; type: string; status: string; retryCount: number; stage?: string; label?: string; current?: number; total?: number; progress?: number } | null
  assets: {
    final: { url: string; durationMs: number | null } | null
    poster: { url: string } | null
    shots: Array<{ shotIndex: number; imageUrl: string | null; audioUrl: string | null }>
  }
  remixOf: { sourceContentId: string; sourceVersionId: string } | null
}

interface RevisionPlanResult {
  plan: { targetLevel: string; summary: string; reason: string; affectedShotIndexes: number[]; changeKind: string }
  structure: unknown
  feedback: string
}

// ---------- 小工具 ----------

async function postJson<T = Record<string, unknown>>(url: string, body?: unknown): Promise<{ ok: boolean; status: number; json: T & { message?: string; error?: string } }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string }
  return { ok: res.ok, status: res.status, json }
}

function stepIndexFor(status: string): number {
  const i = CREATE_STEPS.findIndex((s) => (s.match as readonly string[]).includes(status))
  return i < 0 ? 0 : i
}

// ---------- 页面 ----------

export default function CreatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { toast } = useToast()
  const [bundle, setBundle] = useState<CreationBundle | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // 'directions' | 'story' | 'storyboard' | 'generate' | ...
  const autoFired = useRef<Set<string>>(new Set())

  const [answers, setAnswers] = useState<Record<string, string>>({})

  const [revisionOpen, setRevisionOpen] = useState(false)
  const [revisionText, setRevisionText] = useState('')
  const [revisionPlan, setRevisionPlan] = useState<RevisionPlanResult | null>(null)

  const load = useCallback(
    async (silent = false) => {
      try {
        const res = await fetch(`/api/contents/${id}/creation`)
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { message?: string }
          setLoadError(j.message ?? '作品不存在或不可见')
          return
        }
        const json = (await res.json()) as CreationBundle
        setBundle(json)
        setLoadError(null)
      } catch {
        if (!silent) setLoadError('网络似乎打了个盹，稍后再试。')
      }
    },
    [id],
  )

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const status = bundle?.content.status ?? ''

  // 当前访谈问题（从 bundle 派生，刷新可恢复；无 effect setState）
  const questions = useMemo(
    () => (bundle?.intent?.record?.interview?.asked ?? []).slice(0, 3),
    [bundle?.intent?.record?.interview?.asked],
  )
  const questionAnswers = useMemo(() => questions.map((q) => answers[q] ?? ''), [questions, answers])

  // 镜头列表（Hooks 必须在条件返回之前）
  const shots = useMemo(() => (bundle?.story?.scenes ?? []).flatMap((s) => s.shots), [bundle?.story])

  // 生成中轮询（UX 原则五：每步可见）
  const generating = status === 'GENERATING' || status === 'RENDERING' || (bundle?.job != null && ['queued', 'claimed', 'running'].includes(bundle.job.status))
  useEffect(() => {
    if (!generating) return
    const t = setInterval(() => void load(true), 2500)
    return () => clearInterval(t)
  }, [generating, load])

  // ---- 自动推进（幂等防重） ----
  const fireOnce = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      if (autoFired.current.has(key)) return
      autoFired.current.add(key)
      await fn()
    },
    [],
  )

  // INTENT 且无方向 → 自动生成一批
  useEffect(() => {
    if (!bundle || status !== 'INTENT' || bundle.plan.directions?.length) return
    void fireOnce(`directions-${bundle.content.id}`, async () => {
      setBusy('directions')
      const { ok, json } = await postJson(`/api/contents/${id}/directions`)
      setBusy(null)
      if (!ok) {
        autoFired.current.delete(`directions-${bundle.content.id}`)
        toast({ title: '方向生成未成功', description: json.message ?? '稍后再试', variant: 'destructive' })
        return
      }
      await load(true)
    })
  }, [bundle, status, id, fireOnce, load, toast])

  // PLANNING 且无故事 → 自动展开故事
  useEffect(() => {
    if (!bundle || status !== 'PLANNING' || bundle.story) return
    void fireOnce(`story-${bundle.content.id}`, async () => {
      setBusy('story')
      const { ok, json } = await postJson(`/api/contents/${id}/story`)
      setBusy(null)
      if (!ok) {
        autoFired.current.delete(`story-${bundle.content.id}`)
        toast({ title: '故事还没有展开', description: json.message ?? '稍后再试', variant: 'destructive' })
        return
      }
      await load(true)
    })
  }, [bundle, status, id, fireOnce, load, toast])

  // ---- 动作 ----
  const act = useCallback(
    async (key: string, url: string, body?: unknown, success?: string) => {
      setBusy(key)
      const { ok, json } = await postJson(url, body)
      setBusy(null)
      if (!ok) {
        toast({ title: '这一步没有完成', description: json.message ?? '稍后再试', variant: 'destructive' })
        return false
      }
      if (success) toast({ title: success, description: json.message })
      await load(true)
      return true
    },
    [load, toast],
  )

  const confirmIntent = useCallback(async () => {
    const filled = questionAnswers.filter((a) => a.trim())
    setBusy('intent')
    const { ok, json } = await postJson(`/api/contents/${id}/intent`, {
      ...(filled.length ? { answers: questionAnswers } : {}),
      confirm: true,
    })
    setBusy(null)
    if (!ok) {
      toast({ title: '没有理解成功', description: json.message ?? '稍后再试', variant: 'destructive' })
      return
    }
    setAnswers({})
    toast({ title: '我理解了', description: json.message })
    await load(true)
  }, [questionAnswers, id, load, toast])

  const askIntent = useCallback(async () => {
    const filled = questionAnswers.filter((a) => a.trim())
    setBusy('intent')
    const { ok, json } = await postJson(`/api/contents/${id}/intent`, filled.length ? { answers: questionAnswers } : {})
    setBusy(null)
    if (!ok) {
      toast({ title: '没有理解成功', description: json.message ?? '稍后再试', variant: 'destructive' })
      return
    }
    // 问题从重新加载的 bundle 派生（服务端已持久化当前轮问题）
    const qs = (json as unknown as { questions?: string[] }).questions ?? []
    await load(true)
    if (qs.length === 0) toast({ title: '我理解了', description: '没有其他问题了，继续下一步。' })
    else toast({ title: '还想听你说完', description: '回答或跳过都可以。' })
  }, [questionAnswers, id, load, toast])

  const analyzeRevision = useCallback(async () => {
    const feedback = revisionText.trim()
    if (!feedback) {
      toast({ title: COPY.revisionTitle, description: '用一句话说说，比如「再温暖一点」。' })
      return
    }
    setBusy('revision-plan')
    const { ok, json } = await postJson<RevisionPlanResult>(`/api/contents/${id}/revision/plan`, { feedback })
    setBusy(null)
    if (!ok) {
      toast({ title: '还没想好怎么改', description: json.message ?? '稍后再试', variant: 'destructive' })
      return
    }
    setRevisionPlan(json)
  }, [id, revisionText, toast])

  const applyRevision = useCallback(async () => {
    if (!revisionPlan) return
    setBusy('revision-apply')
    const { ok, json } = await postJson(`/api/contents/${id}/revision/apply`, {
      structure: revisionPlan.structure,
      changelog: revisionPlan.feedback,
    })
    setBusy(null)
    if (!ok) {
      toast({ title: '修改没有生效', description: json.message ?? '稍后再试', variant: 'destructive' })
      return
    }
    setRevisionOpen(false)
    setRevisionPlan(null)
    setRevisionText('')
    toast({ title: '新的一版开始了', description: json.message })
    await load(true)
  }, [id, revisionPlan, load, toast])

  const publish = useCallback(async () => {
    const ok = await act('publish', `/api/contents/${id}/publish`, { visibility: 'public' }, '作品已发布 ✦')
    if (ok) window.scrollTo({ top: 0 })
  }, [act, id])

  // ---------- 渲染 ----------

  if (loadError) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 py-24 text-center">
          <MessageCircleQuestion className="size-10 text-zinc-600" aria-hidden />
          <div className="text-lg text-zinc-300">{loadError}</div>
          <Button variant="outline" asChild>
            <Link href="/#mine">回到首页</Link>
          </Button>
        </div>
      </Shell>
    )
  }

  if (!bundle) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-3 py-32 text-zinc-500">
          <Loader2 className="size-5 animate-spin" aria-hidden /> 正在打开你的创作空间…
        </div>
      </Shell>
    )
  }

  const { content, intent, plan, story, version, job, assets, remixOf } = bundle

  return (
    <Shell>
      {/* 顶部：返回 + 标题 + 步骤条 + 版本徽章 */}
      <div className="mb-8">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" asChild className="gap-1.5 text-zinc-400">
            <Link href="/#mine">
              <ArrowLeft className="size-4" aria-hidden /> 我的创作
            </Link>
          </Button>
          {remixOf && (
            <Badge variant="outline" className="gap-1 border-fuchsia-500/30 bg-fuchsia-500/10 text-[11px] text-fuchsia-300">
              <GitBranch className="size-3" aria-hidden /> {COPY.remixDone}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            {version && (
              <Badge variant="outline" className="border-white/10 bg-white/5 text-[11px] text-zinc-300">
                {versionWithCount(version.number, content.versionCount)}
              </Badge>
            )}
            {content.remixCount > 0 && (
              <Badge variant="outline" className="border-fuchsia-500/30 bg-fuchsia-500/10 text-[11px] text-fuchsia-300">
                被别人续创 ×{content.remixCount}
              </Badge>
            )}
          </div>
        </div>

        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{content.title}</h1>
        <p className="mt-2 text-sm text-zinc-500">{STAGE_LABEL[status] ?? status}</p>

        {/* 步骤条 */}
        <div className="mt-6 flex items-center gap-1.5 overflow-x-auto pb-1">
          {CREATE_STEPS.map((s, i) => {
            const active = i === stepIndexFor(status)
            const done = i < stepIndexFor(status)
            return (
              <div key={s.key} className="flex shrink-0 items-center gap-1.5">
                <span
                  className={`flex size-7 items-center justify-center rounded-full border text-xs transition ${
                    active
                      ? 'border-fuchsia-400/60 bg-fuchsia-500/15 text-fuchsia-200'
                      : done
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-white/10 bg-zinc-900 text-zinc-500'
                  }`}
                >
                  {done ? <BadgeCheck className="size-3.5" aria-hidden /> : i + 1}
                </span>
                <span className={`text-xs ${active ? 'text-zinc-100' : 'text-zinc-500'}`}>{s.label}</span>
                {i < CREATE_STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-white/10" aria-hidden />}
              </div>
            )
          })}
        </div>
      </div>

      {/* 原始表达回响 */}
      {intent?.rawExpression && status !== 'PUBLISHED' && (
        <blockquote className="mb-8 rounded-2xl border border-white/10 bg-zinc-900/50 p-4 text-sm leading-relaxed text-zinc-400">
          <span className="text-zinc-500">你说过：</span>「{intent.rawExpression}」
        </blockquote>
      )}

      {/* ---- IDEA：AI 理解 + 访谈 ---- */}
      {status === 'IDEA' && <IdeaStage bundle={bundle} questions={questions} answers={answers} setAnswers={setAnswers} busy={busy === 'intent'} onAsk={() => void askIntent()} onConfirm={() => void confirmIntent()} />}
      {/* ---- INTENT：方向选择 ---- */}
      {(status === 'INTENT' || status === 'PLANNING') && (
        <DirectionStage directions={plan.directions} loading={busy === 'directions'} selectedId={plan.concept?.directionId} onSelect={(directionId) => void act('select', `/api/contents/${id}/directions/select`, { directionId }, '方向已锁定')}
          onRegenerate={() => void act('directions', `/api/contents/${id}/directions`, { regenerate: true })} />
      )}

      {/* ---- PLANNING/STORY：故事展开 ---- */}
      {(status === 'PLANNING' || status === 'STORY') && (busy === 'story' || !story) ? (
        <CenterLoader label="正在展开你的故事…" />
      ) : status === 'STORY' && story ? (
        <StoryStage story={story} busy={busy === 'storyboard'} onStoryboard={() => void act('storyboard', `/api/contents/${id}/storyboard`, undefined, '分镜已就绪')} />
      ) : null}

      {/* ---- STORYBOARD：分镜确认 ---- */}
      {status === 'STORYBOARD' && story && (
        <StoryboardStage shots={shots} busy={busy === 'generate'} onGenerate={() => void act('generate', `/api/contents/${id}/generate`, undefined, 'AI 创作团队开工了')} />
      )}

      {/* ---- GENERATING / RENDERING：进度 ---- */}
      {(status === 'GENERATING' || status === 'RENDERING') && (
        <GeneratingStage status={status} job={job} shots={shots} shotImages={assets.shots} />
      )}

      {/* ---- REVIEW：预览与调整 ---- */}
      {status === 'REVIEW' && (
        <ReviewStage shots={shots} shotImages={assets.shots} busy={busy}
          onRender={() => void act('render', `/api/contents/${id}/render`, undefined, '开始合成你的视频')}
          onRevise={() => setRevisionOpen(true)}
          onRegenerate={() => void act('regenerate', `/api/contents/${id}/regenerate`, undefined, '换一批画面，重新来过')} />
      )}

      {/* ---- RENDERING 后无 job 的短暂态：复用 Generating ---- */}
      {status === 'RENDERING' && job == null && <CenterLoader label="正在渲染成片…" />}

      {/* ---- READY / PUBLISHED：成片与发布 ---- */}
      {(status === 'READY' || status === 'PUBLISHED') && (
        <FinishStage bundle={bundle} busy={busy}
          onPublish={status === 'READY' ? () => void publish() : undefined}
          onRevise={() => setRevisionOpen(true)}
          onRegenerate={() => void act('regenerate', `/api/contents/${id}/regenerate`, undefined, '换一批画面，重新来过')}
          onStartOwn={() => void act('regenerate', `/api/contents/${id}/regenerate`, undefined, '开始生成你的版本')} />
      )}

      {/* 版本历史入口 */}
      {(status === 'READY' || status === 'PUBLISHED' || status === 'REVIEW') && (
        <div className="mt-6 flex justify-center">
          <Button variant="ghost" size="sm" asChild className="gap-1.5 text-zinc-500">
            <Link href="/#mine">
              <History className="size-3.5" aria-hidden /> 查看这个作品的版本历史
            </Link>
          </Button>
        </div>
      )}

      {/* 修订对话框 */}
      <Dialog open={revisionOpen} onOpenChange={(open) => { if (!open) { setRevisionOpen(false); setRevisionPlan(null) } }}>
        <DialogContent className="border-white/10 bg-zinc-900 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="size-4 text-fuchsia-400" aria-hidden />
              {COPY.revisionTitle}
            </DialogTitle>
            <DialogDescription>
              用一句话说说想怎么改（比如「再温暖一点」「结尾别这么悲伤」）。修改会生成新的一版，旧版本永远保留。
            </DialogDescription>
          </DialogHeader>
          {!revisionPlan ? (
            <>
              <Textarea value={revisionText} onChange={(e) => setRevisionText(e.target.value)} placeholder="再温暖一点，结尾加上母亲在门口招手。" className="min-h-[88px] border-white/10 bg-zinc-950 placeholder:text-zinc-600" maxLength={300} />
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" onClick={() => setRevisionOpen(false)} className="text-zinc-400">取消</Button>
                <Button onClick={() => void analyzeRevision()} disabled={busy === 'revision-plan'} className="gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90">
                  {busy === 'revision-plan' && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  <Wand2 className="size-4" aria-hidden /> 想想怎么改
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/5 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-fuchsia-200">
                  <Wand2 className="size-4" aria-hidden /> 我将修改…
                </div>
                <p className="mt-1.5 text-sm text-zinc-200">{revisionPlan.plan.summary}</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">{revisionPlan.plan.reason}</p>
                {revisionPlan.plan.affectedShotIndexes.length > 0 && (
                  <p className="mt-2 text-xs text-zinc-500">影响的镜头：{revisionPlan.plan.affectedShotIndexes.map((i) => `第 ${i + 1} 个`).join('、')}</p>
                )}
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" onClick={() => setRevisionPlan(null)} className="text-zinc-400">换个改法</Button>
                <Button onClick={() => void applyRevision()} disabled={busy === 'revision-apply'} className="gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90">
                  {busy === 'revision-apply' && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {COPY.revisionConfirm}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Shell>
  )
}

// ---------- 布局壳 ----------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark min-h-screen bg-zinc-950 text-zinc-100 selection:bg-fuchsia-500/30">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-400 shadow-lg shadow-fuchsia-500/25">
              <Sparkles className="size-5 text-white" aria-hidden />
            </div>
            <div className="leading-tight">
              <div className="text-lg font-semibold tracking-tight">ImagineOS</div>
              <div className="hidden text-[11px] text-zinc-400 sm:block">创作空间</div>
            </div>
          </Link>
          <nav className="flex items-center gap-1 text-sm text-zinc-300" aria-label="主导航">
            <Link className="rounded-lg px-3 py-2 transition hover:bg-white/5 hover:text-white" href="/#imagine">创造</Link>
            <Link className="rounded-lg px-3 py-2 transition hover:bg-white/5 hover:text-white" href="/#mine">我的创作</Link>
            <Link className="rounded-lg px-3 py-2 transition hover:bg-white/5 hover:text-white" href="/#explore">探索</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  )
}

function CenterLoader({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-zinc-900/40 py-20 text-center">
      <Loader2 className="size-8 animate-spin text-fuchsia-400" aria-hidden />
      <div className="text-sm text-zinc-400">{label}</div>
    </div>
  )
}

// ---------- IDEA：AI 理解 + 访谈 ----------

function IdeaStage({
  bundle,
  questions,
  answers,
  setAnswers,
  busy,
  onAsk,
  onConfirm,
}: {
  bundle: CreationBundle
  questions: string[]
  answers: Record<string, string>
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>
  busy: boolean
  onAsk: () => void
  onConfirm: () => void
}) {
  const record = bundle.intent?.record
  const f = (record?.fields ?? {}) as Record<string, unknown>
  const sources = record?.sources ?? {}
  const chips: Array<{ label: string; value: string; fromUser: boolean }> = []
  if (typeof f.topic === 'string') chips.push({ label: '主题', value: f.topic, fromUser: sources.topic === 'user' })
  if (typeof f.duration === 'number') chips.push({ label: '时长', value: `约 ${f.duration} 秒`, fromUser: sources.duration === 'user' })
  if (Array.isArray(f.emotion) && f.emotion.length > 0) chips.push({ label: '情绪', value: (f.emotion as string[]).join('、'), fromUser: sources.emotion === 'user' })
  if (typeof f.audience === 'string') chips.push({ label: '给谁看', value: f.audience, fromUser: sources.audience === 'user' })
  if (typeof f.visual_style === 'string') chips.push({ label: '画面风格', value: f.visual_style === 'cinematic_realism' ? '电影感真实' : String(f.visual_style), fromUser: sources.visual_style === 'user' })
  if (Array.isArray(f.characters) && f.characters.length > 0) chips.push({ label: '人物', value: (f.characters as Array<{ name: string }>).map((c) => c.name).join('、'), fromUser: sources.characters === 'user' })

  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <Card className="border-white/10 bg-zinc-900/60">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
            <Sparkles className="size-4 text-fuchsia-400" aria-hidden /> 我听到了这些
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {chips.map((c) => (
              <span key={c.label} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${c.fromUser ? 'border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200' : 'border-white/10 bg-white/5 text-zinc-300'}`}>
                <span className="text-zinc-500">{c.label}</span>
                {c.value}
                {!c.fromUser && <span className="text-[10px] text-zinc-500">(我猜的)</span>}
              </span>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-zinc-500">标了「我猜的」的部分，是 AI 替你做的决定——你可以在下面补充，或直接继续。</p>
        </CardContent>
      </Card>

      {questions.length > 0 && (
        <Card className="border-white/10 bg-zinc-900/60">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <MessageCircleQuestion className="size-4 text-amber-300" aria-hidden /> 想再确认几件小事
            </div>
            {questions.map((q, i) => (
              <div key={q} className="space-y-1.5">
                <div className="text-sm text-zinc-300">{i + 1}. {q}</div>
                <input
                  value={answers[q] ?? ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q]: e.target.value }))}
                  placeholder="写下你的想法（留空 = 交给 AI 决定）"
                  className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-fuchsia-400/40"
                  maxLength={200}
                />
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-xs text-zinc-600">第 {questions.length} 个问题 · 都可以跳过</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={onAsk} className="gap-1.5 border-white/15 bg-transparent text-zinc-300 hover:border-fuchsia-400/40 hover:text-white">
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null} 按我的回答重新理解
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">准备好了就继续——方向不合适随时能改。</p>
        <Button size="lg" disabled={busy} onClick={onConfirm} className="gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 text-white shadow-lg shadow-fuchsia-500/25 transition hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
          {busy ? '正在理解…' : '就这样，继续'}
        </Button>
      </div>
    </motion.section>
  )
}

// ---------- INTENT：方向选择 ----------

function DirectionStage({
  directions,
  loading,
  selectedId,
  onSelect,
  onRegenerate,
}: {
  directions: CreationBundle['plan']['directions']
  loading: boolean
  selectedId?: string
  onSelect: (directionId: string) => void
  onRegenerate: () => void
}) {
  if (loading || !directions?.length) {
    return <CenterLoader label="正在为你构思几个创作方向…" />
  }
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-400">挑一个你心动的方向——它们会走向完全不同的作品。</p>
        <Button size="sm" variant="ghost" onClick={onRegenerate} className="gap-1.5 text-zinc-500 hover:text-white">
          <Wand2 className="size-3.5" aria-hidden /> 换一批
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {directions.map((d, i) => (
          <motion.button
            key={d.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            onClick={() => selectedId == null && onSelect(d.id)}
            disabled={selectedId != null}
            className={`group relative overflow-hidden rounded-2xl border p-5 text-left transition ${
              selectedId === d.id
                ? 'border-fuchsia-400/50 bg-fuchsia-500/10'
                : 'border-white/10 bg-zinc-900/60 hover:border-fuchsia-400/30 hover:bg-zinc-900'
            } ${selectedId != null ? 'opacity-60' : ''}`}
          >
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="font-mono">{String.fromCharCode(65 + i)}</span>
              {d.emotion && <span>{d.emotion}</span>}
              {d.expectedDurationSec ? <span>约 {d.expectedDurationSec} 秒</span> : null}
            </div>
            <div className="mt-2 text-lg font-semibold tracking-tight text-zinc-100">{d.name}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{d.oneLiner}</p>
            {d.visualDirection && (
              <p className="mt-3 inline-flex rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-zinc-400">{d.visualDirection}</p>
            )}
            {selectedId == null && (
              <span className="mt-4 inline-flex items-center gap-1 text-xs text-fuchsia-300 opacity-0 transition group-hover:opacity-100">
                <ArrowRight className="size-3" aria-hidden /> 走这个方向
              </span>
            )}
          </motion.button>
        ))}
      </div>
    </section>
  )
}

// ---------- STORY：故事审阅 ----------

function StoryStage({
  story,
  busy,
  onStoryboard,
}: {
  story: NonNullable<CreationBundle['story']>
  busy: boolean
  onStoryboard: () => void
}) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <Card className="overflow-hidden border-white/10 bg-zinc-900/60">
        <div className="h-1.5 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400" aria-hidden />
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Film className="size-3.5" aria-hidden /> 一句话故事
          </div>
          <p className="mt-2 text-lg font-medium leading-relaxed text-zinc-100">{story.logline}</p>
          {story.emotionArc?.length ? (
            <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
              <span className="text-zinc-600">情绪走向</span>
              {story.emotionArc.map((e, i) => (
                <span key={`${e}-${i}`} className="flex items-center gap-1.5">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">{e}</span>
                  {i < story.emotionArc!.length - 1 && <span className="text-zinc-700">→</span>}
                </span>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {story.scenes.map((s) => (
          <div key={s.index} className="flex gap-4 rounded-xl border border-white/10 bg-zinc-900/40 p-4">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-xs text-zinc-400">{s.index + 1}</span>
            <div>
              <p className="text-sm leading-relaxed text-zinc-200">{s.summary}</p>
              {s.location && <p className="mt-1 text-xs text-zinc-500">场景：{s.location}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">{story.narrationStyle ? `旁白：${story.narrationStyle}` : '旁白将用第一人称讲述'}</p>
        <Button size="lg" disabled={busy} onClick={onStoryboard} className="gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 text-white shadow-lg shadow-fuchsia-500/25 transition hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Clapperboard className="size-4" aria-hidden />}
          {busy ? '正在拆分镜头…' : '拆分镜头'}
        </Button>
      </div>
    </motion.section>
  )
}

// ---------- STORYBOARD：分镜确认 ----------

function StoryboardStage({
  shots,
  busy,
  onGenerate,
}: {
  shots: NonNullable<CreationBundle['story']>['scenes'][number]['shots']
  busy: boolean
  onGenerate: () => void
}) {
  const totalSec = Math.round(shots.reduce((n, s) => n + (s.durationMs ?? 0), 0) / 1000)
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-400">{shots.length} 个镜头 · 约 {totalSec} 秒 · 每个镜头一张画面 + 一句旁白</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {shots.map((shot, i) => (
          <div key={i} className="flex gap-3.5 rounded-xl border border-white/10 bg-zinc-900/50 p-4">
            <div className="flex size-9 shrink-0 flex-col items-center justify-center rounded-lg border border-white/10 bg-zinc-950 text-[10px] text-zinc-500">
              <span className="text-sm font-medium text-zinc-200">{i + 1}</span>
              镜头
            </div>
            <div className="min-w-0">
              <p className="text-sm leading-relaxed text-zinc-200">{shot.visualDescription}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                {shot.cameraMotion && <span>{CAMERA_LABEL[shot.cameraMotion] ?? shot.cameraMotion}</span>}
                {shot.durationMs && <span>{(shot.durationMs / 1000).toFixed(1)} 秒</span>}
                {shot.emotion && <span className="text-amber-300/70">{shot.emotion}</span>}
              </div>
              {shot.narrationLine && (
                <p className="mt-2 border-l-2 border-fuchsia-500/30 pl-2.5 text-xs italic leading-relaxed text-zinc-400">「{shot.narrationLine}」</p>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col items-center gap-2 pt-2">
        <Button size="lg" disabled={busy} onClick={onGenerate} className="gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-8 text-white shadow-lg shadow-fuchsia-500/30 transition hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Rocket className="size-4" aria-hidden />}
          {busy ? '正在开工…' : '开始 AI 生成'}
        </Button>
        <p className="text-xs text-zinc-600">画面与配音完成后会叫你来预览</p>
      </div>
    </motion.section>
  )
}

// ---------- GENERATING / RENDERING：进度 ----------

function GeneratingStage({
  status,
  job,
  shots,
  shotImages,
}: {
  status: string
  job: CreationBundle['job']
  shots: NonNullable<CreationBundle['story']>['scenes'][number]['shots']
  shotImages: CreationBundle['assets']['shots']
}) {
  const label = job?.label ?? (status === 'RENDERING' ? '正在把画面、声音与字幕合成为完整的视频…' : 'AI 创作团队正在工作…')
  const pct =
    job?.stage === 'images' && job.total
      ? Math.round(((job.current ?? 0) / job.total) * 70)
      : job?.stage === 'narration' && job.total
        ? 70 + Math.round(((job.current ?? 0) / job.total) * 20)
        : job?.progress != null
          ? Math.round(job.progress * 100)
          : job?.stage === 'done'
            ? 100
            : 8
  const imageByIndex = new Map(shotImages.map((s) => [s.shotIndex, s.imageUrl]))

  return (
    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <Card className="border-white/10 bg-zinc-900/60">
        <CardContent className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <div className="relative flex size-10 items-center justify-center">
              <Loader2 className="size-10 animate-spin text-fuchsia-400/30" aria-hidden />
              <Wand2 className="absolute size-4 text-fuchsia-300" aria-hidden />
            </div>
            <div>
              <div className="text-sm font-medium text-zinc-100">{label}</div>
              <div className="text-xs text-zinc-500">{STAGE_LABEL[status]} · 可以先去喝口水，也可以留在这里看</div>
            </div>
          </div>
          <Progress value={pct} className="h-1.5 bg-zinc-800" />
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {shots.map((_, i) => {
              const url = imageByIndex.get(i)
              return (
                <div key={i} className={`relative aspect-[9/16] overflow-hidden rounded-lg border ${url ? 'border-fuchsia-400/30' : 'border-white/10 bg-zinc-900'}`}>
                  {url ? (
                     
                    <img src={url} alt={`第 ${i + 1} 个镜头`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <div className="size-4 animate-pulse rounded-full bg-zinc-700" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {job?.retryCount ? <p className="text-xs text-amber-300/70">有点小波折，正在重试（第 {job.retryCount} 次）——你的创作不会丢。</p> : null}
        </CardContent>
      </Card>
    </motion.section>
  )
}

// ---------- REVIEW：预览与调整 ----------

function ReviewStage({
  shots,
  shotImages,
  busy,
  onRender,
  onRevise,
  onRegenerate,
}: {
  shots: NonNullable<CreationBundle['story']>['scenes'][number]['shots']
  shotImages: CreationBundle['assets']['shots']
  busy: string | null
  onRender: () => void
  onRevise: () => void
  onRegenerate: () => void
}) {
  const imageByIndex = new Map(shotImages.map((s) => [s.shotIndex, s.imageUrl]))
  const audioByIndex = new Map(shotImages.map((s) => [s.shotIndex, s.audioUrl]))
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <p className="text-sm text-zinc-400">每个镜头的画面和配音都好了——先看看，满意就合成完整视频，不满意随时改。</p>
      <div className="space-y-3">
        {shots.map((shot, i) => (
          <div key={i} className="flex gap-4 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/50">
            <div className="relative aspect-[9/16] w-28 shrink-0 bg-zinc-950 sm:w-32">
              {imageByIndex.get(i) ? (
                 
                <img src={imageByIndex.get(i)!} alt={`第 ${i + 1} 个镜头`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">生成中…</div>
              )}
            </div>
            <div className="min-w-0 flex-1 py-3 pr-4">
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <span className="text-sm font-medium text-zinc-300">镜头 {i + 1}</span>
                {shot.cameraMotion && <span>{CAMERA_LABEL[shot.cameraMotion] ?? shot.cameraMotion}</span>}
                {shot.durationMs && <span>{(shot.durationMs / 1000).toFixed(1)} 秒</span>}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{shot.visualDescription}</p>
              {shot.narrationLine && <p className="mt-2 border-l-2 border-fuchsia-500/30 pl-2.5 text-xs italic leading-relaxed text-zinc-400">「{shot.narrationLine}」</p>}
              {audioByIndex.get(i) && (
                <audio controls preload="none" src={audioByIndex.get(i)!} className="mt-2.5 h-8 w-full max-w-72" />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" disabled={busy != null} onClick={onRender} className="gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 text-white shadow-lg shadow-fuchsia-500/25 transition hover:opacity-90 disabled:opacity-50">
          {busy === 'render' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Film className="size-4" aria-hidden />}
          {busy === 'render' ? '正在合成…' : COPY.renderCta}
        </Button>
        <Button size="lg" variant="outline" disabled={busy != null} onClick={onRevise} className="gap-2 border-white/15 bg-transparent text-zinc-200 hover:border-fuchsia-400/40 hover:text-white">
          <PenLine className="size-4" aria-hidden /> {COPY.reviseCta}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy != null} onClick={onRegenerate} className="gap-1.5 text-zinc-500 hover:text-white">
          <Wand2 className="size-3.5" aria-hidden /> {COPY.regenerateCta}
        </Button>
      </div>
    </motion.section>
  )
}

// ---------- READY / PUBLISHED：成片 ----------

function FinishStage({
  bundle,
  busy,
  onPublish,
  onRevise,
  onRegenerate,
  onStartOwn,
}: {
  bundle: CreationBundle
  busy: string | null
  onPublish?: () => void
  onRevise: () => void
  onRegenerate: () => void
  onStartOwn: () => void
}) {
  const { content, assets, version } = bundle
  const published = content.status === 'PUBLISHED'
  const hasVideo = assets.final != null
  const dur = durationLabel(assets.final?.durationMs ?? null)

  // Remix 起点且还没有自己的成片：邀请生成自己的创作
  if (!hasVideo) {
    return (
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <Card className="border-white/10 bg-zinc-900/60">
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20">
              <GitBranch className="size-7 text-fuchsia-300" aria-hidden />
            </div>
            <div className="text-lg font-medium text-zinc-100">这个作品的配方已经在你手上</div>
            <p className="max-w-md text-sm leading-relaxed text-zinc-400">
              画面与声音会由 AI 为你重新创作——它会带上你的气息，而不是别人的像素。生成之后，就是完全属于你的作品。
            </p>
            <Button size="lg" disabled={busy != null} onClick={onStartOwn} className="mt-2 gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-8 text-white shadow-lg shadow-fuchsia-500/25 transition hover:opacity-90 disabled:opacity-50">
              {busy === 'regenerate' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Rocket className="size-4" aria-hidden />}
              开始我的创作
            </Button>
          </CardContent>
        </Card>
      </motion.section>
    )
  }

  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
        <video
          key={assets.final!.url}
          controls
          playsInline
          preload="metadata"
          poster={assets.poster?.url}
          src={assets.final!.url}
          className="mx-auto aspect-[9/16] max-h-[72vh] w-full object-contain"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          {dur && <span>{dur}</span>}
          {version && <span>· {versionLabel(version.number)}</span>}
          <span className="inline-flex items-center gap-1"><Music4 className="size-3" aria-hidden /> AI 旁白</span>
          <Badge variant="outline" className="gap-1 border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-300">
            <Wand2 className="size-3" aria-hidden /> {COPY.aiInvolved}
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {published ? (
          <Badge variant="outline" className="gap-1.5 border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            <BadgeCheck className="size-4" aria-hidden /> 已发布 · 别人可以从这里开始创作
          </Badge>
        ) : (
          <Button size="lg" disabled={busy != null} onClick={onPublish} className="gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 text-white shadow-lg shadow-emerald-500/20 transition hover:opacity-90 disabled:opacity-50">
            {busy === 'publish' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Rocket className="size-4" aria-hidden />}
            {COPY.publishCta}
          </Button>
        )}
        <Button size="lg" variant="outline" disabled={busy != null} onClick={onRevise} className="gap-2 border-white/15 bg-transparent text-zinc-200 hover:border-fuchsia-400/40 hover:text-white">
          <PenLine className="size-4" aria-hidden /> {COPY.reviseCta}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy != null} onClick={onRegenerate} className="gap-1.5 text-zinc-500 hover:text-white">
          <Wand2 className="size-3.5" aria-hidden /> {COPY.regenerateCta}
        </Button>
      </div>

      {!published && (
        <p className="text-xs leading-relaxed text-zinc-600">
          发布后它会出现在「探索」里——其他人看到它，可以从这里开始自己的创作，而你的原作永远属于你。
        </p>
      )}
    </motion.section>
  )
}
