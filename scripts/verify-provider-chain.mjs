// Model Provider 配置链路全链验证（用户指令 #1）
// 证明链路：页面配置（已入库）→ DB 存储 → Provider Registry → Runtime 调用 → Generation 记账
// 方法：真实匿名用户会话驱动完整创作流（与 UI 完全同路径），LLM/图像走 agnes-com，
//       TTS 无自定义（agnes 无 TTS 模型）→ z-ai 兜底（429 预期失败，fallback 证据）
// 结束后清理测试内容，证据落盘 scripts/m15/state/chain-verification.json
import { PrismaClient } from '@prisma/client'
import { Client, waitForStatus } from './m15/lib.mjs'

const db = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } })
const CASE_ID = 'chain-verify-agnes'
const TEXT = '我想拍一段三十秒的短片，记录清晨的城市慢慢醒来：路灯熄灭、早餐铺冒起热气、第一班公交驶过。安静的、温柔的画面。'

const client = new Client(CASE_ID)
const t0 = Date.now()
const timeline = {}
const stamp = (k) => { timeline[k] = Date.now() - t0 }

console.log('=== Model Provider 链路验证（真实创作流）===\n')

// ---- 1. start（LLM：意图抽取应走 agnes-com） ----
console.log('[1] imagine/start（LLM 意图抽取）...')
const start = await client.post('/api/imagine/start', { text: TEXT })
const contentId = start.contentId
console.log(`    contentId=${contentId} title=${start.title?.slice(0, 30)}`)
stamp('start')

// ---- 2. intent ----
console.log('[2] intent 编译...')
const intent1 = await client.post(`/api/contents/${contentId}/intent`, {})
if ((intent1.questions ?? []).length > 0) {
  await client.post(`/api/contents/${contentId}/intent`, { confirm: true })
}
stamp('intent')

// ---- 3. directions + select ----
console.log('[3] directions 生成 + 选向...')
const dirs = await client.post(`/api/contents/${contentId}/directions`, {})
const chosen = (dirs.directions ?? [])[0]
await client.post(`/api/contents/${contentId}/directions/select`, { directionId: chosen.id })
stamp('directions')

// ---- 4. story ----
console.log('[4] story 编写...')
await client.post(`/api/contents/${contentId}/story`, {})
stamp('story')

// ---- 5. storyboard ----
console.log('[5] storyboard 分镜...')
const sb = await client.post(`/api/contents/${contentId}/storyboard`, {})
console.log(`    镜头数: ${sb.shots ?? '未知'}`)
stamp('storyboard')

// ---- 6. generate（图像走 agnes-com；TTS 走 z-ai 兜底） ----
console.log('[6] generate 启动（图像+TTS 生成）...')
const gen = await client.post(`/api/contents/${contentId}/generate`, {})
console.log(`    jobId=${gen.jobId}`)
stamp('generate')

// ---- 7. 等待结果（REVIEW=全链成功；Job failed=TTS 预期阻塞） ----
let outcome = 'review'
try {
  await waitForStatus(client, contentId, 'REVIEW', {
    timeoutMs: 600_000,
    intervalMs: 5000,
    onTick: async () => {
      const probe = await client.get(`/api/contents/${contentId}/creation`)
      const j = probe.job
      if (j) {
        const prog = j.progress ? `（${j.progress.current ?? '?'}/${j.progress.total ?? '?'} ${j.progress.label ?? ''}）` : ''
        console.log(`    [${((Date.now() - t0) / 1000).toFixed(0)}s] job=${j.status}${prog}`)
      }
    },
  })
  stamp('review')
} catch (e) {
  // 检查是否 Job failed（TTS 兜底 429 → ProviderExhausted）
  const probe = await client.get(`/api/contents/${contentId}/creation`)
  if (probe.job?.status === 'failed') {
    outcome = 'job-failed'
    console.log(`    Job failed（预期路径之一）：${(probe.job.error ?? '').slice(0, 160)}`)
  } else {
    outcome = 'timeout'
    console.log(`    等待超时/异常：${e.message?.slice(0, 160)}`)
  }
  stamp('failed')
}

