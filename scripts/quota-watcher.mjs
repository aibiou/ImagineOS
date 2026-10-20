// 配额/队列守望器 v2：双 provider（agnes-cn + agnes-com）逐站点全链探测
// 零成本原理：503 队列满不建任务不计费（官方 Flash 校验口径）——失败探测零额度消耗；
// 窗口打开的首次成功提交即该站点 native 样本（data URI 首帧推理层验证证据）。
// 旗：flags/agnes-video-ok--<label>（分站点，JSON 含 dataUriAccepted 判定）
//     flags/agnes-video-error--<label>（生成失败/超时，终态不再重探——防重复消耗每日秒数）
// 迁移：2026-10-06 20:14 旧守望器在 agnes-com 全链成功（278s / 704x1280 / data URI 首帧）→
//       启动时自动迁为 com 旗，不重复消耗额度；此后守望焦点 = agnes-cn 窗口。
// 退出：全部 video 站点旗（ok 或 error）立齐 → 提示可重启 native 模式跑 Golden Case。
// 日志：scripts/m15/state/quota-watch.log（追加式）
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
const videoRows = (await prisma.modelProviderConfig.findMany({ where: { channel: 'video', enabled: true } }))
  .sort((a, b) => a.priority - b.priority)

// 首帧：取一张真实分镜图（与生产 router 路径同形态 = data URI）
const { readFile: rf } = await import('node:fs/promises')
const asset = await prisma.asset.findFirst({ where: { kind: 'generated', mime: { startsWith: 'image' } }, orderBy: { createdAt: 'desc' } })
const firstFrameDataUri = `data:${asset.mime};base64,${(await rf(join(ROOT, 'storage/assets', asset.storageLocation))).toString('base64')}`

const flagOk = (label) => join(FLAGS, `agnes-video-ok--${label}`)
const flagErr = (label) => join(FLAGS, `agnes-video-error--${label}`)

// ---------- 迁移：旧单 provider 旗 → com 分站旗 ----------
const legacyOk = join(FLAGS, 'agnes-video-ok')
if (existsSync(legacyOk)) {
  const comRow = videoRows.find((r) => /agnes-ai\.com|apihub/.test(r.baseUrl))
  if (comRow && !existsSync(flagOk(comRow.label))) {
    const legacy = JSON.parse((await rf(legacyOk)).toString())
    writeFileSync(flagOk(comRow.label), JSON.stringify({ ...legacy, provider: comRow.label, baseUrl: comRow.baseUrl, dataUriAccepted: true, migratedFrom: 'legacy agnes-video-ok (2026-10-06 全链成功，data URI 首帧)' }, null, 2))
    log(`迁移：旧 agnes-video-ok → ${flagOk(comRow.label).split('/').pop()}（com 站已验证，不重复消耗额度）`)
  }
}

// ---------- z-ai TTS（一次性旗，沿用旧语义） ----------
if (!existsSync(join(FLAGS, 'zai-tts-ok'))) {
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const response = await zai.audio.tts.create({ input: '好', voice: 'tongtong', response_format: 'wav' })
    const buf = Buffer.from(await response.arrayBuffer())
    if (buf.length > 256) {
      writeFileSync(join(FLAGS, 'zai-tts-ok'), JSON.stringify({ at: new Date().toISOString(), bytes: buf.length }))
      log('✓ z-ai TTS 恢复——旗已立')
    }
  } catch (e) { log(`z-ai TTS 未恢复：${String(e.message ?? e).slice(0, 80)}`) }
}

