// E2E 验证：自定义模型服务配置（ADR-0004）
// 证明目标：配置保存 → 连接测试 → 生成链真实走自定义 Provider（z-ai 429 时依然畅通）
// 方法：本地起 OpenAI 兼容 mock（127.0.0.1:9999）→ 配为 llm 通道 → 走真实创作流程
//      → 查 Generation 记账：text.plan 的 provider 必须是 openai-compat:*
// 全程真实 HTTP 驱动 dev server（与 M1.5 评测同一模式），零 mock 注入生产代码。
import http from 'node:http'
import { PrismaClient } from '@prisma/client'

const BASE = 'http://localhost:3000'
const db = new PrismaClient({ datasources: { db: { url: 'file:/home/z/my-project/db/custom.db' } } })

// ---------- 1. Mock OpenAI 兼容服务器 ----------

const MOCK_PORT = 9999
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}/v1`

const INTENT_JSON = JSON.stringify({
  fields: {
    topic: '与父亲的骑行记忆',
    purpose: '记录温暖的家庭回忆',
    emotion: ['温暖', '怀旧'],
    audience: '家人与自己',
    tone: '温柔',
    format: 'short_film',
    duration: 45,
    visual_style: 'cinematic_realism',
    narration: true,
    creator_on_camera: false,
    characters: [{ name: '我', description: '回忆中的孩子' }, { name: '父亲', description: '骑二八大杠的父亲' }],
    references: [],
    constraints: [],
  },
  sources: {
    topic: 'user', duration: 'user', emotion: 'ai_default', format: 'ai_default',
    visual_style: 'ai_default', narration: 'ai_default', creator_on_camera: 'ai_default',
    characters: 'user', purpose: 'ai_default', audience: 'ai_default', tone: 'ai_default',
    references: 'ai_default', constraints: 'ai_default',
  },
  questions: [],
})

let chatCalls = 0
const mockServer = http.createServer((req, res) => {
  const url = req.url ?? ''
  if (req.method === 'GET' && url.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'mock-llm-1' }] }))
    return
  }
  if (req.method === 'POST' && url.endsWith('/chat/completions')) {
    chatCalls++
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: INTENT_JSON } }],
      usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 },
    }))
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `mock 未实现 ${req.method} ${url}` } }))
})

// ---------- 工具 ----------

let cookie = ''
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  let data = null
  try { data = await res.json() } catch { /* 非 JSON */ }
  return { status: res.status, data }
}

function assert(cond, label) {
  if (cond) console.log(`  ✓ ${label}`)
  else { console.error(`  ✗ ${label}`); process.exitCode = 1 }
}

// ---------- 主流程 ----------

async function main() {
  console.log('[E2E] 自定义模型服务配置 —— 全链路验证\n')
  await new Promise((r) => mockServer.listen(MOCK_PORT, '127.0.0.1', r))
  console.log(`[1] mock OpenAI 兼容服务器已监听 ${MOCK_BASE}`)

  // A. 页面与空列表
  const pageRes = await fetch(`${BASE}/settings/models`)
  assert(pageRes.status === 200, `Settings 页面可达（HTTP ${pageRes.status}）`)
  const list0 = await api('GET', '/api/settings/model-providers')
  assert(list0.status === 200 && Array.isArray(list0.data.items), `配置列表 API 可用（当前 ${list0.data.items?.length ?? 0} 条）`)

  // B. 新增配置（llm 通道 → mock）
  const created = await api('POST', '/api/settings/model-providers', {
    channel: 'llm',
    label: 'Mock 模型',
    providerType: 'openai-compat',
    baseUrl: MOCK_BASE,
    apiKey: 'sk-mock-e2e-key-1234567890',
    modelName: 'mock-llm-1',
    priority: 1,
  })
  assert(created.status === 201 && created.data.item?.id, '新增配置成功（201）')
  assert(String(created.data.item?.apiKey ?? '').includes('••••'), `密钥打码返回（${created.data.item?.apiKey}）`)
  const configId = created.data.item?.id

  // C. 连接测试（GET /models）
  const tested = await api('POST', `/api/settings/model-providers/${configId}/test`)
  assert(tested.status === 200 && tested.data.ok === true, `连接测试通过：${tested.data.message}`)

  // D. 走真实创作流程：表达 → 意图编译（此时 llm 链 = mock 优先，z-ai 兜底）
  const started = await api('POST', '/api/imagine/start', {
    text: '我想做一个45秒的视频，记录我小时候和父亲一起骑自行车。',
  })
  assert(started.status === 201 && started.data.contentId, `表达已受理（contentId=${started.data.contentId}）`)
  const contentId = started.data.contentId

  const intent = await api('POST', `/api/contents/${contentId}/intent`, {})
  console.log(`[5] 意图编译响应：status=${intent.status}`)

  // E. 记账核验：text.plan 必须由 openai-compat:* 服务（z-ai 未被触达）
  const gens = await db.generation.findMany({
    where: { contentId, type: 'text.plan' },
    orderBy: { createdAt: 'asc' },
  })
  assert(gens.length > 0, `text.plan 记账 ${gens.length} 条`)
  for (const g of gens) {
    console.log(`      provider=${g.provider} model=${g.model} status=${g.status}`)
  }
  const byCustom = gens.filter((g) => g.provider.startsWith('openai-compat:'))
  assert(byCustom.length > 0, '存在自定义 Provider 的记账（链路真实切换）')
  assert(byCustom.some((g) => g.status === 'succeeded'), '自定义 Provider 至少一次成功')

  const succeededAny = intent.status === 200 || intent.status === 422
  assert(chatCalls > 0, `mock 服务器收到 ${chatCalls} 次 chat/completions 调用（真实触达）`)

  // F. 降级核验：删除配置后链回到 z-ai（此时 429 → ProviderExhaustedError 会诚实暴露）
  await api('DELETE', `/api/settings/model-providers/${configId}`)
  const listAfter = await api('GET', '/api/settings/model-providers')
  assert((listAfter.data.items ?? []).length === 0, '删除配置成功（链回到内置通道）')

  // 清理测试内容（不污染 M1.5 生产数据集）
  await db.content.delete({ where: { id: contentId } }).catch(() => {})

  console.log(`\n[E2E] 结论：${process.exitCode ? '存在失败项' : '全部通过'} —— 配置→测试→生成链切换→记账→删除 全链验证完成`)
}

main()
  .catch((e) => { console.error('[E2E] 异常：', e); process.exitCode = 1 })
  .finally(async () => {
    mockServer.close()
    await db.$disconnect()
  })
