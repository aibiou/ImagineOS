// E2E 验证：模型列表拉取 + 模型真实验证（产品负责人 2026-10-06 需求）
// 证明目标：
//   1. POST /api/settings/model-providers/models 用 {baseUrl,apiKey} 拉到该密钥可用模型列表
//   2. 同端点用 {configId}（已存密钥）也能拉到（编辑模式不改密钥场景）
//   3. POST /api/settings/model-providers/:id/test 做真实调用验证：
//      llm → POST /chat/completions（真实对话）；并回传 modelVerified=true
//   4. 拉取端点对非法输入给 422；对坏密钥上游给 502 + 可读错误
// 方法：本地起 OpenAI 兼容 mock（127.0.0.1:9998）→ 全程真实 HTTP 驱动 dev server
import http from 'node:http'

const BASE = 'http://localhost:3000'
const MOCK_PORT = 9998
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}/v1`

// ---------- 1. Mock OpenAI 兼容服务器 ----------

let calls = { models: 0, chat: 0, speech: 0, images: 0, modelsBadKey: 0 }

const mockServer = http.createServer((req, res) => {
  const url = req.url ?? ''
  const auth = req.headers.authorization ?? ''

  if (req.method === 'GET' && url.endsWith('/models')) {
    calls.models++
    if (auth !== 'Bearer sk-good-key-123456') {
      calls.modelsBadKey++
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      data: [
        { id: 'mock-llm-1' },
        { id: 'mock-llm-2' },
        { id: 'text-embedding-3' },
        { id: 'gpt-image-mock' },
      ],
    }))
    return
  }
  if (req.method === 'POST' && url.endsWith('/chat/completions')) {
    calls.chat++
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK，连接正常' } }] }))
    return
  }
  if (req.method === 'POST' && url.endsWith('/audio/speech')) {
    calls.speech++
    res.writeHead(200, { 'content-type': 'audio/wav' })
    res.end(Buffer.alloc(4096, 1))
    return
  }
  if (req.method === 'POST' && url.endsWith('/images/generations')) {
    calls.images++
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ b64_json: 'x'.repeat(200) }] }))
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `mock 未实现 ${req.method} ${url}` } }))
})

// ---------- 2. 工具 ----------

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

let failed = 0
function assert(cond, label) {
  if (cond) console.log(`  ✓ ${label}`)
  else { failed++; console.error(`  ✗ ${label}`) }
}

// ---------- 3. 主流程 ----------

mockServer.listen(MOCK_PORT, '127.0.0.1', async () => {
  console.log(`mock openai-compat server: ${MOCK_BASE}`)
  let llmId = null
  try {
    // A. 表单拉取模式（明文 baseUrl+apiKey）
    console.log('\n[1] 拉取模型列表（baseUrl+apiKey 模式）')
    let r = await api('POST', '/api/settings/model-providers/models', { baseUrl: MOCK_BASE, apiKey: 'sk-good-key-123456' })
    assert(r.status === 200, `HTTP 200（实际 ${r.status}）`)
    assert(Array.isArray(r.data.models) && r.data.models.length === 4, `返回 4 个模型（实际 ${r.data.models?.length}）`)
    assert(r.data.models.includes('mock-llm-1') && r.data.models.includes('gpt-image-mock'), '含 mock-llm-1 与 gpt-image-mock')
    assert(calls.models >= 1, '真实发起了 GET /models')

    // B. 坏密钥 → 502 + 可读错误
    console.log('\n[2] 坏密钥 → 502 与可读错误')
    r = await api('POST', '/api/settings/model-providers/models', { baseUrl: MOCK_BASE, apiKey: 'sk-bad-key-999999' })
    assert(r.status === 502, `HTTP 502（实际 ${r.status}）`)
    assert(String(r.data.error).includes('密钥无效'), `错误信息含「密钥无效」（实际：${r.data.error}）`)

    // C. 非法输入 → 422
    console.log('\n[3] 非法输入 → 422')
    r = await api('POST', '/api/settings/model-providers/models', { baseUrl: 'ftp://bad', apiKey: 'short' })
    assert(r.status === 422, `HTTP 422（实际 ${r.status}）`)

    // D. 保存配置（从拉取到的列表中选 mock-llm-1——模拟用户选择）
    console.log('\n[4] 保存配置（模型名来自拉取列表）')
    r = await api('POST', '/api/settings/model-providers', {
      channel: 'llm', label: 'E2E 模型列表', providerType: 'openai-compat',
      baseUrl: MOCK_BASE, apiKey: 'sk-good-key-123456', modelName: 'mock-llm-1', priority: 10,
    })
    assert(r.status === 201, `HTTP 201（实际 ${r.status}）`)
    llmId = r.data.item?.id ?? null
    assert(Boolean(llmId), '拿到配置 id')

    // E. 编辑模式拉取（configId 复用已存密钥）
    console.log('\n[5] 拉取模型列表（configId 模式，复用已存密钥）')
    r = await api('POST', '/api/settings/model-providers/models', { configId: llmId })
    assert(r.status === 200 && r.data.models?.length === 4, `HTTP 200 + 4 个模型（实际 ${r.status} / ${r.data.models?.length}）`)

    // F. 测试验证：真实调用所选模型（llm → /chat/completions）
    console.log('\n[6] 测试验证（真实调用所选模型）')
    r = await api('POST', `/api/settings/model-providers/${llmId}/test`)
    assert(r.status === 200, `HTTP 200（实际 ${r.status}）`)
    assert(r.data.ok === true, '整体 ok=true')
    assert(r.data.modelVerified === true, 'modelVerified=true')
    assert(String(r.data.message).includes('验证通过'), `message 含「验证通过」（实际：${r.data.message}）`)
    assert(String(r.data.message).includes('mock-llm-1'), 'message 指明所验模型')
    assert(String(r.data.message).includes('真实对话成功'), 'message 含真实验证细节')
    assert(calls.chat >= 1, `真实发起了 POST /chat/completions（${calls.chat} 次）`)

    // G. 测试结果落库（列表回读 lastTestStatus=ok）
    console.log('\n[7] 测试结果落库')
    r = await api('GET', '/api/settings/model-providers')
    const row = (r.data.items ?? []).find((i) => i.id === llmId)
    assert(row?.lastTestStatus === 'ok', 'lastTestStatus=ok')
    assert(String(row?.lastTestMessage ?? '').includes('验证通过'), 'lastTestMessage 含验证结论')

    // H. tts 通道真实验证（音频字节数回报）
    console.log('\n[8] TTS 通道真实验证')
    r = await api('POST', '/api/settings/model-providers', {
      channel: 'tts', label: 'E2E 配音', providerType: 'openai-compat',
      baseUrl: MOCK_BASE, apiKey: 'sk-good-key-123456', modelName: 'mock-tts-1', priority: 10,
    })
    const ttsId = r.data.item?.id
    r = await api('POST', `/api/settings/model-providers/${ttsId}/test`)
    assert(r.data.modelVerified === true && String(r.data.message).includes('真实合成成功'), `TTS 真实合成验证（实际：${r.data.message}）`)
    assert(calls.speech >= 1, '真实发起了 POST /audio/speech')
    await api('DELETE', `/api/settings/model-providers/${ttsId}`)

    // I. video 通道跳过实调（mock 无 video 端点也不应报错）
    console.log('\n[9] Video 通道跳过实调')
    r = await api('POST', '/api/settings/model-providers', {
      channel: 'video', label: 'E2E 视频', providerType: 'openai-compat',
      baseUrl: MOCK_BASE, apiKey: 'sk-good-key-123456', modelName: 'mock-llm-1', priority: 10,
    })
    const videoId = r.data.item?.id
    r = await api('POST', `/api/settings/model-providers/${videoId}/test`)
    assert(r.data.modelVerified === true && String(r.data.message).includes('跳过实调'), `Video 跳过实调说明（实际：${r.data.message}）`)
    await api('DELETE', `/api/settings/model-providers/${videoId}`)

    console.log(`\n调用统计：models=${calls.models} chat=${calls.chat} speech=${calls.speech} images=${calls.images}`)
  } finally {
    if (llmId) await api('DELETE', `/api/settings/model-providers/${llmId}`)
    mockServer.close()
    if (failed === 0) { console.log('\n全部断言通过 ✓'); process.exit(0) }
    console.error(`\n${failed} 项断言失败 ✗`)
    process.exit(1)
  }
})
