'use client'

// ImagineOS Alpha · M0 Walking Skeleton 首页
// 哲学入口（§42）：不是"你想看什么"，而是"你想表达什么？"
// 本页承载 M0 可交互演示：表达 → 状态机推进 → 版本(修订/恢复) → 发布 → Remix

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BadgeCheck,
  BookOpenText,
  Clapperboard,
  Copy,
  GitBranch,
  Heart,
  History,
  Loader2,
  MessageCircleQuestion,
  PenLine,
  Play,
  Plus,
  Rocket,
  Sparkles,
  Wand2,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'

// ---------- API 类型 ----------

interface ContentListItem {
  id: string
  title: string
  status: string
  visibility: string
  remixPermission: string
  createdAt: string
  updatedAt: string
  currentVersion: { id: string; versionNumber: number; changelog: string | null; createdAt: string } | null
  _count: { versions: number; remixSources: number }
}

interface ExploreItem extends ContentListItem {
  owner: { id: string; displayName: string; handle: string; avatarUrl: string | null }
  remixOf: { sourceContent: { id: string; title: string } } | null
  _count: { versions: number; remixSources: number; interactions: number }
}

interface VersionItem {
  id: string
  versionNumber: number
  parentVersionId: string | null
  creationMethod: string
  changelog: string | null
  createdAt: string
  isCurrent: boolean
}

// ---------- 状态机 UI 配置 ----------

const STATUS_LABEL: Record<string, string> = {
  IDEA: '想法',
  INTENT: '理解意图',
  PLANNING: '创意方向',
  STORY: '故事',
  STORYBOARD: '分镜',
  GENERATING: 'AI 生成中',
  REVIEW: '预览',
  RENDERING: '渲染成片',
  READY: '就绪',
  PUBLISHED: '已发布',
}

const NEXT_STEP: Record<string, { label?: string; to?: string; action?: 'publish' }> = {
  IDEA: { label: '理解我的意图', to: 'INTENT' },
  INTENT: { label: '给我几个创作方向', to: 'PLANNING' },
  PLANNING: { label: '撰写故事', to: 'STORY' },
  STORY: { label: '拆分镜头', to: 'STORYBOARD' },
  STORYBOARD: { label: '开始 AI 生成', to: 'GENERATING' },
  GENERATING: { label: '预览生成结果', to: 'REVIEW' },
  REVIEW: { label: '满意，渲染成片', to: 'RENDERING' },
  RENDERING: { label: '完成', to: 'READY' },
  READY: { label: '发布作品', action: 'publish' },
  PUBLISHED: {},
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'PUBLISHED':
      return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
    case 'READY':
      return 'border-teal-500/40 bg-teal-500/15 text-teal-300'
    case 'REVIEW':
      return 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-300'
    case 'GENERATING':
    case 'RENDERING':
      return 'border-violet-500/40 bg-violet-500/15 text-violet-300 animate-pulse'
    case 'STORY':
    case 'STORYBOARD':
      return 'border-amber-500/40 bg-amber-500/15 text-amber-300'
    default:
      return 'border-zinc-500/40 bg-zinc-500/15 text-zinc-300'
  }
}

const METHOD_LABEL: Record<string, string> = {
  initial: '初版',
  revision: '修订',
  restore: '恢复',
  remix: 'Remix',
  regenerate: '重生成',
}

const SUGGESTIONS = [
  '我想做一个 45 秒的视频，记录我小时候和父亲一起骑自行车。',
  '把我昨晚的梦拍成一支水彩风格的短片。',
  '给小朋友解释：为什么天空是蓝色的？',
  '为我家乡的小吃街拍一部微纪录片。',
]

// ---------- 页面 ----------

