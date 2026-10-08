// /w/:id —— 作品公开分享页（底座②：发布之后的落地页）
// 服务端组件直取 core 读模型（getShareView），SEO 友好（generateMetadata）；
// 交互动作（Remix / 复制链接）下沉到 ShareActions 客户端组件。
// 访问语义见 src/core/content/share-view.ts 头注：public/unlisted 任何访客；
// private 或未发布 → 陌生人 404 态；作者预览态出「仅你可见」横幅。
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Sparkles, BadgeCheck, GitBranch, Music4, Wand2, Clock3, EyeOff } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { getSessionUser } from '@/app/api/_lib/session'
import { getShareView } from '@/core/content/share-view'
import { COPY, durationLabel, generationModeLabel, GENERATION_MODE_DESC, versionLabel } from '@/app/_language'
import ShareActions from './ShareActions'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const view = await getShareView(id, null)
    const title = view.publication?.title ?? view.content.title
    return {
      title: `${title} · ImagineOS`,
      description:
        view.publication?.description ??
        view.content.currentVersion?.changelog ??
        '一段由 AI 参与创作的视频作品——任何人都可以从这里开始自己的创作。',
    }
  } catch {
    return { title: 'ImagineOS' }
  }
}

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getSessionUser()
  let view: Awaited<ReturnType<typeof getShareView>>
  try {
    view = await getShareView(id, user?.id ?? null)
  } catch {
    // 无效链接：真实 404（对爬虫/分享预览诚实）；自定义样式见 not-found.tsx
    notFound()
  }

  const { content, publication, isPreview } = view
  const title = publication?.title ?? content.title
  const description = publication?.description ?? content.currentVersion?.changelog ?? null
  const dur = durationLabel(view.durationMs)
  const modeLabel = generationModeLabel(
    view.generationMode?.mode,
    view.generationMode?.nativeShots,
    view.generationMode?.totalShots,
  )
  const modeDesc = view.generationMode ? GENERATION_MODE_DESC[view.generationMode.mode] : undefined
  const remixAllowed = content.remixPermission === 'allow'

  return (
    <div className="dark min-h-screen flex flex-col bg-zinc-950 text-zinc-100 selection:bg-fuchsia-500/30">
      {/* 顶部导航（分享页极简版：logo 回首页 + 开始表达） */}
      <header className="border-b border-white/5 bg-zinc-950/90">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-sm font-medium text-zinc-200 transition hover:text-white">
            <Sparkles className="size-4 text-fuchsia-400/80" aria-hidden /> ImagineOS
          </Link>
          <Link
            href="/"
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-white"
          >
            开始你的表达
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {isPreview && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <EyeOff className="size-4 shrink-0" aria-hidden />
            <span>仅你可见——作品还未发布，这个链接对外人无效。发布后链接自动生效。</span>
            <Link
              href={`/create/${content.id}`}
              className="ml-auto shrink-0 rounded-lg border border-amber-400/30 px-3 py-1 text-xs transition hover:bg-amber-500/20"
            >
              去发布
            </Link>
          </div>
        )}

        <div className="grid items-start gap-8 sm:grid-cols-[minmax(0,320px)_1fr]">
          {/* 播放器：视觉内容第一（9:16 竖屏作品） */}
          <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/40">
            {view.videoUrl ? (
              <video
                controls
                playsInline
                preload="metadata"
                poster={view.posterUrl ?? undefined}
                src={view.videoUrl}
                className="aspect-[9/16] w-full object-contain"
              />
            ) : view.posterUrl ? (
              <img src={view.posterUrl} alt={title} className="aspect-[9/16] w-full object-cover" />
            ) : (
              <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-3 text-zinc-600">
                <Sparkles className="size-8" aria-hidden />
                <p className="px-6 text-center text-sm">作品画面准备中</p>
              </div>
            )}
          </div>

          {/* 作品信息 */}
          <div className="min-w-0 space-y-5">
            <div>
              <h1 className="text-xl font-semibold leading-snug text-zinc-50 sm:text-2xl">{title}</h1>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-zinc-500">
                <span className="text-zinc-400">{content.owner.displayName}</span>
                {publication && (
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="size-3.5" aria-hidden />
                    {new Date(publication.publishedAt).toLocaleDateString('zh-CN')}
                  </span>
                )}
                {content.currentVersion && <span>{versionLabel(content.currentVersion.versionNumber)}</span>}
                {dur && <span>{dur}</span>}
              </div>
            </div>

            {description && <p className="text-sm leading-relaxed text-zinc-400">{description}</p>}

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1.5 border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-300">
                <Wand2 className="size-3" aria-hidden /> {COPY.aiInvolved}
              </Badge>
              <Badge variant="outline" className="gap-1.5 border-white/10 bg-white/5 text-[11px] text-zinc-300">
                <Music4 className="size-3" aria-hidden /> AI 旁白
              </Badge>
              {modeLabel && (
                <Badge
                  variant="outline"
                  title={modeDesc ?? undefined}
                  className="border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-300"
                >
                  {modeLabel}
                </Badge>
              )}
              {publication?.visibility === 'unlisted' && (
                <Badge variant="outline" className="border-white/10 bg-white/5 text-[11px] text-zinc-400">
                  不公开列出 · 知道链接即可看
                </Badge>
              )}
            </div>

            {content.remixOf?.sourceContent && (
              <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                <GitBranch className="size-3.5 text-fuchsia-400/60" aria-hidden />
                从
                <Link
                  href={`/w/${content.remixOf.sourceContent.id}`}
                  className="text-fuchsia-300/90 underline-offset-2 hover:underline"
                >
                  《{content.remixOf.sourceContent.title}》
                </Link>
                开始创作
              </p>
            )}
            {content._count.remixSources > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                <BadgeCheck className="size-3.5 text-emerald-400/60" aria-hidden />
                已有 {content._count.remixSources} 人从这里开始创作
              </p>
            )}

            <ShareActions contentId={content.id} remixAllowed={remixAllowed} />

            <p className="text-xs leading-relaxed text-zinc-600">
              每一件作品都带着它的完整来路 · {remixAllowed ? '任何人都可以从这里开始自己的创作' : '作者未开放从此作品开始创作'}
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t border-white/5 bg-zinc-950/90">
        <div className="mx-auto flex max-w-4xl items-center justify-center gap-2 px-4 py-5 text-xs text-zinc-600 sm:px-6">
          <Sparkles className="size-3.5 text-fuchsia-400/50" aria-hidden />
          <span>ImagineOS Alpha · 每一次表达，都是一件可以生长的作品</span>
        </div>
      </footer>
    </div>
  )
}

/** 链接无效态样式见 ./not-found.tsx（真实 404 状态码） */