// ---------- Agnes 视频逐站点全链探测 ----------
async function probeAgnesVideo(row) {
  const BASE = row.baseUrl.replace(/\/$/, '')
  const AUTH = { Authorization: `Bearer ${row.apiKey}`, 'Content-Type': 'application/json' }
  let videoId = null
  try {
    const res = await fetch(`${BASE}/videos`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({
        model: row.modelName,
        mode: 'keyframe',
        prompt: 'Gentle natural motion: soft wind, light shifts subtly, slow camera drift. Warm cinematic tone.',
        first_frame: firstFrameDataUri,
        seconds: '4', size: '720P', aspect_ratio: '9:16',
      }),
      signal: AbortSignal.timeout(60000),
    })
    const j = await res.json().catch(() => null)
    if (res.status === 503 && /queue|队列/i.test(j?.message ?? j?.code ?? '')) {
      log(`[${row.label}] 队列仍满（503）`)
      return false
    }
    if (!res.ok) {
      log(`[${row.label}] 提交异常 HTTP ${res.status}：${JSON.stringify(j)?.slice(0, 120)}`)
      return false
    }
    videoId = j?.video_id ?? j?.id ?? j?.task_id
    if (!videoId) { log(`[${row.label}] 提交成功但无 video_id：${JSON.stringify(j)?.slice(0, 150)}`); return false }
    log(`✓ [${row.label}] 提交成功 video_id=${videoId}（队列窗口打开，本任务即 native 样本），开始轮询…`)
  } catch (e) {
    log(`[${row.label}] 提交异常：${String(e.message ?? e).slice(0, 80)}`)
    return false
  }

  // 轮询（3s × 100 = 5min 上限；keyframe 模式必须带 model_name——官方口径）
  const pollUrl = `${new URL(BASE).origin}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(row.modelName)}`
  const t0 = Date.now()
  for (let i = 1; i <= 100; i++) {
    await new Promise(r => setTimeout(r, 3000))
    try {
      const st = await fetch(pollUrl, { headers: AUTH, signal: AbortSignal.timeout(20000) })
      const sj = await st.json().catch(() => null)
      const s = (sj?.status ?? '').toUpperCase()
      if (s === 'COMPLETED' || s === 'SUCCEEDED' || s === 'SUCCESS') {
        const url = sj?.url
        if (typeof url !== 'string') {
          writeFileSync(flagErr(row.label), JSON.stringify({ at: new Date().toISOString(), stage: 'completed-no-url', response: sj }, null, 2))
          log(`✗ [${row.label}] 完成但无 url`); return true
        }
        const dl = await fetch(url, { signal: AbortSignal.timeout(240000) }) // 预签名 URL 不带鉴权头
        const buf = Buffer.from(await dl.arrayBuffer())
        const out = join(STATE, `agnes-native-verify-${row.label}.mp4`)
        writeFileSync(out, buf)
        let probe = {}
        try { probe = JSON.parse((await import('node:child_process')).execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,codec_name -of json ${out}`).toString()).streams[0] } catch {}
        writeFileSync(flagOk(row.label), JSON.stringify({
          at: new Date().toISOString(), provider: row.label, baseUrl: row.baseUrl,
          videoId, url, bytes: buf.length, latencySec: Math.round((Date.now() - t0) / 1000),
          probe, dataUriAccepted: true, // keyframe+data URI 首帧推理层接受度：本站点验证通过
        }, null, 2))
        log(`✓ [${row.label}] 全链成功：${(buf.length / 1024 / 1024).toFixed(2)}MB，${Math.round((Date.now() - t0) / 1000)}s，${probe.width}x${probe.height}，data URI 首帧推理层验证通过——旗已立`)
        return true
      }
      if (s === 'FAILED' || s === 'ERROR' || s === 'CANCELED') {
        writeFileSync(flagErr(row.label), JSON.stringify({ at: new Date().toISOString(), provider: row.label, baseUrl: row.baseUrl, stage: 'generation', dataUriAccepted: false, response: sj }, null, 2))
        log(`✗ [${row.label}] 生成失败（含 data URI 可能被拒的证据）：${JSON.stringify(sj)?.slice(0, 150)}`)
        return true
      }
    } catch (e) { /* 瞬时轮询失败继续 */ }
  }
  log(`[${row.label}] 轮询超时（video_id=${videoId}）——按终态处理不再重探（防重复消耗每日秒数）`)
  writeFileSync(flagErr(row.label), JSON.stringify({ at: new Date().toISOString(), provider: row.label, stage: 'poll-timeout', videoId }, null, 2))
  return true
}

// ---------- 主循环（150s/轮；视频 RPM 1 远未触及；503 失败零额度消耗） ----------
log(`守望器 v2 启动（双 provider：${videoRows.map((r) => r.label).join(' + ')}；首帧 ${asset.storageLocation}）`)
let rounds = 0
while (true) {
  rounds++
  const pending = videoRows.filter((r) => !existsSync(flagOk(r.label)) && !existsSync(flagErr(r.label)))
  for (const row of pending) await probeAgnesVideo(row)
  const standing = videoRows.filter((r) => existsSync(flagOk(r.label)) || existsSync(flagErr(r.label)))
  if (standing.length === videoRows.length) {
    log(`全部站点旗已立（${videoRows.map((r) => `${r.label}:${existsSync(flagOk(r.label)) ? '✓ok' : '✗err'}`).join(' ')}），第 ${rounds} 轮退出`)
    log(`下一步：bash scripts/m15/restart-dev.sh native && node scripts/m15/run-native-golden.mjs（全镜 Golden Case，需队列窗口仍开着）`)
    break
  }
  if (rounds % 10 === 0) log(`心跳：第 ${rounds} 轮（${standing.length}/${videoRows.length} 站点已立旗）`)
  await new Promise(r => setTimeout(r, 150_000))
}
await prisma.$disconnect()
