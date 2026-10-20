// vision.review 供给探测：模拟质量门 in-loop 真实调用形态（待审图 → 结构化 verdict 文本）
// 验证 zai-vision 通道可用性（SDK createVision），供 E2E 前置体检用。
// 用法：node scripts/m15/probe-vision-review.mjs
import ZAI from 'z-ai-web-dev-sdk'
import { execFileSync } from 'node:child_process'

// 生成一张 512x512 测试图（纯色渐变，无隐私无消耗争议）
const tmpPng = '/tmp/vision-probe.png'
execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'gradients=size=512x512:duration=1', '-frames:v', '1', tmpPng])
const b64 = execFileSync('base64', ['-w0', tmpPng]).toString().trim()

const zai = await ZAI.create()
const t0 = Date.now()
const content = [
  { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
  {
    type: 'text',
    text: `你是镜头质检员。对这张测试图严格盲评并只输出 JSON：
{"looksCinematic":true/false,"overallScore":0-10,"watermarkSuspected":true/false,"issues":["..."]}
评价维度：画面质感、构图。`,
  },
]
try {
  const res = await zai.chat.completions.createVision({
    messages: [{ role: 'user', content }],
    thinking: { type: 'disabled' },
  })
  const text = res?.choices?.[0]?.message?.content ?? ''
  const ms = Date.now() - t0
  console.log(`✅ vision.review 通道可用（${ms}ms，返回 ${text.length} 字符）`)
  console.log('--- 返回文本（前 300 字符）---')
  console.log(text.slice(0, 300))
  const m = text.match(/\{[\s\S]*\}/)
  if (m) {
    const verdict = JSON.parse(m[0])
    console.log('\n✅ verdict JSON 解析成功：', JSON.stringify(verdict).slice(0, 200))
  } else {
    console.log('\n⚠️ 未匹配到 JSON 对象（质量门解析层有兜底，但需关注）')
  }
} catch (e) {
  console.error(`❌ vision.review 不可用：${e instanceof Error ? e.message : e}`)
  process.exit(1)
}
