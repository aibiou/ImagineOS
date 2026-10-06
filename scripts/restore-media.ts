// ImagineOS 媒体恢复脚本（沙箱重置后）
// 背景：/tmp/my-project 快照恢复了代码+数据库，但 storage/ 媒体文件丢失（208 个资产记录指向空文件）。
// 策略：AI 供应商配额冷却中（LLM/图像/TTS 全部 429），先用本地 FFmpeg+sharp 生成
//       品牌化合成占位媒体（零 API 消耗），使预览完整可导航；配额恢复后可跑真实再生替换。
// 规格：图像 720x1280 JPEG；视频 720x1280 H.264 yuv420p + 静音音轨 + 精确 durationMs；音频 6s 静音 WAV。
import { PrismaClient } from '@prisma/client'
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const db = new PrismaClient()
const STORAGE_ROOT = resolve('storage/assets')

// ImagineOS 品牌色系（暗底紫粉金）——按内容散列取色，保证卡片视觉区分度
const PALETTES: Array<[string, string, string]> = [
  ['#0f0a1e', '#5b21b6', '#c084fc'], // 深紫 → 亮紫
  ['#150a24', '#7c3aed', '#f0abfc'], // 暗夜紫 → 粉
  ['#1a0b2e', '#a21caf', '#fbbf24'], // 紫罗兰 → 金
  ['#0d1321', '#4338ca', '#818cf8'], // 靛蓝系
  ['#1c0f26', '#9d174d', '#fb7185'], // 玫红系
  ['#0e1626', '#0f766e', '#5eead4'], // 青碧系
]

function paletteFor(key: string): [string, string, string] {
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTES[h % PALETTES.length]!
}

// ---------- 图像（shot images 98 + thumbnails 14） ----------
async function makeImage(asset: { id: string; contentId: string | null; kind: string }, outPath: string) {
  const [c0, c1, c2] = paletteFor(asset.contentId ?? asset.id)
  const svg = `<svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/>
      <stop offset="0.55" stop-color="${c0}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.32" r="0.75">
      <stop offset="0" stop-color="${c2}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${c2}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="720" height="1280" fill="url(#g)"/>
  <rect width="720" height="1280" fill="url(#glow)"/>
  <g stroke="#ffffff" stroke-opacity="0.14" fill="none">
    <circle cx="360" cy="410" r="170"/>
    <circle cx="360" cy="410" r="112" stroke-opacity="0.2"/>
    <path d="M 0 760 Q 360 640 720 760 L 720 1280 L 0 1280 Z" stroke-opacity="0.18"/>
  </g>
  <g fill="#ffffff" fill-opacity="0.5">
    <circle cx="360" cy="410" r="5"/>
  </g>
</svg>`
  await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toFile(outPath)
}

// ---------- 视频（final 14：720x1280 精确时长 + 静音音轨） ----------
async function makeVideo(asset: { id: string; contentId: string | null; durationMs: number | null }, outPath: string) {
  const [c0, c1, c2] = paletteFor(asset.contentId ?? asset.id)
  const dur = Math.max(1, (asset.durationMs ?? 30000) / 1000).toFixed(3)
  const vf = `gradients=s=720x1280:speed=0.04:c0=${c0}:c1=${c1}:c2=${c2}:nb_colors=3,format=pix_fmts=yuv420p`
  await execFileP('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', vf,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', dur,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
    '-c:a', 'aac', '-b:a', '96k',
    '-shortest', '-movflags', '+faststart',
    outPath,
  ])
}

// ---------- 音频（TTS 82：静音占位） ----------
async function makeAudio(outPath: string) {
  await execFileP('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '6',
    '-c:a', 'pcm_s16le',
    outPath,
  ])
}

// ---------- 主流程 ----------
async function main() {
  await mkdir(STORAGE_ROOT, { recursive: true })
  const assets = await db.asset.findMany({ select: { id: true, contentId: true, kind: true, mime: true, storageLocation: true, durationMs: true } })
  let done = 0, skipped = 0, failed = 0
  const failures: string[] = []

  const worker = async (queue: typeof assets) => {
    for (;;) {
      const a = queue.shift()
      if (!a) return
      const outPath = join(STORAGE_ROOT, a.storageLocation)
      try {
        await (async () => {
          if (a.mime === 'image/jpeg') return makeImage(a, outPath)
          if (a.mime === 'video/mp4') return makeVideo(a, outPath)
          if (a.mime === 'audio/wav') return makeAudio(outPath)
          throw new Error(`unhandled mime: ${a.mime}`)
        })()
        done++
      } catch (e: any) {
        failed++
        failures.push(`${a.id} (${a.mime}): ${String(e.message).slice(0, 80)}`)
      }
    }
  }

  const t0 = Date.now()
  await Promise.all([worker(assets), worker(assets), worker(assets), worker(assets)])
  console.log(`[restore-media] done=${done} failed=${failed} total=${assets.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  if (failures.length) {
    console.log('[restore-media] failures:')
    for (const f of failures.slice(0, 10)) console.log('  -', f)
  }
  await db.$disconnect()
}

main().catch((e) => {
  console.error('[restore-media] FATAL:', e)
  process.exit(1)
})
