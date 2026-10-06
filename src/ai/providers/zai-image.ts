// 图像 Provider Adapter（z-ai images.generations）
// 能力：image.shot —— 分镜图像生成（组合式视频管线的像素来源，ADR-0001）
import { getZai } from '@/ai/router/zai-client'
import type { ImageShotPayload, ImageShotResult, ImageShotProvider, ProviderCallContext } from '@/ai/router/types'

export const zaiImageProvider: ImageShotProvider = {
  id: 'zai-image',
  capability: 'image.shot',
  model: 'zai-image-default',
  async execute(payload: ImageShotPayload, _ctx: ProviderCallContext): Promise<ImageShotResult> {
    const zai = await getZai()
    const res = await zai.images.generations.create({
      prompt: payload.prompt,
      size: payload.size,
    })
    const base64 = res?.data?.[0]?.base64
    if (typeof base64 !== 'string' || base64.length < 100) {
      throw new Error('图像生成返回为空或无效')
    }
    return { base64, mime: 'image/png' }
  },
}
