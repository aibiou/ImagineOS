// z-ai SDK 三能力冒烟 + FFmpeg 环境验证（M1 种子前置检查）
import ZAI from 'z-ai-web-dev-sdk'
import { spawn } from 'node:child_process'

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, args)
    let out = ''
    c.stdout.on('data', (d) => (out += d))
    c.stderr.on('data', (d) => (out += d))
    c.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(out.slice(-500)))))
  })
}

async function main() {
  console.log('== 1. FFmpeg ==')
  console.log((await run('ffmpeg', ['-version'])).split('\n')[0])
  console.log((await run('ffprobe', ['-version'])).split('\n')[0])

  console.log('\n== 2. z-ai SDK 初始化 ==')
  const zai = await ZAI.create()
  console.log('SDK 初始化 OK')

  console.log('\n== 3. LLM chat（结构化小测试）==')
  const t0 = Date.now()
  const chat = (await zai.chat.completions.create({
    messages: [
      { role: 'system', content: '只输出 JSON，如 {"ok": true, "n": <数字>}' },
      { role: 'user', content: '输出一个包含字段 ok=true 和 n=42 的 JSON' },
    ],
    thinking: { type: 'disabled' },
  })) as { choices?: Array<{ message?: { content?: unknown } }> }
  const content = chat?.choices?.[0]?.message?.content
  console.log(`LLM 返回（${Date.now() - t0}ms）:`, typeof content === 'string' ? content.slice(0, 120) : String(content).slice(0, 200))

  console.log('\n== 4. 图像生成（768x1344 竖屏小测）==')
  const t1 = Date.now()
  const img = await zai.images.generations.create({
    prompt: 'A quiet old alley at dusk in a small Chinese town, warm golden backlight, a father and a child with an old bicycle, cinematic film still, gentle nostalgic tone, no text',
    size: '768x1344',
  })
  const b64 = img?.data?.[0]?.base64
  console.log(`图像返回（${Date.now() - t1}ms）: base64 长度 ${b64?.length ?? 0}`)
  if (b64) {
    const buf = Buffer.from(b64, 'base64')
    console.log(`解码后字节: ${buf.length}，魔数: ${buf.subarray(0, 8).toString('hex')}`)
    const { writeFile } = await import('node:fs/promises')
    await writeFile('/home/z/my-project/storage-smoke-image.bin', buf)
  }

  console.log('\n== 5. TTS ==')
  const t2 = Date.now()
  const tts = await zai.audio.tts.create({
    input: '那年夏天，父亲的手一直没离开过后座。',
  })
  const ttsStr = typeof tts === 'string' ? tts : JSON.stringify(tts)?.slice(0, 200)
  console.log(`TTS 返回形态（${Date.now() - t2}ms）: ${ttsStr?.slice(0, 150)}`)
  // 提取 base64 探测
  let ttsB64: string | null = null
  if (typeof tts === 'string' && tts.length > 1000) ttsB64 = tts
  else if (tts && typeof tts === 'object') {
    const o = tts as Record<string, unknown>
    const d = o.data
    if (Array.isArray(d) && d.length > 0 && typeof (d[0] as Record<string, unknown>).base64 === 'string') {
      ttsB64 = (d[0] as Record<string, unknown>).base64 as string
    } else {
      for (const k of ['audio', 'base64', 'content']) {
        if (typeof o[k] === 'string' && (o[k] as string).length > 1000) {
          ttsB64 = o[k] as string
          break
        }
      }
    }
  }
  if (ttsB64) {
    const buf = Buffer.from(ttsB64, 'base64')
    console.log(`TTS 解码字节: ${buf.length}，魔数: ${buf.subarray(0, 8).toString('hex')}`)
    const { writeFile } = await import('node:fs/promises')
    await writeFile('/home/z/my-project/storage-smoke-tts.bin', buf)
  }

  console.log('\n== 6. ffprobe 冒烟产物 ==')
  try {
    console.log((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', '/home/z/my-project/storage-smoke-tts.bin'])).slice(0, 200))
  } catch (e) {
    console.log('ffprobe 失败（可能非音频容器）:', (e as Error).message.slice(0, 200))
  }

  console.log('\n冒烟完成 ✓')
}

main().catch((e) => {
  console.error('冒烟失败:', e)
  process.exit(1)
})
