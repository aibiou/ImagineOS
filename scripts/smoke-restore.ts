// 冒烟测试：LLM 带退避重试 + 图像通道
import ZAI from 'z-ai-web-dev-sdk'

async function tryLLM(): Promise<boolean> {
  const zai = await ZAI.create()
  for (let i = 1; i <= 4; i++) {
    try {
      const res = await zai.chat.completions.create({
        messages: [{ role: 'user', content: '回复两个字：正常' }],
        max_tokens: 20,
      })
      console.log(`[smoke] LLM OK (attempt ${i}):`, JSON.stringify(res.choices[0]?.message?.content))
      return true
    } catch (e: any) {
      console.log(`[smoke] LLM attempt ${i} failed: ${e.message?.slice(0, 80)}`)
      await new Promise((r) => setTimeout(r, 20000 * i))
    }
  }
  return false
}

async function tryImage(): Promise<boolean> {
  try {
    const zai = await ZAI.create()
    const res = await zai.images.generations.create({
      prompt: 'a minimal solid color gradient background, soft purple to blue, no text',
      size: '768x1344',
    })
    const b64 = (res as any).data?.[0]?.base64
    console.log('[smoke] IMAGE OK:', b64 ? `base64 length ${String(b64).length}` : 'no data')
    return Boolean(b64)
  } catch (e: any) {
    console.log('[smoke] IMAGE FAIL:', e.message?.slice(0, 100))
    return false
  }
}

async function main() {
  const llm = await tryLLM()
  const img = llm ? await tryImage() : false
  console.log(`[smoke] summary: LLM=${llm} IMAGE=${img}`)
  process.exit(llm ? 0 : 1)
}

main()
