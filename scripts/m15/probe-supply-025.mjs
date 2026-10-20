// 025 供给三通道轻量探测（llm / image / video 提交）——定 E2E 深度
// 用法：node scripts/m15/probe-supply-025.mjs
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const providers = await db.modelProvider.findMany()
  const models = await db.modelProviderModel.findMany({ where: { enabled: true } })
  console.log(`providers=${providers.length} models=${models.length}`)

  const agnes = providers.find((p) => (p.baseUrl || '').includes('agnes'))
  if (!agnes) { console.log('agnes provider 未配置'); return }
  const keyCol = Object.keys(agnes).find((k) => /key|token|secret/i.test(k))
  const apiKey = keyCol ? agnes[keyCol] : null
  console.log(`agnes baseUrl=${agnes.baseUrl}`)

  // LLM 通道
  const llm = models.find((m) => m.providerId === agnes.id && m.channel === 'llm')
  if (llm && apiKey) {
    try {
      const t0 = Date.now()
      const res = await fetch(`${agnes.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: llm.modelName, messages: [{ role: 'user', content: '回复「ok」两个字母即可' }], max_tokens: 8 }),
      })
      console.log(`[llm ${llm.modelName}] ${res.status} in ${Date.now() - t0}ms`)
    } catch (e) { console.log(`[llm] 网络错误 ${e.message}`) }
  }

  // 图像通道（最小 512 请求）——产物复用为视频首帧
  const img = models.find((m) => m.providerId === agnes.id && m.channel === 'image')
  let firstFrame = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  if (img && apiKey) {
    try {
      const t0 = Date.now()
      const res = await fetch(`${agnes.baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: img.modelName, prompt: 'a calm river at dawn, gentle water, soft light', size: '512x512', n: 1 }),
      })
      const code = res.status
      const body = await res.text()
      console.log(`[image ${img.modelName}] ${code} in ${Date.now() - t0}ms ${code !== 200 ? body.slice(0, 160) : '(ok)'}`)
      if (code === 200) {
        try {
          const j = JSON.parse(body)
          const entry = j?.data?.[0] ?? j?.images?.[0] ?? null
          const b64 = entry?.b64_json ?? entry?.base64 ?? null
          if (typeof b64 === 'string' && b64.length > 100) {
            firstFrame = `data:image/png;base64,${b64.replace(/^data:image\/\w+;base64,/, '')}`
          } else if (typeof entry?.url === 'string' && /^https?:\/\//.test(entry.url)) {
            const dl = await fetch(entry.url)
            const buf = Buffer.from(await dl.arrayBuffer())
            if (buf.length > 1024) firstFrame = `data:${dl.headers.get('content-type') ?? 'image/png'};base64,${buf.toString('base64')}`
          }
        } catch { /* 解析失败用 1x1 兜底 */ }
      }
    } catch (e) { console.log(`[image] 网络错误 ${e.message}`) }
  }

  // 视频通道（提交即探测，不等完成——只看配额是否放行；协议 B：POST /videos）
  const vid = models.find((m) => m.providerId === agnes.id && m.channel === 'video')
  if (vid && apiKey) {
    try {
      const t0 = Date.now()
      const res = await fetch(`${agnes.baseUrl}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: vid.modelName,
          prompt: 'a calm river at dawn, gentle flow',
          mode: 'keyframe',
          first_frame: firstFrame,
          seconds: '4',
          size: '720P',
          aspect_ratio: '9:16',
        }),
      })
      const code = res.status
      const body = await res.text()
      console.log(`[video ${vid.modelName}] ${code} in ${Date.now() - t0}ms ${code >= 400 ? body.slice(0, 200) : body.slice(0, 140)}`)
    } catch (e) { console.log(`[video] 网络错误 ${e.message}`) }
  }
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