// ---- 8. Generation 记账取证（链路核心证据） ----
console.log('\n=== Generation 记账（Runtime 调用证据）===')
const generations = await db.generation.findMany({
  where: { contentId },
  orderBy: { createdAt: 'asc' },
})
const byChannel = {}
for (const g of generations) {
  const key = `${g.type}`
  byChannel[key] = byChannel[key] ?? { ok: 0, failed: 0, providers: new Set(), models: new Set(), latencies: [] }
  if (g.status === 'succeeded') {
    byChannel[key].ok++
    byChannel[key].latencies.push(g.latencyMs ?? 0)
  } else byChannel[key].failed++
  byChannel[key].providers.add(`${g.provider}`)
  byChannel[key].models.add(`${g.model}`)
}
for (const [type, s] of Object.entries(byChannel)) {
  const lat = s.latencies.length ? `，延迟 ${Math.min(...s.latencies)}~${Math.max(...s.latencies)}ms` : ''
  console.log(`  ${type}: 成功 ${s.ok} / 失败 ${s.failed} | provider=${[...s.providers].join(' + ')} | model=${[...s.models].join(' + ')}${lat}`)
}

console.log('\n=== 链路验证矩阵 ===')
const llmRows = generations.filter(g => g.type === 'text.plan')
const imgRows = generations.filter(g => g.type === 'image.shot')
const ttsRows = generations.filter(g => g.type === 'audio.tts')
const videoRows = generations.filter(g => g.type === 'video.shot')

const matrix = {
  llm: {
    called: llmRows.length > 0,
    byCustom: llmRows.some(g => g.provider?.startsWith('openai-compat:')),
    providers: [...new Set(llmRows.map(g => g.provider))],
    models: [...new Set(llmRows.map(g => g.model))],
    ok: llmRows.filter(g => g.status === 'succeeded').length,
    failed: llmRows.filter(g => g.status !== 'succeeded').length,
  },
  image: {
    called: imgRows.length > 0,
    byCustom: imgRows.some(g => g.provider?.startsWith('openai-compat:')),
    providers: [...new Set(imgRows.map(g => g.provider))],
    models: [...new Set(imgRows.map(g => g.model))],
    ok: imgRows.filter(g => g.status === 'succeeded').length,
    failed: imgRows.filter(g => g.status !== 'succeeded').length,
  },
  tts: {
    called: ttsRows.length > 0,
    customConfigured: false, // agnes 无 TTS 模型，未配置
    providers: [...new Set(ttsRows.map(g => g.provider))],
    fallbackToZai: ttsRows.some(g => g.provider === 'zai-tts'),
    ok: ttsRows.filter(g => g.status === 'succeeded').length,
    failed: ttsRows.filter(g => g.status !== 'succeeded').length,
    sampleError: ttsRows.find(g => g.status !== 'succeeded')?.error?.slice(0, 200),
  },
  video: {
    called: videoRows.length > 0,
    note: '本验证流程为 composition 模式（native 由 Native Golden Case 验证）',
  },
}
console.log(JSON.stringify(matrix, null, 2))

// ---- 9. 证据落盘 ----
const fs = await import('node:fs')
const evidence = {
  verifiedAt: new Date().toISOString(),
  caseId: CASE_ID,
  contentId,
  outcome,
  text: TEXT,
  timelineMs: timeline,
  matrix,
  generations: generations.map(g => ({
    type: g.type, provider: g.provider, model: g.model, status: g.status,
    latencyMs: g.latencyMs, purpose: g.purpose,
    error: g.error?.slice(0, 200) ?? null,
    tokens: g.usageJson ? JSON.parse(g.usageJson) : null,
  })),
}
fs.writeFileSync('scripts/m15/state/chain-verification.json', JSON.stringify(evidence, null, 2))
console.log('\n证据已存 scripts/m15/state/chain-verification.json')

// ---- 10. 清理（删除测试内容，保留 Generation 记账为审计证据） ----
try {
  const res = await fetch('http://localhost:3000/api/contents/' + contentId, {
    method: 'DELETE',
    headers: { cookie: [...client.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ') },
  })
  console.log(`\n清理测试内容: HTTP ${res.status}`)
} catch (e) {
  console.log(`\n清理失败（保留为私有测试数据）: ${e.message}`)
}

await db.$disconnect()
console.log('\n=== 链路验证完成 ===')
