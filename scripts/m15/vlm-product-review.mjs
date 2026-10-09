// VLM 多画幅+修订盲评（cinema-product-021 收官验证）
// 三帧（16:9 横屏成片）→ glm 视觉模型盲评：
//   1. 画幅：是否为宽幅横向构图（16:9），画面利用是否合理
//   2. 字幕烧录：中文旁白字幕是否可见且位置合理
//   3. 色调：是否统一暖琥珀调（修订后 lookBook：warm amber 金色调）——修订真实落画的最终证据
// 用法：node scripts/m15/vlm-product-review.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import ZAI from 'z-ai-web-dev-sdk'

const FRAMES = [
  { file: 'download/ui-e2e/cinema-product-frames/wide-shot1.jpg', t: '6.4s（第1镜）' },
  { file: 'download/ui-e2e/cinema-product-frames/wide-shot2.jpg', t: '21.3s（中段）' },
  { file: 'download/ui-e2e/cinema-product-frames/wide-shot3.jpg', t: '36.2s（末段）' },
]
const OUT = 'download/ui-e2e/cinema-product-vlm-review.json'

const zai = await ZAI.create()
const images = []
for (const f of FRAMES) {
  if (!existsSync(f.file)) throw new Error(`帧缺失：${f.file}`)
  images.push({ b64: readFileSync(f.file).toString('base64'), meta: f.t })
}

const content = images.map((im) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${im.b64}` } }))
content.push({
  type: 'text',
  text: `这是同一部 43 秒短片里的三帧（时间点：${images.map((im) => im.t).join('；')}）。请严格盲评：
1. 画幅与构图：三帧是否为宽幅横向（约 16:9）构图？横向空间利用是否合理（不是竖幅裁切感）？
2. 字幕：帧中是否出现中文旁白字幕？位置与可读性如何？
3. 色调一致性：三帧色调是否统一？具体描述（冷/暖、主色、是否呈现「暖琥珀灯光 vs 冷蓝夜色」的对比气质）。
4. 画面气质：是否像同一部片子（影调质感/光线风格连贯）？
请逐项给结论 + 一句话证据，最后给总评。`,
})

const res = await zai.chat.completions.createVision({
  messages: [{ role: 'user', content }],
  thinking: { type: 'disabled' },
})
const review = res?.choices?.[0]?.message?.content ?? ''
console.log('=== VLM 盲评（三帧·16:9 横屏成片） ===')
console.log(review)
writeFileSync(OUT, JSON.stringify({ reviewedAt: new Date().toISOString(), frames: FRAMES.map((f) => f.file), review }, null, 2))
console.log(`\n已落盘：${OUT}`)
