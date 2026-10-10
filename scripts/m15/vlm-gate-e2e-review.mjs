// Gate 7 收官 VLM 盲评：全 native 成片（深夜便利店·护士关东煮）三帧
// 维度：竖屏构图利用 / 字幕烧录 / 色调一致性（冷暖对比气质）/ 同片质感 / native 运动感
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import ZAI from 'z-ai-web-dev-sdk'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const contentId = 'cmv1up2f90003m2ve76kgxn1u'
const finalAsset = await db.asset.findFirst({ where: { contentId, kind: 'final' }, orderBy: { createdAt: 'desc' } } )
const videoPath = `storage/assets/${finalAsset.storageLocation}`
if (!existsSync(videoPath)) throw new Error('成片缺失: ' + videoPath)
console.log('成片:', videoPath)

// 三帧：首段/中段/末段（fps=1/13 → 38s 出 ~3 帧）
const dir = 'download/ui-e2e/g7-gate-frames'
mkdirSync(dir, { recursive: true })
execFileSync('ffmpeg', ['-y', '-i', videoPath, '-vf', 'fps=1/13', `${dir}/f%01d.jpg`])
const frames = ['f1.jpg', 'f2.jpg', 'f3.jpg'].map((f) => `${dir}/${f}`).filter(existsSync)
console.log('抽帧:', frames.length, '张')

const zai = await ZAI.create()
const content = frames.map((f) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${readFileSync(f).toString('base64')}` } }))
content.push({
  type: 'text',
  text: `这是同一部 38 秒竖屏短片里的三帧（深夜便利店题材：下夜班的护士吃关东煮）。请严格盲评：
1. 画幅与构图：三帧是否为竖屏（9:16）构图？纵向空间利用是否合理？
2. 字幕：帧中是否出现中文旁白字幕？位置与可读性？
3. 色调与一致性：三帧色调是否统一？是否呈现「店内暖黄光 vs 窗外冷蓝雨夜」的冷暖对撞气质？人物（护士/店员）外貌在三帧间是否一致？
4. 质感：是否像同一部片子（影调/光线/美术连贯）？画面是否有真实运动感（非静态图片的推拉摇移感）？
请逐项给结论 + 一句话证据，最后给总评。`,
})
const res = await zai.chat.completions.createVision({ messages: [{ role: 'user', content }], thinking: { type: 'disabled' } })
const review = res?.choices?.[0]?.message?.content ?? ''
console.log('=== VLM 盲评（三帧·全 native 成片） ===')
console.log(review)
writeFileSync('download/ui-e2e/g7-gate-vlm-review.json', JSON.stringify({ reviewedAt: new Date().toISOString(), frames, review }, null, 2))
console.log('\n已落盘：download/ui-e2e/g7-gate-vlm-review.json')
await db.$disconnect()
