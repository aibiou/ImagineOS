// TTS Provider Adapter（z-ai audio.tts）
// 能力：audio.tts —— 旁白配音
// ⚠ 实测：SDK 的 tts.create 返回原始 fetch Response（非 JSON）——音频经 arrayBuffer() 获取，
//    格式由 content-type 决定（wav 默认）。音色默认 tongtong（CLI 同款默认）。
import { getZai } from '@/ai/router/zai-client'
import type { AudioTTSPayload, AudioTTSResult, AudioTTSProvider, ProviderCallContext } from '@/ai/router/types'

function mimeFromContentType(ct: string): string {
  const lower = ct.toLowerCase()
  if (lower.includes('mpeg')) return 'audio/mpeg'
  if (lower.includes('wav')) return 'audio/wav'
  if (lower.includes('ogg')) return 'audio/ogg'
  if (lower.includes('pcm')) return 'audio/L16' // 裸 PCM 由 FFmpeg 兜底处理
  return 'audio/wav'
}

export const zaiTtsProvider: AudioTTSProvider = {
  id: 'zai-tts',
  capability: 'audio.tts',
  model: 'zai-tts-tongtong',
  async execute(payload: AudioTTSPayload, _ctx: ProviderCallContext): Promise<AudioTTSResult> {
    const zai = await getZai()
    // 运行时形态：fetch Response 对象（SDK 透传）
    const response = (await zai.audio.tts.create({
      input: payload.text,
      voice: payload.voice ?? 'tongtong',
      ...(payload.speed !== undefined ? { speed: payload.speed } : {}),
      response_format: 'wav',
    })) as unknown as Response

    if (typeof response?.arrayBuffer !== 'function') {
      throw new Error('TTS 返回形态异常（非 Response）')
    }
    const contentType = response.headers?.get('content-type') ?? ''
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < 256) {
      throw new Error(`TTS 返回音频过短（${buffer.length} 字节，content-type: ${contentType}）`)
    }
    return { base64: buffer.toString('base64'), mime: mimeFromContentType(contentType) }
  },
}
