// TTS Adapter 冒烟（走我们的 Provider）
import { zaiTtsProvider } from '../src/ai/providers/zai-tts'
import { writeFile } from 'node:fs/promises'

async function main() {
  const t0 = Date.now()
  const result = await zaiTtsProvider.execute(
    { text: '那年夏天，父亲的手一直没离开过后座。' },
    { contentId: 'smoke', purpose: 'smoke.tts' },
  )
  console.log(`TTS Provider 成功（${Date.now() - t0}ms）mime=${result.mime} base64长度=${result.base64.length}`)
  const buf = Buffer.from(result.base64, 'base64')
  console.log(`解码字节=${buf.length} 魔数=${buf.subarray(0, 12).toString('hex')}`)
  await writeFile('storage-smoke-tts.bin', buf)
}
main().catch((e) => { console.error('失败:', e.message); process.exit(1) })
