// 独立 mock OpenAI 兼容服务（供浏览器 UI 验证用；端口 9998）
import http from 'node:http'
const server = http.createServer((req, res) => {
  const url = req.url ?? ''
  const auth = req.headers.authorization ?? ''
  if (req.method === 'GET' && url.endsWith('/models')) {
    if (auth !== 'Bearer sk-good-key-123456') {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [
      { id: 'mock-llm-1' }, { id: 'mock-llm-2' }, { id: 'text-embedding-3' }, { id: 'gpt-image-mock' },
    ] }))
    return
  }
  if (req.method === 'POST' && url.endsWith('/chat/completions')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK，连接正常' } }] }))
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `mock 未实现 ${req.method} ${url}` } }))
})
server.listen(9998, '127.0.0.1', () => console.log('mock provider server on :9998'))
