// 分通道冒烟：图像 / TTS（媒体再生可行性检查）
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

async function tryImage(): Promise<boolean> {
  try {
    const zai = await ZAI.create()
    const res = await zai.images.generations.create({
      prompt: 'soft watercolor gradient, dreamy pastel tones, abstract',
      size: '512x512',
    })
    const b64 = (res as any).data?.[0]?.base64
    console.log('[smoke] IMAGE OK:', b64 ? `base64 len ${String(b64).length}` : 'empty')
    return Boolean(b64)
  } catch (e: any) {
    console.log('[smoke] IMAGE FAIL:', String(e.message).slice(0, 90))
    return false
  }
}

async function tryTTS(): Promise<boolean> {
  try {
    const zai = await ZAI.create()
    const res = await zai.audio.tts.create({
      input: '你好，这是一段恢复测试。',
      voice: 'tongtong',
    })
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync('/tmp/smoke-tts.mp3', buf)
    console.log('[smoke] TTS OK:', `${buf.length} bytes -> /tmp/smoke-tts.mp3`)
    return buf.length > 1000
  } catch (e: any) {
    console.log('[smoke] TTS FAIL:', String(e.message).slice(0, 90))
    return false
  }
}

async function main() {
  const img = await tryImage()
  const tts = await tryTTS()
  console.log(`[smoke] channels: IMAGE=${img} TTS=${tts}`)
}

main()
