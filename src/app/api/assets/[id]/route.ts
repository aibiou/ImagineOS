// GET /api/assets/:id —— 资产伺服（图像/音频/视频字节流）
// 可见性经 core 服务判定：作品 public/unlisted → 任何人；private → 仅作者
import { getSessionUser, domainErrorToResponse } from '../../_lib/session'
import { assetService } from '@/core/assets/asset-service'

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getSessionUser()
    const visibility = await assetService.checkVisibility(id, user?.id ?? null)
    if (visibility !== 'public') {
      // 不可见与不存在同语义（防枚举探测）
      return Response.json({ error: 'not_found', message: '资源不存在' }, { status: 404 })
    }
    const asset = await assetService.getById(id)
    if (!asset) {
      return Response.json({ error: 'not_found', message: '资源不存在' }, { status: 404 })
    }

    const bytes = await assetService.readBytes(asset.storageLocation)
    const ext = MIME_EXTENSIONS[asset.mime] ?? 'bin'
    const filename = `imagineos-${asset.id}.${ext}`
    const download = new URL(req.url).searchParams.get('download') === '1'

    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': asset.mime,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Accept-Ranges': 'bytes',
        ...(download ? { 'Content-Disposition': `attachment; filename="${filename}"` } : {}),
      },
    })
  } catch (e) {
    return domainErrorToResponse(e)
  }
}
