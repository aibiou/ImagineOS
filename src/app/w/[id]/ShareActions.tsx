'use client'

// /w/:id 的交互动作：从这里开始创作（Remix）+ 复制分享链接
// Remix：POST /api/contents/:id/remix（匿名访客自动建立会话，ADR-0003）→ 跳转创作空间
import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, GitBranch, Link2, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { COPY } from '@/app/_language'

export default function ShareActions({ contentId, remixAllowed }: { contentId: string; remixAllowed: boolean }) {
  const router = useRouter()
  const [remixing, setRemixing] = useState(false)
  const [copied, setCopied] = useState(false)

  const remix = useCallback(async () => {
    setRemixing(true)
    try {
      const res = await fetch(`/api/contents/${contentId}/remix`, { method: 'POST' })
      const json = (await res.json().catch(() => ({}))) as { contentId?: string; message?: string }
      if (!res.ok || !json.contentId) {
        // 失败留在分享页（保持当前体验，不打断浏览）
        setRemixing(false)
        return
      }
      router.push(`/create/${json.contentId}`)
    } catch {
      setRemixing(false)
    }
  }, [contentId, router])

  const copyLink = useCallback(async () => {
    const url = `${window.location.origin}/w/${contentId}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // 剪贴板不可用（非安全上下文等）：退化为地址栏选中提示
      window.prompt('复制这个链接，发给想看的人：', url)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [contentId])

  return (
    <div className="flex flex-wrap items-center gap-3">
      {remixAllowed ? (
        <Button
          onClick={() => void remix()}
          disabled={remixing}
          className="gap-2 rounded-xl bg-gradient-to-r from-violet-500/90 to-fuchsia-500/90 px-6 text-white shadow-lg shadow-fuchsia-500/20 transition hover:opacity-90"
        >
          {remixing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <GitBranch className="size-4" aria-hidden />
          )}
          {remixing ? '正在为你创建…' : COPY.remixCta}
          {!remixing && <ArrowRight className="size-4" aria-hidden />}
        </Button>
      ) : (
        <span className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-500">
          作者未开放从此作品开始创作
        </span>
      )}
      <Button
        variant="outline"
        onClick={() => void copyLink()}
        className="gap-2 rounded-xl border-white/15 bg-transparent text-zinc-300 hover:border-fuchsia-400/40 hover:text-white"
      >
        {copied ? <Check className="size-4 text-emerald-400" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
        {copied ? '已复制' : '复制链接'}
      </Button>
    </div>
  )
}
