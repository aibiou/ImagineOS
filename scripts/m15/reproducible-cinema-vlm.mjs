// scripts/m15/reproducible-cinema-vlm.mjs —— 024 成片 VLM 盲评（三层证据的第三层）
// 从成片抽取首/中/末三帧 + 质量门账本 → glm 视觉模型盲评：
//   1. 全片视觉气质一致性（lookBook 是否真实落画）
//   2. 场景与人物锚点是否落画（便利店夜班场景 + 店员形象）
//   3. 帧质量（构图/光线/无水印文字/无畸形）
// 用法：node scripts/m15/reproducible-cinema-vlm.mjs（需 state 已到 rendered/done）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import ZAI from 'z-ai-web-dev-sdk'
import { loadState } from './lib.mjs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } })
const CASE_ID = 'reproducible-cinema'
const state = loadState(CASE_ID)
if (!state?.evidence?.final?.url) throw new Error('state.evidence.final 缺失（先跑 render 段）')

// 成片本地路径：Asset storageLocation
const assetId = state.evidence.final.url.split('/').pop()
const asset = await db.asset.findUnique({ where: { id: assetId } })
if (!asset) throw new Error(`成片资产不存在：${assetId}`)
const videoPath = join(process.cwd(), asset.storageLocation.replace(/^storage\//, 'storage/'))
if (!existsSync(videoPath)) throw new Error(`成片文件不存在：${videoPath}`)

// 抽三帧（首 1s / 中 / 末 -1s）
const durationSec = (state.evidence.final.durationMs ?? 30000) / 1000
const FRAMES_DIR = 'download/ui-e2e/reproducible-cinema-frames'
mkdirSync(FRAMES_DIR, { recursive: true })
const picks = [
  { f: 'first.jpg', t: 1.0, label: '首段（第 1 秒）' },
  { f: 'mid.jpg', t: durationSec / 2, label: `中段（${(durationSec / 2).toFixed(1)} 秒）` },
  { f: 'last.jpg', t: Math.max(1.5, durationSec - 1), label: `末段（${(durationSec - 1).toFixed(1)} 秒）` },
]
for (const p of picks) {
  execFileSync('ffmpeg', ['-y', '-ss', String(p.t), '-i', videoPath, '-frames:v', '1', '-q:v', '3', join(FRAMES_DIR, p.f)], { stdio: 'ignore' })
}

// 质量门账本（盲评对照：门说了什么 vs 眼睛看到什么）
const qgEvents = await db.provenance.findMany({
  where: { contentId: state.contentId, model: 'quality-gate' },
  select: { payloadJson: true },
  orderBy: { createdAt: 'asc' },
})
const gateLedger = qgEvents.map((e) => {
  try { return JSON.parse(e.payloadJson ?? '{}') } catch { return {} }
})

const zai = await ZAI.create()
const images = picks.map((p) => ({ b64: readFileSync(join(FRAMES_DIR, p.f)).toString('base64'), meta: p.label }))
const content = images.map((im) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${im.b64}` } }))
content.push({
  type: 'text',
  text: `这是同一部 ${durationSec.toFixed(0)} 秒竖屏 AI 短片里的三帧（${images.map((im) => im.meta).join('；')}）。故事：夜班便利店店员发现每晚十一点来买关东煮的老人今晚没来，她在便签上写了句话贴在保温柜上。请严格盲评：
1. 全片视觉气质：三帧是否像同一部片子（统一色调/影调/光线语言）？逐帧描述色调。
2. 场景一致性：是否始终是「深夜便利店」这一同一场景（货架/保温柜/灯光氛围）？有没有穿帮成别的场所？
3. 人物一致性：店员在多帧中出现时，外貌（年龄/发型/制服）是否可辨且不矛盾？
4. 单帧质量：有无文字水印、肢体畸形、构图崩坏？
5. 作为短剧，这三帧的叙事推进是否清晰（开端—等待/寻找—落点）？
请逐项给结论（一致/不一致 + 一句话证据），最后给总评与 1-10 分。`,
})

const res = await zai.chat.completions.createVision({
  messages: [{ role: 'user', content }],
  thinking: { type: 'disabled' },
})
const review = res?.choices?.[0]?.message?.content ?? ''

const OUT = 'download/ui-e2e/reproducible-cinema-vlm-review.json'
writeFileSync(OUT, JSON.stringify({
  reviewedAt: new Date().toISOString(),
  frames: picks.map((p) => join(FRAMES_DIR, p.f)),
  gateLedger,
  review,
}, null, 2))
console.log('=== VLM 盲评（024 成片三帧） ===')
console.log(review)
console.log(`\n质量门账本：${gateLedger.length} 条（avg score=${(gateLedger.reduce((a, g) => a + (g.score ?? 0), 0) / Math.max(1, gateLedger.length)).toFixed(1)}）`)
console.log('落盘：' + OUT)
await db.$disconnect()
