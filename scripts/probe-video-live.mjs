// probe-video-live.mjs —— 视频通道实时探针（2026-10-20：不引用历史，现场实测）
// 与产品管线同构：图像通道生成首帧 → keyframe 模式提交视频 → 轮询到终态 → 下载成片
// 用法: node scripts/probe-video-live.mjs [已有首帧图URL]
import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'node:fs'

const prisma = new PrismaClient()
async function req(method, url, key, body) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  })
  return { status: r.status, text: await r.text() }
}

const vid = await prisma.modelProviderModel.findFirst({
  where: { channel: 'video', enabled: true }, orderBy: { priority: 'asc' }, include: { provider: true },
})
const img = await prisma.modelProviderModel.findFirst({
  where: { channel: 'image', enabled: true }, orderBy: { priority: 'asc' }, include: { provider: true },
})
if (!vid) { console.log('无启用的视频通道'); process.exit(1) }
const vBase = vid.provider.baseUrl.replace(/\/$/, ''), vKey = vid.provider.apiKey
console.log(`视频通道: ${vid.provider.label} / ${vid.modelName} (priority=${vid.priority})`)

const t0 = Date.now()
const el = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`

// 0. 首帧图（与产品同构：分镜图 → 首帧驱动）
let frameUrl = process.argv[2] ?? ''
if (!frameUrl) {
  const r = await req('POST', `${img.provider.baseUrl.replace(/\/$/, '')}/images/generations`, img.provider.apiKey, {
    model: img.modelName,
    prompt: 'cinematic first frame: warm sunrise over a quiet village, soft golden light, film still, 16:9',
    size: '1344x768',
  })
  console.log(`首帧图: HTTP ${r.status} (${el()})`)
  if (r.status !== 200) { console.log('首帧失败:', r.text.slice(0, 300)); await prisma.$disconnect(); process.exit(1) }
  frameUrl = JSON.parse(r.text)?.data?.[0]?.url ?? ''
  if (!frameUrl) { console.log('首帧未返回 URL:', r.text.slice(0, 200)); await prisma.$disconnect(); process.exit(1) }
  console.log(`首帧就绪 (${el()})`)
}

// 1. 提交视频任务（keyframe 模式，同产品 native 路径）
const submit = await req('POST', `${vBase}/videos`, vKey, {
  model: vid.modelName,
  prompt: 'a warm sunrise over a quiet village, gentle camera push-in, cinematic, soft light',
  mode: 'keyframe',
  first_frame: frameUrl,
  seconds: '4',
  size: '720P',
  aspect_ratio: '16:9',
})
console.log(`视频提交: HTTP ${submit.status} (${el()})`)
if (submit.status !== 200) {
  console.log('提交失败响应:', submit.text.slice(0, 300))
  await prisma.$disconnect(); process.exit(1)
}
const sj = JSON.parse(submit.text)
const videoId = sj.video_id ?? sj.id ?? sj.task_id
console.log('video_id:', videoId)

// 2. 轮询（最多 5 分钟）
const origin = new URL(vBase).origin
const pollUrl = `${origin}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(vid.modelName)}`
for (let i = 1; i <= 40; i++) {
  await new Promise(r => setTimeout(r, i < 5 ? 5000 : 8000))
  const p = await req('GET', pollUrl, vKey)
  let pj = {}
  try { pj = JSON.parse(p.text) } catch {}
  const status = pj.video_state ?? pj.status ?? pj.state ?? 'unknown'
  if (status === 'succ' || status === 'success' || status === 'completed' || pj.url) {
    const url = pj.url ?? pj.video_url ?? pj.result?.[0]?.url ?? pj.data?.[0]?.url
    console.log(`\n终态: 成功 (${el()})`)
    if (url) {
      const bin = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(120_000) })).arrayBuffer())
      const out = '/home/z/my-project/download/native-video-probe.mp4'
      writeFileSync(out, bin)
      console.log(`成片已落盘: ${out} (${(bin.byteLength / 1024 / 1024).toFixed(2)}MB)`)
    }
    await prisma.$disconnect(); process.exit(0)
  }
  if (status === 'failed' || status === 'fail' || status === 'error') {
    console.log(`\n终态: 失败 (${el()})`, p.text.slice(0, 200))
    await prisma.$disconnect(); process.exit(1)
  }
  process.stdout.write(`  轮询 ${i}: ${status} (${el()})\n`)
}
console.log('超时未终态（5 分钟）')
await prisma.$disconnect()
