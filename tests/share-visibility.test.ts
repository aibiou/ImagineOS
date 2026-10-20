// 分享页访问语义（底座②：/w/:id 公开落地页背后的读模型 getShareView）
// 本文件锁定的语义（与 getOwnedOrVisibleContent 同源 + 发布态防御闸）：
//   1. 已发布 public → 任何匿名访客可见，发布信息（Publication）随行
//   2. 已发布 unlisted → 知道链接即可看（不进探索列表，但分享页直达）
//   3. private → 陌生人 not_found（与不存在同语义，防枚举探测）
//   4. 未发布（即使 visibility 被旁路写成 unlisted）→ 陌生人 not_found（防御性二道闸）
//   5. 作者本人未发布 → 可见，isPreview = true（前端出「仅你可见」横幅）
//   6. 无渲染产物（无成功 video.render Job）→ videoUrl/posterUrl 为 null，不抛错
import { describe, expect, it, afterEach } from 'vitest'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { getShareView } from '@/core/content/share-view'

const created: string[] = []
afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.content.deleteMany({ where: { id } }).catch(() => null)
  }
})

async function seedReadyContent(ownerId: string, text: string) {
  const c = await contentService.startCreation({ ownerId, text })
  created.push(c.id)
  for (const to of ['INTENT', 'PLANNING', 'STORY', 'STORYBOARD', 'GENERATING', 'REVIEW', 'RENDERING', 'READY'] as const) {
    await contentService.advanceStatus(c.id, to, ownerId, { actorType: 'system' })
  }
  return c
}

describe('分享页访问语义（getShareView）', () => {
  it('已发布 public → 匿名访客可见 + 发布信息随行', async () => {
    const { user: owner } = await userRepo.createSessionUser(db)
    const c = await seedReadyContent(owner.id, '公开发布走查')
    await contentService.publishMinimal(c.id, owner.id, { visibility: 'public', description: '一句话简介' })

    const view = await getShareView(c.id, null)
    expect(view.content.id).toBe(c.id)
    expect(view.isOwner).toBe(false)
    expect(view.isPreview).toBe(false)
    expect(view.publication).not.toBeNull()
    expect(view.publication?.visibility).toBe('public')
    expect(view.publication?.description).toBe('一句话简介')
    expect(view.content.owner.displayName).toBeTruthy()
  })

  it('已发布 unlisted → 匿名访客经链接可见（不进探索，但分享页直达）', async () => {
    const { user: owner } = await userRepo.createSessionUser(db)
    const c = await seedReadyContent(owner.id, '不列出发布走查')
    await contentService.publishMinimal(c.id, owner.id, { visibility: 'unlisted' })

    const view = await getShareView(c.id, null)
    expect(view.content.id).toBe(c.id)
    expect(view.publication?.visibility).toBe('unlisted')
  })

  it('private → 陌生人 not_found（防枚举探测）', async () => {
    const { user: owner } = await userRepo.createSessionUser(db)
    const { user: stranger } = await userRepo.createSessionUser(db)
    const c = await seedReadyContent(owner.id, '私有分享走查')

    await expect(getShareView(c.id, stranger.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(getShareView(c.id, null)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('未发布 + visibility 被旁路为 unlisted → 陌生人仍 not_found（发布态防御闸）', async () => {
    const { user: owner } = await userRepo.createSessionUser(db)
    const { user: stranger } = await userRepo.createSessionUser(db)
    const c = await seedReadyContent(owner.id, '防御闸走查')
    // 直接改库模拟「visibility 与发布态不一致」的未来路径破坏
    await db.content.update({ where: { id: c.id }, data: { visibility: 'unlisted' } })

    await expect(getShareView(c.id, stranger.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(getShareView(c.id, null)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('作者本人未发布 → 可见 + isPreview（仅你可见预览态）', async () => {
    const { user: owner } = await userRepo.createSessionUser(db)
    const c = await seedReadyContent(owner.id, '作者预览走查')

    const view = await getShareView(c.id, owner.id)
    expect(view.content.id).toBe(c.id)
    expect(view.isOwner).toBe(true)
    expect(view.isPreview).toBe(true)
    expect(view.publication).toBeNull()
  })

  it('无渲染产物 → videoUrl/posterUrl 为 null，不抛错（前端出占位态）', async () => {
    const { user: owner } = await userRepo.createSessionUser(db)
    const c = await seedReadyContent(owner.id, '空产物走查')
    await contentService.publishMinimal(c.id, owner.id, { visibility: 'public' })

    const view = await getShareView(c.id, null)
    expect(view.videoUrl).toBeNull()
    expect(view.posterUrl).toBeNull()
    expect(view.durationMs).toBeNull()
  })
})
