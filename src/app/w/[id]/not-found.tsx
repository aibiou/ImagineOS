// /w/:id 链接无效态（真实 404 状态码 + 平台风格）
// 语义：与「不存在」同义——不泄露作品是否存在（防枚举探测）
import Link from 'next/link'
import { Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="dark flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center text-zinc-100">
      <div className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
        <Sparkles className="size-7 text-zinc-500" aria-hidden />
      </div>
      <h1 className="text-lg font-medium text-zinc-200">这个链接还没有作品</h1>
      <p className="max-w-sm text-sm leading-relaxed text-zinc-500">
        链接可能已失效，或者作品还没有发布。如果你想看一件正在生长的作品，去探索区逛逛。
      </p>
      <Link href="/">
        <Button className="gap-2 rounded-xl bg-gradient-to-r from-violet-500/90 to-fuchsia-500/90 text-white hover:opacity-90">
          去逛逛
        </Button>
      </Link>
    </div>
  )
}
