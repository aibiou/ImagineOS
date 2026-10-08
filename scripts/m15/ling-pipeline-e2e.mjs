// Ling-3.1-flash 接入管线 E2E：真实 LLM 流量轮转验证（ling-integration-016）
// 流程：start → intent(confirm) → directions → select → story → storyboard → Generation 账本 → 清场
// 验证点：text.plan 调用由 openai-compat:ant-ling 与 openai-compat:agnes-com 轮转服务（同优先级 10 轮转组）
import { PrismaClient } from '@prisma/client'

const BASE = 'http://localhost:3000'
const db = new PrismaClient()
const parse = (s) => { try { return s ? JSON.parse(s) : null } catch { return null } }

// 极简 cookie jar：首个 POST 的 Set-Cookie 之后全程带回（匿名会话，ADR-0003）
let sessionCookie = ''

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookies = res.headers.getSetCookie?.() ?? []
  for (const c of setCookies) {
    const [pair] = c.split(';')
    if (pair && !sessionCookie.includes(pair.split('=')[0])) sessionCookie += (sessionCookie ? '; ' : '') + pair
  }
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

const log = (tag, { ok, status, json }) => {
  const msg = json?.message ?? json?.error ?? ''
  console.log(`[${tag}] HTTP ${status} ${ok ? '✓' : '✗'} ${String(msg).slice(0, 120)}`)
}

let contentId = null
try {
  // 1. 一句话起点
  const start = await post('/api/imagine/start', {
    text: '深夜便利店的一碗热汤面，治愈加班到凌晨的人',
  })
  log('start', start)
  contentId = start.json.contentId
  if (!contentId) throw new Error('未拿到 contentId')
  console.log(`contentId = ${contentId}\n`)

  // 2. 意图确认（就这样，继续）
  const intent = await post(`/api/contents/${contentId}/intent`, { confirm: true })
  log('intent', intent)

  // 3. 方向生成
  const directions = await post(`/api/contents/${contentId}/directions`)
  log('directions', directions)
  const dirList = directions.json?.directions ?? directions.json?.plan?.directions ?? []
  const directionId = dirList?.[0]?.id
  console.log(`  方向数=${Array.isArray(dirList) ? dirList.length : '?'} 取第一个 id=${directionId}\n`)
  if (!directionId) throw new Error('未拿到方向 id')

  // 4. 锁定方向
  const select = await post(`/api/contents/${contentId}/directions/select`, { directionId })
  log('select', select)

  // 5. 故事
  const story = await post(`/api/contents/${contentId}/story`)
  log('story', story)

  // 6. 分镜（最后一个纯 LLM 阶段；不再跑 generate/render 以省图/视额度）
  const storyboard = await post(`/api/contents/${contentId}/storyboard`)
  log('storyboard', storyboard)
  console.log('')

  // 7. Generation 账本：LLM 调用到底谁服务的
  const gens = await db.generation.findMany({
    where: { contentId },
    orderBy: { createdAt: 'asc' },
  })
  const textCalls = gens.filter((g) => g.type === 'text.plan')
  console.log(`Generation 总行数 ${gens.length}，其中 text.plan ${textCalls.length} 次：`)
  for (const g of textCalls) {
    const input = parse(g.inputJson) ?? {}
    const output = parse(g.outputJson) ?? {}
    const err = output.error ? String(output.error).slice(0, 200) : ''
    console.log(
      `  ${g.createdAt.toISOString().slice(11, 19)} | ${g.provider.padEnd(28)} | ${g.model.padEnd(20)} | ${g.status} | ${g.latencyMs ?? '?'}ms | purpose=${input.purpose ?? g.purpose ?? '?'}${err ? `\n      ↳ error: ${err}` : ''}`,
    )
  }
  const providers = [...new Set(textCalls.map((g) => g.provider))]
  console.log(`\n参与 provider：${providers.join(' , ')}`)
  const lingCount = textCalls.filter((g) => g.provider.includes('ant-ling')).length
  console.log(`ant-ling 服务了 ${lingCount}/${textCalls.length} 次 text.plan 调用`)
  console.log(lingCount > 0 ? '\n★ 接入验证通过：Ling-3.1-flash 已在真实管线服务流量' : '\n✗ Ling 未服务任何调用，需排查')
} finally {
  // 8. 清场（账本已打印在前；级联删除会抹掉 Generation 证据，顺序=先取证后删除）
  if (contentId) {
    try {
      const res = await fetch(`${BASE}/api/contents/${contentId}`, {
        method: 'DELETE',
        headers: sessionCookie ? { Cookie: sessionCookie } : {},
      })
      console.log(`\n[cleanup] DELETE content → HTTP ${res.status}`)
    } catch (e) {
      console.log(`[cleanup] 删除失败：${e.message}（请手动清理 contentId=${contentId}）`)
    }
  }
  await db.$disconnect()
}
