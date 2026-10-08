// zai 视频通道最小化探测（2026-10-08，产品负责人授权：验证性生成）
// 目的：回答「一句话→最终 AI 内容结果」核心链路中 native 视频层的真实可用性。
// 背景：容器灾备后 ModelProviderConfig=0 行（agnes 双站点配置随旧库丢失，密钥仅在
//   产品负责人手中），当前 video 链仅剩 zai-video（cogvideox-3）。上次 E2E 5 镜全部
//   回落合成，报告误归因为「agnes 队列满」——真实失败者是 zai-video，错误明细已随
//   级联删除不可考。本探测以最小额度（1 张本地 ffmpeg 渐变首帧 + 1 个 speed 任务）
//   实测该通道死活，并捕获确切错误串供诊断。
// 形态完全镜像 workers/pipeline-executor.ts 的生产调用：
//   zai.video.generations.create({ prompt, image_url: dataURI, quality:'speed',
//     with_audio:false, watermark_enabled:false, size:'720x1280' })
//   → zai.async.result.query(taskId) 轮询（6s 间隔，300s 上限，与 zaiVideoProvider 同参）
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const FRAME = '/tmp/zai-video-firstframe.png'
// 零 AI 成本首帧：ffmpeg 渐变图（768x1344，与生产 image 尺寸一致）
execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'gradients=s=768x1344:n=3:c0=0x16213e:c1=0x4a3f6b:c2=0x8d6e94', '-frames:v', '1', FRAME])
import { readFileSync } from 'node:fs'
const imgBuf = readFileSync(FRAME)
const dataUri = `data:image/png;base64,${imgBuf.toString('base64')}`
console.log(`[probe] 首帧就绪：${imgBuf.length} bytes（ffmpeg 本地渐变，零 AI 成本）`)

const ZAI = (await import('z-ai-web-dev-sdk')).default
const zai = await ZAI.create()

// ---- 1. 提交（镜像生产参数） ----
const PROMPT = '缓慢的镜头推进，画面中光晕轻轻流动，氛围安静（通道健康探测）'
const t0 = Date.now()
let created
try {
  created = await zai.video.generations.create({
    prompt: PROMPT,
    image_url: dataUri,
    quality: 'speed',
    with_audio: false,
    watermark_enabled: false,
    size: '720x1280',
  })
} catch (e) {
  console.log(JSON.stringify({ stage: 'submit', ok: false, error: String(e?.message ?? e).slice(0, 400) }))
  process.exit(1)
}
const taskId = created?.id
console.log(JSON.stringify({ stage: 'submit', ok: true, taskId, raw: JSON.stringify(created).slice(0, 300), latencyMs: Date.now() - t0 }))
if (!taskId) {
  console.log('[probe] 提交 200 但无 taskId —— 生产代码将抛「视频生成任务提交失败（未返回任务 id）」')
  process.exit(1)
}

// ---- 2. 轮询（6s 间隔 / 300s 上限，与 zaiVideoProvider 相同） ----
const POLL_INTERVAL_MS = 6_000
const POLL_DEADLINE_MS = 300_000
let final = null
let lastStatus = null
const transitions = []
while (Date.now() - t0 < POLL_DEADLINE_MS) {
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  let status
  try {
    status = await zai.async.result.query(taskId)
  } catch (e) {
    console.log(JSON.stringify({ stage: 'poll', ok: false, error: String(e?.message ?? e).slice(0, 400) }))
    process.exit(1)
  }
  const s = status?.task_status ?? 'UNKNOWN'
  if (s !== lastStatus) { transitions.push({ at: Math.round((Date.now() - t0) / 1000) + 's', status: s }); lastStatus = s }
  if (s === 'FAIL') {
    console.log(JSON.stringify({ stage: 'poll', ok: false, taskId, finalStatus: 'FAIL', raw: JSON.stringify(status).slice(0, 400), transitions, totalMs: Date.now() - t0 }))
    process.exit(1)
  }
  if (s === 'SUCCESS') { final = status; break }
}
if (!final) {
  console.log(JSON.stringify({ stage: 'poll', ok: false, taskId, finalStatus: 'TIMEOUT', transitions, totalMs: Date.now() - t0 }))
  process.exit(1)
}

// ---- 3. 下载校验（镜像生产：≥10KB 才算有效） ----
const url = final?.video_result?.[0]?.url ?? final?.video_url ?? final?.url
if (!url) {
  console.log(JSON.stringify({ stage: 'download', ok: false, error: '成功但无下载地址', raw: JSON.stringify(final).slice(0, 400) }))
  process.exit(1)
}
const res = await fetch(url)
const buf = Buffer.from(await res.arrayBuffer())
writeFileSync('/tmp/zai-video-probe.mp4', buf)
let ffprobeJson = null
try {
  ffprobeJson = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=width,height,codec_name', '-of', 'json', '/tmp/zai-video-probe.mp4']).toString())
} catch (e) { ffprobeJson = { error: String(e?.message ?? e).slice(0, 200) } }
console.log(JSON.stringify({
  stage: 'done', ok: res.ok && buf.length >= 10_000, taskId,
  http: res.status, bytes: buf.length, url: url.slice(0, 120),
  transitions, totalMs: Date.now() - t0,
  ffprobe: ffprobeJson?.format ? { duration: ffprobeJson.format.duration, size: ffprobeJson.format.size, streams: (ffprobeJson.streams ?? []).map((s) => `${s.codec_name} ${s.width}x${s.height}`) } : ffprobeJson,
}, null, 1))
