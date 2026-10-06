// 配额/队列守望器：后台轮询 z-ai TTS 与 Agnes 视频队列，恢复即立旗
// 旗文件：scripts/m15/state/flags/zai-tts-ok、agnes-video-ok（Phase B 启动信号）
// 日志：scripts/m15/state/quota-watch.log（追加式）
// 视频探测为完整全链（提交→轮询→下载→ffprobe）——队列缓解的第一个任务即 Video 通道验证证据
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/home/z/my-project'
const STATE = join(ROOT, 'scripts/m15/state')
const FLAGS = join(STATE, 'flags')
mkdirSync(FLAGS, { recursive: true })
const LOG = join(STATE, 'quota-watch.log')

const log = (msg) => appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`)

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + ROOT + '/db/custom.db' } } })
const rows = await prisma.modelProviderConfig.findMany()
const video = rows.find(r => r.channel === 'video')
const AGNES_BASE = video.baseUrl.replace(/\/$/, '')
const AGNES_KEY = video.apiKey
const AGNES_AUTH = { Authorization: `Bearer ${AGNES_KEY}`, 'Content-Type': 'application/json' }

// 首帧：取一张真实分镜图（256-5760 边长合规）
const { readFile } = await import('node:fs/promises')
const asset = await prisma.asset.findFirst({ where: { kind: 'generated', mime: { startsWith: 'image' } }, orderBy: { createdAt: 'desc' } })
const firstFrameDataUri = `data:${asset.mime};base64,${(await readFile(join(ROOT, 'storage/assets', asset.storageLocation))).toString('base64')}`

// ---------- 探测 1：z-ai TTS ----------
async function probeZaiTts() {
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const response = await zai.audio.tts.create({ input: '好', voice: 'tongtong', response_format: 'wav' })
    const buf = Buffer.from(await response.arrayBuffer())
    if (buf.length > 256) {
      writeFileSync(join(FLAGS, 'zai-tts-ok'), JSON.stringify({ at: new Date().toISOString(), bytes: buf.length }))
      log(`✓ z-ai TTS 恢复（${buf.length} 字节）——旗已立`)
      return true
    }
    log(`z-ai TTS 返回过短（${buf.length} 字节）`)
  } catch (e) {
    const msg = String(e.message ?? e).slice(0, 80)
    log(`z-ai TTS 未恢复：${msg}`)
  }
  return false
}

// ---------- 探测 2：Agnes 视频（完整全链） ----------
async function probeAgnesVideo() {
  let videoId = null
  try {
    const res = await fetch(`${AGNES_BASE}/videos`, {
      method: 'POST', headers: AGNES_AUTH,
      body: JSON.stringify({
        model: video.modelName,
        mode: 'keyframe',
        prompt: 'Gentle natural motion: soft wind, light shifts subtly, slow camera drift. Warm cinematic tone.',
        first_frame: firstFrameDataUri,
        seconds: '4', size: '720P', aspect_ratio: '9:16',
      }),
      signal: AbortSignal.timeout(60000),
    })
    const j = await res.json().catch(() => null)
    if (res.status === 503 && /queue/i.test(j?.message ?? '')) {
      log(`agnes 视频队列仍满（503）`)
      return false
    }
    if (!res.ok) {
      log(`agnes 视频提交异常 HTTP ${res.status}：${JSON.stringify(j)?.slice(0, 120)}`)
      return false
    }
    videoId = j?.video_id ?? j?.id ?? j?.task_id
    if (!videoId) { log(`agnes 视频提交成功但无 video_id：${JSON.stringify(j)?.slice(0, 150)}`); return false }
    log(`✓ agnes 视频提交成功 video_id=${videoId}，开始轮询…`)
  } catch (e) {
    log(`agnes 视频提交异常：${String(e.message ?? e).slice(0, 80)}`)
    return false
  }

  // 轮询（3s × 100 = 5min 上限）
  const pollUrl = `${new URL(AGNES_BASE).origin}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(video.modelName)}`
  const t0 = Date.now()
  for (let i = 1; i <= 100; i++) {
    await new Promise(r => setTimeout(r, 3000))
    try {
      const st = await fetch(pollUrl, { headers: AGNES_AUTH, signal: AbortSignal.timeout(20000) })
      const sj = await st.json().catch(() => null)
      const s = (sj?.status ?? '').toUpperCase()
      if (s === 'COMPLETED') {
        const url = sj?.url
        if (typeof url !== 'string') { log(`✗ 完成但无 url：${JSON.stringify(sj)?.slice(0, 150)}`); writeFileSync(join(FLAGS, 'agnes-video-error'), JSON.stringify({ at: new Date().toISOString(), stage: 'completed-no-url' })); return true }
        const dl = await fetch(url, { signal: AbortSignal.timeout(240000) })
        const buf = Buffer.from(await dl.arrayBuffer())
        const out = join(STATE, 'agnes-native-verify.mp4')
        writeFileSync(out, buf)
        let probe = {}
        try { probe = JSON.parse((await import('node:child_process')).execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,codec_name -of json ${out}`).toString()).streams[0] } catch {}
        writeFileSync(join(FLAGS, 'agnes-video-ok'), JSON.stringify({ at: new Date().toISOString(), videoId, url, bytes: buf.length, latencySec: Math.round((Date.now() - t0) / 1000), probe }, null, 2))
        log(`✓ agnes 视频全链成功：${(buf.length / 1024 / 1024).toFixed(2)}MB，${Math.round((Date.now() - t0) / 1000)}s，${probe.width}x${probe.height} ——旗已立`)
        return true
      }
      if (s === 'FAILED') {
        writeFileSync(join(FLAGS, 'agnes-video-error'), JSON.stringify({ at: new Date().toISOString(), stage: 'generation', response: sj }, null, 2))
        log(`✗ agnes 视频生成失败：${JSON.stringify(sj)?.slice(0, 150)}`)
        return true // 已确认队列可提交，不再重复探测（失败细节已记录）
      }
    } catch (e) { /* 瞬时轮询失败继续 */ }
  }
  log(`agnes 视频轮询超时（video_id=${videoId}）`)
  writeFileSync(join(FLAGS, 'agnes-video-timeout'), JSON.stringify({ at: new Date().toISOString(), videoId }))
  return true
}

// ---------- 主循环（探测间隔 150s；旗已立则跳过对应探测） ----------
log(`守望器启动（z-ai TTS + agnes 视频队列）`)
let rounds = 0
while (true) {
  rounds++
  const ttsOk = existsSync(join(FLAGS, 'zai-tts-ok'))
  const videoOk = existsSync(join(FLAGS, 'agnes-video-ok')) || existsSync(join(FLAGS, 'agnes-video-error'))
  if (!ttsOk) await probeZaiTts()
  else { /* TTS 已恢复 */ }
  if (!videoOk) await probeAgnesVideo()
  if (ttsOk && videoOk) { log(`两项旗均已立，守望器退出（第 ${rounds} 轮）`); break }
  // 每 10 轮打印一次存活心跳
  if (rounds % 10 === 0) log(`心跳：第 ${rounds} 轮（tts=${ttsOk ? '✓' : '✗'} video=${videoOk ? '✓' : '✗'}）`)
  await new Promise(r => setTimeout(r, 150_000))
}
await prisma.$disconnect()
