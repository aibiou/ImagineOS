// smoke-video.mjs —— 验证 z-ai 视频生成 API（图生视频）可用性：Gate 6b 前置
// 用 p04 案例已生成的一张分镜图作为首帧，走 create → 轮询 query → 下载 MP4
import ZAI from 'z-ai-web-dev-sdk'
import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'node:fs'

const db = new PrismaClient()

// 取 p04 的一张 generated 图像资产
const gen = await db.generation.findFirst({
  where: { type: 'image.shot', status: 'succeeded' },
  orderBy: { createdAt: 'desc' },
  select: { contentId: true },
})
const asset = await db.asset.findFirst({
  where: { contentId: gen?.contentId, kind: 'generated', mime: { startsWith: 'image/' } },
  orderBy: { createdAt: 'asc' },
})
console.log('首帧资产:', asset?.id, asset?.storageLocation)

const { readFile } = await import('node:fs/promises')
const { resolve } = await import('node:path')
const imgBuf = await readFile(resolve('storage/assets', asset.storageLocation))
const dataUrl = `data:${asset.mime};base64,${imgBuf.toString('base64')}`
console.log('首帧大小:', (imgBuf.length / 1024).toFixed(0), 'KB')

const zai = await ZAI.create()
const t0 = Date.now()

console.log('\n[1] 提交视频生成任务（图生视频）…')
const created = await zai.video.generations.create({
  prompt: 'The scene comes alive with subtle natural motion, cinematic, gentle camera drift',
  image_url: dataUrl,
  quality: 'speed',
  with_audio: false,
  watermark_enabled: false,
  size: '720x1280',
})
console.log('任务:', JSON.stringify(created))
const taskId = created?.id
if (!taskId) {
  console.log('❌ 未返回任务 id')
  process.exit(1)
}

console.log('\n[2] 轮询任务状态…')
let result = null
const deadline = Date.now() + 600_000 // 10 分钟上限
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 6000))
  result = await zai.async.result.query(taskId)
  process.stdout.write(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${result?.task_status}\n`)
  if (result?.task_status === 'SUCCESS' || result?.task_status === 'FAIL') break
}

console.log('\n[3] 结果：', JSON.stringify(result).slice(0, 500))
const url = result?.video_result?.[0]?.url ?? result?.video_url ?? result?.url
if (result?.task_status === 'SUCCESS' && url) {
  console.log('下载 MP4…', url)
  const res = await fetch(url)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync('scripts/m15/state/native-video-smoke.mp4', buf)
  console.log(`✓ 已保存 scripts/m15/state/native-video-smoke.mp4（${(buf.length / 1024 / 1024).toFixed(2)} MB，总耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s）`)
} else {
  console.log('✗ 任务未成功')
}
await db.$disconnect()