export default function Home() {
  const { toast } = useToast()
  const [expression, setExpression] = useState('')
  const [starting, setStarting] = useState(false)
  const [mine, setMine] = useState<ContentListItem[]>([])
  const [explore, setExplore] = useState<ExploreItem[]>([])
  const [loadingLists, setLoadingLists] = useState(true)
  const [anonymous, setAnonymous] = useState(true)

  // 修订对话框
  const [revisionFor, setRevisionFor] = useState<ContentListItem | null>(null)
  const [revisionText, setRevisionText] = useState('')
  const [revisionBusy, setRevisionBusy] = useState(false)

  // 版本时间线对话框
  const [timelineFor, setTimelineFor] = useState<ContentListItem | null>(null)
  const [timeline, setTimeline] = useState<VersionItem[] | null>(null)
  const [timelineBusy, setTimelineBusy] = useState<string | null>(null)

  const [busyContentId, setBusyContentId] = useState<string | null>(null)

  const loadLists = useCallback(async () => {
    setLoadingLists(true)
    try {
      const [mineRes, exploreRes] = await Promise.all([
        fetch('/api/contents?scope=mine'),
        fetch('/api/contents?scope=explore'),
      ])
      const mineJson = (await mineRes.json()) as { items?: ContentListItem[]; anonymous?: boolean }
      const exploreJson = (await exploreRes.json()) as { items?: ExploreItem[] }
      setMine(mineJson.items ?? [])
      setAnonymous(Boolean(mineJson.anonymous))
      setExplore(exploreJson.items ?? [])
    } catch {
      toast({ title: '加载失败', description: '网络似乎打了个盹，稍后再试。', variant: 'destructive' })
    } finally {
      setLoadingLists(false)
    }
  }, [toast])

  useEffect(() => {
    void loadLists()
  }, [loadLists])

  const startCreation = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) {
        toast({ title: '还想听你说完', description: '写下你想表达的东西，哪怕只是一个念头。' })
        return
      }
      setStarting(true)
      try {
        const res = await fetch('/api/imagine/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmed }),
        })
        const json = (await res.json()) as { title?: string; message?: string; message2?: string; error?: string }
        if (!res.ok) {
          toast({ title: '未能开始', description: (json as { message?: string }).message ?? '请稍后再试', variant: 'destructive' })
          return
        }
        setExpression('')
        toast({
          title: '表达已收到 ✦',
          description: `《${json.title}》已创建。Alpha 当前提供创作流程骨架，AI 编译将在下个里程碑接管。`,
        })
        await loadLists()
      } catch {
        toast({ title: '网络错误', description: '请稍后再试。', variant: 'destructive' })
      } finally {
        setStarting(false)
      }
    },
    [loadLists, toast],
  )

  const mutateContent = useCallback(
    async (contentId: string, path: string, body?: unknown, successTitle?: string) => {
      setBusyContentId(contentId)
      try {
        const res = await fetch(`/api/contents/${contentId}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        })
        const json = (await res.json().catch(() => ({}))) as { message?: string; versionNumber?: number }
        if (!res.ok) {
          toast({ title: '操作未完成', description: json.message ?? '请稍后再试', variant: 'destructive' })
          return false
        }
        if (successTitle) {
          toast({ title: successTitle, description: json.message ?? (json.versionNumber ? `现在是 v${json.versionNumber}` : undefined) })
        }
        await loadLists()
        return true
      } catch {
        toast({ title: '网络错误', description: '请稍后再试。', variant: 'destructive' })
        return false
      } finally {
        setBusyContentId(null)
      }
    },
    [loadLists, toast],
  )

  const openTimeline = useCallback(async (item: ContentListItem) => {
    setTimelineFor(item)
    setTimeline(null)
    try {
      const res = await fetch(`/api/contents/${item.id}/versions`)
      const json = (await res.json()) as { versions?: VersionItem[] }
      setTimeline(json.versions ?? [])
    } catch {
      setTimeline([])
    }
  }, [])

  const restoreVersion = useCallback(
    async (contentId: string, versionId: string) => {
      setTimelineBusy(versionId)
      try {
        const res = await fetch(`/api/contents/${contentId}/versions/${versionId}/restore`, { method: 'POST' })
        const json = (await res.json().catch(() => ({}))) as { message?: string; versionNumber?: number }
        if (!res.ok) {
          toast({ title: '恢复失败', description: json.message ?? '请稍后再试', variant: 'destructive' })
          return
        }
        toast({ title: `已恢复为新版本 v${json.versionNumber}`, description: '旧版本仍在时间线上，随时可再回去。' })
        await openTimeline(timelineFor ?? ({ id: contentId } as ContentListItem))
        await loadLists()
      } finally {
        setTimelineBusy(null)
      }
    },
    [loadLists, openTimeline, timelineFor, toast],
  )

  const submitRevision = useCallback(async () => {
    if (!revisionFor) return
    const text = revisionText.trim()
    if (!text) {
      toast({ title: '想怎么改？', description: '用一句话描述，比如"再温暖一点"。' })
      return
    }
    setRevisionBusy(true)
    const ok = await mutateContent(
      revisionFor.id,
      '/versions',
      { method: 'revision', changelog: text },
      '新版本已创建',
    )
    setRevisionBusy(false)
    if (ok) {
      setRevisionFor(null)
      setRevisionText('')
    }
  }, [mutateContent, revisionFor, revisionText, toast])

  const remix = useCallback(
    async (item: { id: string; title: string }) => {
      const ok = await mutateContent(item.id, '/remix', undefined, 'Remix 已创建')
      if (ok) toast({ title: `${item.title} · Remix`, description: '副本已进入你的创作循环，去"我的创作"继续。' })
    },
    [mutateContent, toast],
  )

  const onNextStep = useCallback(
    async (item: ContentListItem) => {
      const step = NEXT_STEP[item.status]
      if (!step || !step.label) return
      if (step.action === 'publish') {
        await mutateContent(item.id, '/publish', { visibility: 'public' }, '作品已发布 ✦')
        return
      }
      await mutateContent(item.id, '/status', { to: step.to }, `进入「${STATUS_LABEL[step.to ?? ''] ?? step.to}」`)
    },
    [mutateContent],
  )

  const exploreCards = useMemo(() => explore.slice(0, 9), [explore])

  return (
    <div className="dark min-h-screen flex flex-col bg-zinc-950 text-zinc-100 selection:bg-fuchsia-500/30">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-400 shadow-lg shadow-fuchsia-500/25">
              <Sparkles className="size-5 text-white" aria-hidden />
            </div>
            <div className="leading-tight">
              <div className="text-lg font-semibold tracking-tight">ImagineOS</div>
              <div className="hidden text-[11px] text-zinc-400 sm:block">想到了，就让它发生。</div>
            </div>
          </div>
          <nav className="flex items-center gap-1 text-sm text-zinc-300" aria-label="主导航">
            <a className="rounded-lg px-3 py-2 transition hover:bg-white/5 hover:text-white" href="#imagine">创造</a>
            <a className="rounded-lg px-3 py-2 transition hover:bg-white/5 hover:text-white" href="#mine">我的创作</a>
            <a className="rounded-lg px-3 py-2 transition hover:bg-white/5 hover:text-white" href="#explore">探索</a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* 英雄区：第一性问题 */}
        <section id="imagine" className="relative overflow-hidden px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-[-20%] h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-violet-600/20 blur-[120px]" />
            <div className="absolute right-[10%] top-[30%] h-[240px] w-[240px] rounded-full bg-fuchsia-500/15 blur-[90px]" />
            <div className="absolute left-[5%] top-[55%] h-[200px] w-[200px] rounded-full bg-amber-400/10 blur-[80px]" />
          </div>

          <div className="relative mx-auto max-w-3xl text-center">
            <Badge variant="outline" className="mb-6 gap-1.5 border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300">
              <Wand2 className="size-3" aria-hidden /> AI 原生创作循环 · Alpha M0
            </Badge>
            <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              你想<span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent">表达</span>
              什么？
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-zinc-400">
              不需要会剪辑、会摄影、会写 Prompt。说人话，剩下的交给 AI 创作团队。
            </p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="mx-auto mt-8 max-w-2xl"
            >
              <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-3 shadow-2xl shadow-black/40 backdrop-blur">
                <Textarea
                  value={expression}
                  onChange={(e) => setExpression(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void startCreation(expression)
                  }}
                  placeholder="我想做一个 45 秒的视频，记录我小时候和父亲一起骑自行车……"
                  className="min-h-[96px] resize-none border-0 bg-transparent px-3 pt-3 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-0"
                  aria-label="写下你想表达的东西"
                  maxLength={2000}
                />
                <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-1 pt-2">
                  <div className="text-xs text-zinc-500">自然语言 · 语音/图片（即将支持）</div>
                  <Button
                    size="lg"
                    disabled={starting}
                    onClick={() => void startCreation(expression)}
                    className="gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 text-white shadow-lg shadow-fuchsia-500/25 transition hover:opacity-90 disabled:opacity-50"
                  >
                    {starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Rocket className="size-4" aria-hidden />}
                    {starting ? '正在收下你的表达…' : '开始创造'}
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setExpression(s)}
                    className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-zinc-300 transition hover:border-fuchsia-400/40 hover:text-white"
                  >
                    {s.length > 22 ? `${s.slice(0, 22)}…` : s}
                  </button>
                ))}
              </div>
            </motion.div>

            {/* Creation Loop 主循环 */}
            <div className="mt-12 flex flex-wrap items-center justify-center gap-x-2 gap-y-3 text-sm text-zinc-400">
              {['想', '创', '看', '改', '分享', '共创', '再创'].map((s, i) => (
                <span key={s} className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-[13px] font-medium text-zinc-200">{s}</span>
                  {i < 6 && <ArrowRight className="size-3 text-zinc-600" aria-hidden />}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* 我的创作 */}
        <section id="mine" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 pb-14 sm:px-6">
          <SectionHeader
            icon={<PenLine className="size-4" aria-hidden />}
            title="我的创作"
            desc={anonymous ? '开始一次表达，就会出现在这里。' : '每一个想法都是一个可继续创造的作品。'}
            right={
              mine.length > 0 ? (
                <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">{mine.length} 个作品</Badge>
              ) : undefined
            }
          />
          {loadingLists ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
            </div>
          ) : mine.length === 0 ? (
            <EmptyState
              icon={<MessageCircleQuestion className="size-8 text-zinc-500" aria-hidden />}
              title={anonymous ? '还没有开始第一次表达' : '这里还空着'}
              desc={anonymous ? '在上面写下你想表达的东西——一个念头就够了。' : '从一句"我想表达…"开始。'}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {mine.map((item) => (
                <ContentCard
                  key={item.id}
                  item={item}
                  busy={busyContentId === item.id}
                  onNext={() => void onNextStep(item)}
                  onRevise={() => setRevisionFor(item)}
                  onTimeline={() => void openTimeline(item)}
                />
              ))}
            </div>
          )}
        </section>

        <Separator className="bg-white/5" />

        {/* 探索 */}
        <section id="explore" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
          <SectionHeader
            icon={<Clapperboard className="size-4" aria-hidden />}
            title="探索"
            desc="别人正在表达什么。每一件都可以成为你创作的起点。"
            right={<Badge variant="secondary" className="bg-zinc-800 text-zinc-300">{explore.length} 件公开作品</Badge>}
          />
          {loadingLists ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
            </div>
          ) : exploreCards.length === 0 ? (
            <EmptyState
              icon={<Play className="size-8 text-zinc-500" aria-hidden />}
              title="探索区还是空的"
              desc="发布第一件作品，点亮这里。"
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {exploreCards.map((item) => (
                <ExploreCard key={item.id} item={item} onRemix={() => void remix({ id: item.id, title: item.title })} />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* 页脚（sticky） */}
      <footer className="mt-auto border-t border-white/5 bg-zinc-950/90">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-zinc-500 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-fuchsia-400/70" aria-hidden />
            <span>ImagineOS Alpha · M0 Walking Skeleton</span>
          </div>
          <div>Content Object · 版本 · Remix 血缘 已就绪 — Intent Engine / AI 生成管线将于 M1 接入</div>
        </div>
      </footer>

      {/* 修订对话框 */}
      <Dialog open={revisionFor !== null} onOpenChange={(open) => !open && setRevisionFor(null)}>
        <DialogContent className="border-white/10 bg-zinc-900 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="size-4 text-fuchsia-400" aria-hidden />
              你想怎么改？
            </DialogTitle>
            <DialogDescription>
              用一句话描述修改方向（如「再温暖一点」「结尾别这么悲伤」）。系统会创建新版本——旧版本永远保留。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={revisionText}
            onChange={(e) => setRevisionText(e.target.value)}
            placeholder="再温暖一点，结尾加上母亲在门口招手。"
            className="min-h-[88px] border-white/10 bg-zinc-950 placeholder:text-zinc-600"
            maxLength={500}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setRevisionFor(null)} className="text-zinc-400">取消</Button>
            <Button
              disabled={revisionBusy}
              onClick={() => void submitRevision()}
              className="gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90"
            >
              {revisionBusy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              创建新版本
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 版本时间线对话框 */}
      <Dialog open={timelineFor !== null} onOpenChange={(open) => !open && setTimelineFor(null)}>
        <DialogContent className="border-white/10 bg-zinc-900 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="size-4 text-amber-300" aria-hidden />
              版本时间线
              {timelineFor && <span className="truncate text-sm font-normal text-zinc-400">《{timelineFor.title}》</span>}
            </DialogTitle>
            <DialogDescription>每个版本都可查看、恢复。恢复会创建新版本，而不是覆盖历史。</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-96 pr-3">
            {timeline === null ? (
              <div className="flex items-center justify-center gap-2 py-10 text-zinc-500">
                <Loader2 className="size-4 animate-spin" aria-hidden /> 正在翻阅历史…
              </div>
            ) : timeline.length === 0 ? (
              <div className="py-10 text-center text-sm text-zinc-500">还没有版本。先完成一次创作。</div>
            ) : (
              <ol className="relative space-y-3 border-l border-white/10 pl-5">
                {timeline.map((v) => (
                  <li key={v.id} className="relative">
                    <span
                      aria-hidden
                      className={`absolute -left-[26px] top-1.5 size-2.5 rounded-full ${v.isCurrent ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]' : 'bg-zinc-600'}`}
                    />
                    <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-zinc-200">v{v.versionNumber}</span>
                        <Badge variant="outline" className="border-white/10 bg-white/5 text-[11px] text-zinc-300">
                          {METHOD_LABEL[v.creationMethod] ?? v.creationMethod}
                        </Badge>
                        {v.isCurrent && (
                          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[11px] text-emerald-300">
                            当前
                          </Badge>
                        )}
                      </div>
                      {v.changelog && <p className="mt-1.5 text-sm text-zinc-400">{v.changelog}</p>}
                      <div className="mt-2 flex items-center justify-between">
                        <time className="text-xs text-zinc-600">{new Date(v.createdAt).toLocaleString('zh-CN')}</time>
                        {!v.isCurrent && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={timelineBusy === v.id}
                            onClick={() => void restoreVersion(timelineFor?.id ?? '', v.id)}
                            className="h-8 gap-1.5 border-white/15 bg-transparent text-xs text-zinc-300 hover:border-amber-400/40 hover:text-amber-300"
                          >
                            {timelineBusy === v.id ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <History className="size-3" aria-hidden />}
                            恢复此版
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

    </div>
  )
}

// ---------- 子组件 ----------

function SectionHeader({ icon, title, desc, right }: { icon: React.ReactNode; title: string; desc: string; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-fuchsia-300">{icon}</span>
          {title}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{desc}</p>
      </div>
      {right}
    </div>
  )
}

function ContentCard({
  item,
  busy,
  onNext,
  onRevise,
  onTimeline,
}: {
  item: ContentListItem
  busy: boolean
  onNext: () => void
  onRevise: () => void
  onTimeline: () => void
}) {
  const step = NEXT_STEP[item.status] ?? {}
  return (
    <Card className="group border-white/10 bg-zinc-900/60 transition hover:border-fuchsia-400/25">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 font-medium leading-snug text-zinc-100">{item.title}</h3>
          <Badge variant="outline" className={`shrink-0 text-[11px] ${statusBadgeClass(item.status)}`}>
            {STATUS_LABEL[item.status] ?? item.status}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1"><GitBranch className="size-3" aria-hidden />v{item.currentVersion?.versionNumber ?? 0} · 共 {item._count.versions} 版</span>
          {item._count.remixSources > 0 && (
            <span className="flex items-center gap-1 text-fuchsia-300/80"><Copy className="size-3" aria-hidden />被 Remix ×{item._count.remixSources}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-2">
        <p className="line-clamp-1 text-xs text-zinc-500">
          {item.currentVersion?.changelog ?? '还没有版本记录——完成初稿后会在这里看到变化。'}
        </p>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {step.label ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={onNext}
            className="h-9 gap-1.5 bg-gradient-to-r from-violet-500/90 to-fuchsia-500/90 text-white hover:opacity-90"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ArrowRight className="size-3.5" aria-hidden />}
            {step.label}
          </Button>
        ) : (
          <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-[11px] text-emerald-300">
            <BadgeCheck className="size-3" aria-hidden /> 已公开发布
          </Badge>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={onRevise}
          className="h-9 gap-1.5 border-white/15 bg-transparent text-zinc-300 hover:border-fuchsia-400/40 hover:text-white"
        >
          <PenLine className="size-3.5" aria-hidden /> 修订
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onTimeline}
          className="h-9 gap-1.5 border-white/15 bg-transparent text-zinc-300 hover:border-amber-400/40 hover:text-amber-200"
        >
          <History className="size-3.5" aria-hidden /> 版本
        </Button>
      </CardFooter>
    </Card>
  )
}

function ExploreCard({ item, onRemix }: { item: ExploreItem; onRemix: () => void }) {
  return (
    <Card className="flex flex-col border-white/10 bg-zinc-900/60 transition hover:border-violet-400/25">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 font-medium leading-snug text-zinc-100">{item.title}</h3>
          <Badge variant="outline" className="shrink-0 gap-1 border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-300">
            <Wand2 className="size-3" aria-hidden /> AI 协同
          </Badge>
        </div>
        {item.remixOf?.sourceContent && (
          <p className="flex items-center gap-1 text-xs text-fuchsia-300/80">
            <GitBranch className="size-3" aria-hidden /> 基于《{item.remixOf.sourceContent.title}》
          </p>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          <div className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 text-xs">
            {item.owner.displayName.slice(0, 1)}
          </div>
          {item.owner.displayName}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Heart className="size-3.5 text-rose-400/70" aria-hidden /> {item._count.interactions}
        </div>
      </CardContent>
      <CardFooter>
        <Button
          size="sm"
          onClick={onRemix}
          className="h-9 w-full gap-1.5 bg-white/10 text-zinc-100 backdrop-blur transition hover:bg-gradient-to-r hover:from-violet-500 hover:to-fuchsia-500 hover:text-white"
        >
          <Copy className="size-3.5" aria-hidden /> Remix 这个作品
        </Button>
      </CardFooter>
    </Card>
  )
}

function SkeletonCard() {
  return (
    <Card className="border-white/10 bg-zinc-900/40">
      <CardHeader className="gap-2 pb-3">
        <div className="h-5 w-2/3 animate-pulse rounded bg-zinc-800" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-800/70" />
      </CardHeader>
      <CardContent><div className="h-3 w-full animate-pulse rounded bg-zinc-800/50" /></CardContent>
      <CardFooter className="gap-2">
        <div className="h-9 w-24 animate-pulse rounded-lg bg-zinc-800/70" />
        <div className="h-9 w-16 animate-pulse rounded-lg bg-zinc-800/50" />
      </CardFooter>
    </Card>
  )
}

function EmptyState({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 bg-zinc-900/30 py-14 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-white/5">{icon}</div>
      <div>
        <div className="font-medium text-zinc-300">{title}</div>
        <div className="mt-1 flex items-center justify-center gap-1 text-sm text-zinc-500">
          <BookOpenText className="size-3.5" aria-hidden /> {desc}
        </div>
      </div>
    </div>
  )
}
