'use client'

// ImagineOS 首页（M1 · 评审后增量版）
// 保持 M0 信息架构（评审 P1：Home→主创作入口→我的创作→探索，不重构）；
// P0-1 Explore 视觉化：视觉内容是卡片第一元素；P0-2 「你想表达什么？」保持核心入口；
// P0-3 全部文案走产品语言字典（src/app/_language）；
// P1 Remix 文案 →「从这里开始创作」（用户语言规则 user-language-rules.md §4）。

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BadgeCheck,
  BookOpenText,
  Clapperboard,
  Film,
  GitBranch,
  Heart,
  History,
  Images,
  Loader2,
  MessageCircleQuestion,
  PenLine,
  Play,
  PlugZap,
  Rocket,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { COPY, GENERATION_MODE_DESC, STAGE_LABEL, durationLabel, generationModeLabel, versionLabel, versionWithCount, METHOD_LABEL } from '@/app/_language'

// ---------- API 类型 ----------

interface ContentListItem {
  id: string
  title: string
  status: string
  visibility: string
  remixPermission: string
  createdAt: string
  updatedAt: string
  posterUrl: string | null
  videoUrl: string | null
  durationMs: number | null
  /** 展示面画幅（成片宽高推断；多画幅——播放弹窗自适应） */
  aspectRatio?: '9:16' | '16:9'
  generationMode: { mode: string; nativeShots: number; totalShots: number } | null
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

const SUGGESTIONS = [
  '我想做一个 45 秒的视频，记录我小时候和父亲一起骑自行车。',
  '把我昨晚的梦拍成一支水彩风格的短片。',
  '给小朋友解释：为什么天空是蓝色的？',
  '为我家乡的小吃街拍一部微纪录片。',
]

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

/** 生成模式徽章（2026-10-07）：真实产物路径必须可见——防止把图像+运镜合成误认为 AI 视频模型产物 */
function GenerationModeBadge({ mode }: { mode: ContentListItem['generationMode'] }) {
  const label = generationModeLabel(mode?.mode, mode?.nativeShots, mode?.totalShots)
  if (!label || !mode) return null
  const isComposition = mode.mode === 'composition'
  return (
    <Badge
      variant="outline"
      title={GENERATION_MODE_DESC[mode.mode]}
      className={
        isComposition
          ? 'gap-1 border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-300'
          : 'gap-1 border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-300'
      }
    >
      {isComposition ? <Images className="size-3" aria-hidden /> : <Film className="size-3" aria-hidden />}
      {label}
    </Badge>
  )
}

// ---------- 页面 ----------

export default function Home() {
  const router = useRouter()
  const { toast } = useToast()
  const [expression, setExpression] = useState('')
  const [starting, setStarting] = useState(false)
  const [mine, setMine] = useState<ContentListItem[]>([])
  const [explore, setExplore] = useState<ExploreItem[]>([])
  const [loadingLists, setLoadingLists] = useState(true)
  const [anonymous, setAnonymous] = useState(true)

  // 修订对话框（早期阶段的快速版本；成片后的智能修改在创作空间）
  const [revisionFor, setRevisionFor] = useState<ContentListItem | null>(null)
  const [revisionText, setRevisionText] = useState('')

  // 版本时间线对话框
  const [timelineFor, setTimelineFor] = useState<ContentListItem | null>(null)
  const [timeline, setTimeline] = useState<VersionItem[] | null>(null)
  const [timelineBusy, setTimelineBusy] = useState<string | null>(null)

  // 删除作品对话框（底座能力：作品管理；不可逆操作 → 显式确认）
  const [deleteFor, setDeleteFor] = useState<ContentListItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 探索作品播放对话框（视觉内容第一：点开即看）
  const [playingItem, setPlayingItem] = useState<ExploreItem | null>(null)

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
        const json = (await res.json()) as { contentId?: string; createUrl?: string; message?: string; error?: string }
        if (!res.ok) {
          toast({ title: '未能开始', description: (json as { message?: string }).message ?? '请稍后再试', variant: 'destructive' })
          return
        }
        setExpression('')
        // 直达创作空间：想 → 创 的第一步
        if (json.createUrl) {
          router.push(json.createUrl)
          return
        }
        await loadLists()
      } catch {
        toast({ title: '网络错误', description: '请稍后再试。', variant: 'destructive' })
      } finally {
        setStarting(false)
      }
    },
    [loadLists, router, toast],
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
          toast({ title: successTitle, description: json.message ?? (json.versionNumber ? `现在是${versionLabel(json.versionNumber)}` : undefined) })
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
        toast({ title: `已回到「${versionLabel(json.versionNumber ?? 1)}」`, description: '旧版本仍在时间线上，随时可再回去。' })
        await openTimeline(timelineFor ?? ({ id: contentId } as ContentListItem))
        await loadLists()
      } finally {
        setTimelineBusy(null)
      }
    },
    [loadLists, openTimeline, timelineFor, toast],
  )

  const submitRevision = useCallback(() => {
    if (!revisionFor) return
    const text = revisionText.trim()
    if (!text) {
      toast({ title: COPY.revisionTitle, description: '用一句话描述，比如「再温暖一点」。' })
      return
    }
    // Gate 7 修复：旧实现 POST /versions 只创建版本、不触发生成（真实用户踩中：
    // 修订「再温暖一点」后永远停在 GENERATING）。改为跳转创作空间，走完整修订链路。
    router.push(`/create/${revisionFor.id}?revise=${encodeURIComponent(text)}`)
  }, [revisionFor, revisionText, toast, router])

  const remix = useCallback(
    async (item: { id: string; title: string }) => {
      const ok = await mutateContent(item.id, '/remix', undefined, COPY.remixDone)
      if (ok) {
        toast({
          title: `${item.title} · 你的版本`,
          description: '配方已到你手上——去「我的创作」继续创作，画面会为你重新生成。',
        })
      }
    },
    [mutateContent, toast],
  )

  const confirmDelete = useCallback(
    async () => {
      if (!deleteFor) return
      setDeleting(true)
      try {
        const res = await fetch(`/api/contents/${deleteFor.id}`, { method: 'DELETE' })
        const json = (await res.json().catch(() => ({}))) as { message?: string }
        if (!res.ok) {
          toast({ title: '删除没有完成', description: json.message ?? '请稍后再试', variant: 'destructive' })
          return
        }
        setMine((prev) => prev.filter((i) => i.id !== deleteFor.id))
        toast({ title: '作品已删除', description: json.message ?? '画面、配音与任务记录一并清理。' })
      } catch {
        toast({ title: '网络错误', description: '请稍后再试。', variant: 'destructive' })
      } finally {
        setDeleting(false)
        setDeleteFor(null)
      }
    },
    [deleteFor, toast],
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
            <a className="hidden rounded-lg px-3 py-2 transition hover:bg-white/5 hover:text-white sm:inline-flex" href="#imagine">创造</a>
            <a className="hidden rounded-lg px-3 py-2 transition hover:bg-white/5 hover:text-white sm:inline-flex" href="#mine">我的创作</a>
            <a className="hidden rounded-lg px-3 py-2 transition hover:bg-white/5 hover:text-white sm:inline-flex" href="#explore">探索</a>
            <Link
              className="ml-1 flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-violet-300 transition hover:border-violet-400 hover:bg-violet-500/20 hover:text-violet-200"
              href="/settings/models"
              title="配置你自己的模型服务（API Key）"
            >
              <PlugZap className="size-4" aria-hidden />
              模型服务
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* 英雄区：第一性问题（评审 P0-2：保持原样） */}
        <section id="imagine" className="relative overflow-hidden px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-[-20%] h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-violet-600/20 blur-[120px]" />
            <div className="absolute right-[10%] top-[30%] h-[240px] w-[240px] rounded-full bg-fuchsia-500/15 blur-[90px]" />
            <div className="absolute left-[5%] top-[55%] h-[200px] w-[200px] rounded-full bg-amber-400/10 blur-[80px]" />
          </div>

          <div className="relative mx-auto max-w-3xl text-center">
            <Badge variant="outline" className="mb-6 gap-1.5 border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300">
              <Wand2 className="size-3" aria-hidden /> AI 原生创作循环 · Alpha
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

        {/* 我的创作（评审 P1：保持区块，卡片接入创作空间） */}
        <section id="mine" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 pb-14 sm:px-6">
          <SectionHeader
            icon={<PenLine className="size-4" aria-hidden />}
            title="我的创作"
            desc={anonymous ? '开始一次表达，就会出现在这里。' : '每一个想法都是一个可以继续生长的作品。'}
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
              desc={anonymous ? '在上面写下你想表达的东西——一个念头就够了。' : '从一句「我想表达…」开始。'}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {mine.map((item) => (
                <ContentCard
                  key={item.id}
                  item={item}
                  busy={busyContentId === item.id}
                  onRevise={() => setRevisionFor(item)}
                  onTimeline={() => void openTimeline(item)}
                  onDelete={() => setDeleteFor(item)}
                />
              ))}
            </div>
          )}
        </section>

        <Separator className="bg-white/5" />

        {/* 探索（评审 P0-1：视觉内容是卡片第一元素） */}
        <section id="explore" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
          <SectionHeader
            icon={<Clapperboard className="size-4" aria-hidden />}
            title="探索"
            desc="别人正在表达什么。每一件，都可以成为你创作的起点。"
            right={<Badge variant="secondary" className="bg-zinc-800 text-zinc-300">{explore.length} 件公开作品</Badge>}
          />
          {loadingLists ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => <SkeletonExploreCard key={i} />)}
            </div>
          ) : exploreCards.length === 0 ? (
            <EmptyState
              icon={<Play className="size-8 text-zinc-500" aria-hidden />}
              title="探索区还是空的"
              desc="发布第一件作品，点亮这里。"
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {exploreCards.map((item) => (
                <ExploreCard
                  key={item.id}
                  item={item}
                  busy={busyContentId === item.id}
                  onPlay={() => setPlayingItem(item)}
                  onRemix={() => void remix({ id: item.id, title: item.title })}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* 页脚（评审 P0-3：用户语言） */}
      <footer className="mt-auto border-t border-white/5 bg-zinc-950/90">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-zinc-500 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-fuchsia-400/70" aria-hidden />
            <span>ImagineOS Alpha</span>
          </div>
          <div>每一件作品都带着它的完整来路 · 任何人都能从这里开始创作</div>
        </div>
      </footer>

      {/* 修订对话框（早期快速版本） */}
      <Dialog open={revisionFor !== null} onOpenChange={(open) => !open && setRevisionFor(null)}>
        <DialogContent className="border-white/10 bg-zinc-900 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="size-4 text-fuchsia-400" aria-hidden />
              {COPY.revisionTitle}
            </DialogTitle>
            <DialogDescription>
              用一句话描述修改方向（如「再温暖一点」「结尾别这么悲伤」）。会创建新的一版——旧版本永远保留。
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
              onClick={() => submitRevision()}
              className="gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90"
            >
              去创作空间改这一版
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除作品对话框（不可逆 → 显式确认 + 后果说明） */}
      <Dialog open={deleteFor !== null} onOpenChange={(open) => !open && setDeleteFor(null)}>
        <DialogContent className="border-white/10 bg-zinc-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="size-4 text-red-400" aria-hidden />
              删除这个作品？
              {deleteFor && <span className="truncate text-sm font-normal text-zinc-400">《{deleteFor.title}》</span>}
            </DialogTitle>
            <DialogDescription>
              删除后无法找回：画面、配音、版本历史与任务记录会一并清理。公开过的话，探索区也会同步下架。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setDeleteFor(null)} className="text-zinc-400">先留着</Button>
            <Button
              onClick={() => void confirmDelete()}
              disabled={deleting}
              className="gap-2 bg-red-600/90 text-white hover:bg-red-600"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
              {deleting ? '正在删除…' : '删除作品'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 版本时间线对话框（用户语言） */}
      <Dialog open={timelineFor !== null} onOpenChange={(open) => !open && setTimelineFor(null)}>
        <DialogContent className="border-white/10 bg-zinc-900 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="size-4 text-amber-300" aria-hidden />
              这个作品的来路
              {timelineFor && <span className="truncate text-sm font-normal text-zinc-400">《{timelineFor.title}》</span>}
            </DialogTitle>
            <DialogDescription>每一版都还在。回到任何一版，会创建新的一版，而不是抹掉历史。</DialogDescription>
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
                        <span className="text-sm text-zinc-200">{versionLabel(v.versionNumber)}</span>
                        <Badge variant="outline" className="border-white/10 bg-white/5 text-[11px] text-zinc-300">
                          {METHOD_LABEL[v.creationMethod] ?? v.creationMethod}
                        </Badge>
                        {v.isCurrent && (
                          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[11px] text-emerald-300">
                            {COPY.latestVersion}
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
                            回到这一版
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

      {/* 作品播放对话框（视频平台感的核心交互） */}
      {playingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`播放 ${playingItem.title}`}>
          <div className="relative w-full max-w-md">
            <button
              onClick={() => setPlayingItem(null)}
              className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-zinc-200 backdrop-blur-md transition hover:bg-black/80 hover:text-white"
              aria-label="关闭"
            >
              <X className="size-3.5" aria-hidden /> 关闭
            </button>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900">
              {playingItem.videoUrl ? (
                <video
                  key={playingItem.id}
                  controls
                  autoPlay
                  playsInline
                  poster={playingItem.posterUrl ?? undefined}
                  src={playingItem.videoUrl}
                  className={playingItem.aspectRatio === '16:9' ? 'aspect-[16/9] max-h-[62vh] w-full bg-black object-contain' : 'aspect-[9/16] max-h-[62vh] w-full bg-black object-contain'}
                />
              ) : (
                <div className={playingItem.aspectRatio === '16:9' ? 'flex aspect-[16/9] max-h-[62vh] items-center justify-center bg-zinc-950' : 'flex aspect-[9/16] max-h-[62vh] items-center justify-center bg-zinc-950'}>
                  <Loader2 className="size-8 animate-spin text-zinc-600" aria-hidden />
                </div>
              )}
              <div className="space-y-4 p-5">
                <div>
                  <h3 className="text-lg font-semibold leading-snug text-zinc-100">{playingItem.title}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {durationLabel(playingItem.durationMs) && (
                      <span className="text-xs text-zinc-500">{durationLabel(playingItem.durationMs)}</span>
                    )}
                    <GenerationModeBadge mode={playingItem.generationMode} />
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-zinc-300">
                    <div className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 text-xs">
                      {playingItem.owner.displayName.slice(0, 1)}
                    </div>
                    {playingItem.owner.displayName}
                  </div>
                  <Badge variant="outline" className="gap-1 border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-300">
                    <Wand2 className="size-3" aria-hidden /> {COPY.aiInvolved}
                  </Badge>
                </div>
                <Button
                  onClick={() => {
                    const item = playingItem
                    setPlayingItem(null)
                    void remix({ id: item.id, title: item.title })
                  }}
                  className="h-11 w-full gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/25 transition hover:opacity-90"
                >
                  <GitBranch className="size-4" aria-hidden /> {COPY.remixCta}
                </Button>
                <a
                  href={`/w/${playingItem.id}`}
                  className="flex items-center justify-center gap-1.5 rounded-lg py-1 text-xs text-zinc-500 transition hover:text-white"
                >
                  去作品分享页看看 <ArrowRight className="size-3" aria-hidden />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
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

/** 我的创作卡片：视觉优先（有成片封面时展示），主 CTA 进入创作空间 */
function ContentCard({
  item,
  busy,
  onRevise,
  onTimeline,
  onDelete,
}: {
  item: ContentListItem
  busy: boolean
  onRevise: () => void
  onTimeline: () => void
  onDelete: () => void
}) {
  return (
    <Card className="group overflow-hidden border-white/10 bg-zinc-900/60 transition hover:border-fuchsia-400/25">
      <a href={`/create/${item.id}`} className="block" aria-label={`继续创作 ${item.title}`}>
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-950">
          {item.posterUrl ? (
             
            <img src={item.posterUrl} alt={item.title} className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100 group-hover:scale-[1.02]" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-violet-950/40">
              <div className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                <Sparkles className="size-5 text-zinc-500" aria-hidden />
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-3">
            <Badge variant="outline" className={`text-[11px] ${statusBadgeClass(item.status)}`}>
              {STAGE_LABEL[item.status] ?? item.status}
            </Badge>
            {durationLabel(item.durationMs) && (
              <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-zinc-300">{durationLabel(item.durationMs)}</span>
            )}
          </div>
        </div>
      </a>
      <CardHeader className="gap-2 pb-2 pt-3.5">
        <h3 className="line-clamp-1 font-medium leading-snug text-zinc-100">{item.title}</h3>
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
          <span>{item.currentVersion ? versionWithCount(item.currentVersion.versionNumber, item._count.versions) : '还没开始'}</span>
          {item._count.remixSources > 0 && (
            <span className="flex items-center gap-1 text-fuchsia-300/80"><GitBranch className="size-3" aria-hidden />被续创 ×{item._count.remixSources}</span>
          )}
          {item.generationMode && <GenerationModeBadge mode={item.generationMode} />}
        </div>
      </CardHeader>
      <CardContent className="pb-1">
        <p className="line-clamp-1 text-xs text-zinc-500">
          {item.currentVersion?.changelog ?? '完成初稿后，这里会记录它的每一次生长。'}
        </p>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => (window.location.href = `/create/${item.id}`)}
          className="h-9 flex-1 gap-1.5 bg-gradient-to-r from-violet-500/90 to-fuchsia-500/90 text-white hover:opacity-90"
        >
          <ArrowRight className="size-3.5" aria-hidden /> {COPY.continueCreate}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onRevise}
          className="h-9 gap-1.5 border-white/15 bg-transparent text-zinc-300 hover:border-fuchsia-400/40 hover:text-white"
        >
          <PenLine className="size-3.5" aria-hidden /> 修改
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onTimeline}
          className="h-9 gap-1.5 border-white/15 bg-transparent text-zinc-300 hover:border-amber-400/40 hover:text-amber-200"
        >
          <History className="size-3.5" aria-hidden /> 来路
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onDelete}
          aria-label={`删除 ${item.title}`}
          title="删除这个作品"
          disabled={busy}
          className="h-9 w-9 shrink-0 border-white/15 bg-transparent text-zinc-500 hover:border-red-400/40 hover:text-red-300"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      </CardFooter>
    </Card>
  )
}

/** 探索卡片（评审 P0-1 结构）：Visual Content → Title → Creator → AI involvement → Remix */
function ExploreCard({
  item,
  busy,
  onPlay,
  onRemix,
}: {
  item: ExploreItem
  busy: boolean
  onPlay: () => void
  onRemix: () => void
}) {
  return (
    <Card className="group flex flex-col overflow-hidden border-white/10 bg-zinc-900/60 transition hover:border-violet-400/25">
      {/* Visual Content —— 第一视觉元素 */}
      <button onClick={onPlay} className="relative aspect-[9/16] w-full overflow-hidden bg-zinc-950" aria-label={`播放 ${item.title}`}>
        {item.posterUrl ? (
           
          <img src={item.posterUrl} alt={item.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-end bg-gradient-to-br from-violet-950/60 via-zinc-900 to-zinc-950 p-4">
            <p className="line-clamp-3 text-left text-sm leading-relaxed text-zinc-400">{item.currentVersion?.changelog ?? item.title}</p>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20">
          <span className="flex size-12 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur transition group-hover:scale-110">
            <Play className="size-5 translate-x-0.5" aria-hidden />
          </span>
        </div>
        {durationLabel(item.durationMs) && (
          <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-zinc-200">{durationLabel(item.durationMs)}</span>
        )}
        {item.remixOf?.sourceContent && (
          <span className="absolute left-2.5 top-2.5 inline-flex max-w-[75%] items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] text-fuchsia-200 backdrop-blur">
            <GitBranch className="size-3 shrink-0" aria-hidden />
            <span className="truncate">从《{item.remixOf.sourceContent.title}》开始</span>
          </span>
        )}
      </button>

      {/* Title */}
      <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
        <h3 className="line-clamp-2 font-medium leading-snug text-zinc-100">{item.title}</h3>

        {/* Creator */}
        <div className="mt-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <div className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 text-[10px]">
              {item.owner.displayName.slice(0, 1)}
            </div>
            <span className="text-xs">{item.owner.displayName}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Heart className="size-3.5 text-rose-400/70" aria-hidden /> {item._count.interactions}
          </div>
        </div>

        {/* AI involvement + 生成模式 + Remix（评审指定结构；生成模式为诚实披露） */}
        <div className="mt-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="gap-1 border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-300">
              <Wand2 className="size-3" aria-hidden /> {COPY.aiInvolved}
            </Badge>
            <GenerationModeBadge mode={item.generationMode} />
          </div>
          <Button
            size="sm"
            disabled={busy}
            onClick={onRemix}
            className="h-9 w-full gap-1.5 bg-white/10 text-zinc-100 backdrop-blur transition hover:bg-gradient-to-r hover:from-violet-500 hover:to-fuchsia-500 hover:text-white"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <GitBranch className="size-3.5" aria-hidden />}
            {COPY.remixCta}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function SkeletonCard() {
  return (
    <Card className="overflow-hidden border-white/10 bg-zinc-900/40">
      <div className="aspect-[16/10] animate-pulse bg-zinc-800/60" />
      <CardHeader className="gap-2 pb-3 pt-3.5">
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

function SkeletonExploreCard() {
  return (
    <Card className="overflow-hidden border-white/10 bg-zinc-900/40">
      <div className="aspect-[9/16] animate-pulse bg-zinc-800/60" />
      <div className="space-y-3 p-4">
        <div className="h-5 w-3/4 animate-pulse rounded bg-zinc-800" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-800/70" />
        <div className="h-9 w-full animate-pulse rounded-lg bg-zinc-800/50" />
      </div>
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
