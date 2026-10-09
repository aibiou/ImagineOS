// VLM 世界一致性盲评（cinema-world-consistency 收官验证）
// 三帧（跨场景：面馆厨房 / 深夜办公室 / 黎明长街）→ glm 视觉模型盲评：
//   1. 全片视觉气质一致性（lookBook：teal night + amber pools + 胶片感）
//   2. 场景/环境细节质量（locationAnchor 是否真实落画）
//   3. 人物一致性（若多帧出现同一人物）
// 用法：node scripts/m15/vlm-world-review.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import ZAI from 'z-ai-web-dev-sdk'

const FRAMES = [
  { file: 'download/ui-e2e/cinema-world-frames/shot1-mid.jpg', t: '2.5s（第1镜·面馆厨房）' },
  { file: 'download/ui-e2e/cinema-world-frames/shot2-mid.jpg', t: '10.0s（第2镜·深夜办公室）' },
  { file: 'download/ui-e2e/cinema-world-frames/last-mid.jpg', t: '38.5s（末镜·黎明长街）' },
]
const OUT = 'download/ui-e2e/cinema-world-vlm-review.json'

const zai = await ZAI.create()
const images = []
for (const f of FRAMES) {
  if (!existsSync(f.file)) throw new Error(`帧缺失：${f.file}`)
  images.push({ b64: readFileSync(f.file).toString('base64'), meta: f.t })
}

const content = images.map((im, i) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${im.b64}` } }))
content.push({
  type: 'text',
  text: `这是同一部 45 秒短片里的三帧（时间点：${images.map((im) => im.t).join('；')}）。它们来自三个不同场景。请严格盲评：
1. 色调与视觉气质一致性：三帧是否像同一部片子（统一的色彩气质/影调质感）？具体描述每帧的色调。
2. 光线逻辑：每帧的光线是否符合各自时段（深夜/午夜/黎明）？有没有互相矛盾（如深夜帧出现白昼光）？
3. 人物一致性：帧中若出现人物，外貌（年龄/体型/服装）是否可辨且不矛盾？
4. 环境细节：每帧的环境是否具体可信（道具/材质/氛围），还是空泛敷衍？
请逐项给结论（一致/不一致 + 一句话证据），最后给总评。`,
})

const res = await zai.chat.completions.createVision({
  messages: [{ role: 'user', content }],
  thinking: { type: 'disabled' },
})
const review = res?.choices?.[0]?.message?.content ?? ''
console.log('=== VLM 盲评（三帧跨场景） ===')
console.log(review)
writeFileSync(OUT, JSON.stringify({ reviewedAt: new Date().toISOString(), frames: FRAMES, review }, null, 2))
console.log('\n落盘：' + OUT)
