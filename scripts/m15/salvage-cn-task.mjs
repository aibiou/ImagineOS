// 抢救 agnes-cn 在途任务：守望器被外部 SIGKILL 后，服务端任务仍在跑——直接轮询收割，零额外额度消耗
// 任务：task_iREj7mAnJdTv2oAB9lrsg8i1KRk2fIBp（2026-10-07 12:11:27 提交，keyframe + data URI 首帧）
// 产物：flags/agnes-video-ok--agnes-cn（dataUriAccepted 判定）或 flags/agnes-video-error--agnes-cn
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/home/z/my-project'
const STATE = join(ROOT, 'scripts/m15/state')
const FLAGS = join(STATE, 'flags')
mkdirSync(FLAGS, { recursive: true })
const log = (msg) => appendFileSync(join(STATE, 'quota-watch.log'), `[${new Date().toISOString()}][salvage] ${msg}\n`)

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + ROOT + '/db/custom.db' } } })
const row = await prisma.modelProviderConfig.findFirst({ where: { channel: 'video', baseUrl: { contains: 'agnes-ai.cn' } } })
if (!row) { console.log('未找到 agnes-cn video 配置'); process.exit(1) }

const VIDEO_ID = 'task_iREj7mAnJdTv2oAB9lrsg8i1KRk2fIBp'
const BASE = row.baseUrl.replace(/\/$/, '')
const AUTH = { Authorization: `Bearer ${row.apiKey}` }
const pollUrl = `${new URL(BASE).origin}/agnesapi?video_id=${encodeURIComponent(VIDEO_ID)}&model_name=${encodeURIComponent(row.modelName)}`

const t0 = Date.now()
for (let i = 1; i <= 100; i++) {
  try {
    const st = await fetch(pollUrl, { headers: AUTH, signal: AbortSignal.timeout(20000) })
    const sj = await st.json().catch(() => null)
    const s = (sj?.status ?? '').toUpperCase()
    console.log(`poll ${i}: ${s} progress=${sj?.progress ?? '?'} internal=${sj?.internal_status ?? '?'}`)
    if (s === 'COMPLETED' || s === 'SUCCEEDED' || s === 'SUCCESS') {
      const url = sj?.url
      if (typeof url !== 'string') {
        writeFileSync(join(FLAGS, 'agnes-video-error--agnes-cn'), JSON.stringify({ at: new Date().toISOString(), provider: row.label, stage: 'completed-no-url', response: sj }, null, 2))
        log('✗ cn 任务完成但无 url——error 旗已立'); console.log('completed-no-url'); break
      }
      const dl = await fetch(url, { signal: AbortSignal.timeout(240000) })
      const buf = Buffer.from(await dl.arrayBuffer())
      const out = join(STATE, `agnes-native-verify-${row.label}.mp4`)
      writeFileSync(out, buf)
      let probe = {}
      try { probe = JSON.parse((await import('node:child_process')).execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,codec_name -of json ${out}`).toString()).streams[0] } catch {}
      writeFileSync(join(FLAGS, 'agnes-video-ok--agnes-cn'), JSON.stringify({
        at: new Date().toISOString(), provider: row.label, baseUrl: row.baseUrl, videoId: VIDEO_ID, url,
        bytes: buf.length, latencySec: Math.round((Date.now() - t0) / 1000), probe,
        dataUriAccepted: true, note: 'keyframe+data URI 首帧 cn 站推理层验证通过（守望器被杀后任务抢救收割）',
      }, null, 2))
      log(`✓ cn 任务抢救成功：${(buf.length / 1024 / 1024).toFixed(2)}MB，${probe.width}x${probe.height}，data URI cn 站验证通过——旗已立`)
      console.log(`SALVAGED: ${out} (${buf.length} bytes) ${JSON.stringify(probe)}`)
      break
    }
    if (s === 'FAILED' || s === 'ERROR' || s === 'CANCELED') {
      writeFileSync(join(FLAGS, 'agnes-video-error--agnes-cn'), JSON.stringify({ at: new Date().toISOString(), provider: row.label, stage: 'generation', dataUriAccepted: false, response: sj }, null, 2))
      log(`✗ cn 任务生成失败（data URI 可能被拒的证据）：${JSON.stringify(sj)?.slice(0, 150)}`)
      console.log('GENERATION_FAILED:', JSON.stringify(sj).slice(0, 300)); break
    }
  } catch (e) { console.log(`poll ${i} 瞬时失败：${String(e.message ?? e).slice(0, 60)}`) }
  await new Promise(r => setTimeout(r, 5000))
}
await prisma.$disconnect()
