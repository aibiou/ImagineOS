// 作品删除（底座补全：作品管理——Owner 硬删除 + 全链级联 + 孤儿文件回收）
// 背景：平台此前没有删除能力，用户无法清理不想要的作品（产品负责人 Gate 7 反馈
// 「花里胡哨的作品」堆积正是该缺口的体现）。本文件锁定删除语义：
//   1. Owner 删除 → Content 行与全部关联（版本/任务/资产行）级联清空
//   2. 真实文件随删回收（存储 key 无引用 → 物理删除）
//   3. 内容寻址全局去重的对偶面：仍被其他作品引用的文件不动
//   4. 非 Owner：公开作品 → permission_denied（原作品完好）
//   5. 陌生人碰私有作品 → not_found（与不存在同语义，防枚举探测）
import { describe, expect, it, afterEach } from 'vitest'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { assetService } from '@/core/assets/asset-service'
import { jobService } from '@/core/jobs/job-service'
import { diskStorage } from '@/infra/storage'

const created: string[] = []
afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.content.deleteMany({ where: { id } }).catch(() => null)
  }
})

describe('作品删除（contentService.deleteContent）', () => {
  it('Owner 删除 → 行与全部关联级联清空', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const c = await contentService.startCreation({ ownerId: user.id, text: '删除走查' })
    created.push(c.id)

    const version = await db.contentVersion.create({
      data: {
        contentId: c.id,
        versionNumber: 1,
        createdBy: user.id,
        creationMethod: 'initial',
        changelog: '删除走查',
      },
    })
    const job = await jobService.enqueue({ contentId: c.id, versionId: version.id, type: 'video.storyboard' })

    const out = await contentService.deleteContent(c.id, user.id)
    expect(out.id).toBe(c.id)
    expect(out.title).toBe(c.title)

    await expect(db.content.findUnique({ where: { id: c.id } })).resolves.toBeNull()
    await expect(db.contentVersion.findUnique({ where: { id: version.id } })).resolves.toBeNull()
    await expect(db.generationJob.findUnique({ where: { id: job.id } })).resolves.toBeNull()
  })

  it('真实文件随删回收：存储 key 无引用 → 物理删除', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const c = await contentService.startCreation({ ownerId: user.id, text: '文件回收走查' })
    created.push(c.id)

    const saved = await assetService.save({
      contentId: c.id,
      ownerId: user.id,
      kind: 'generated',
      data: Buffer.from(`delete-me-${c.id}-${Date.now()}`),
      declaredMime: 'image/png',
    })
    expect(saved.reused).toBe(false)
    await expect(diskStorage.exists(saved.storageLocation)).resolves.toBe(true)

    await contentService.deleteContent(c.id, user.id)
    await expect(db.asset.findUnique({ where: { id: saved.id } })).resolves.toBeNull()
    await expect(diskStorage.exists(saved.storageLocation)).resolves.toBe(false)
  })

  it('全局去重对偶面：文件仍被其他作品资产引用 → 物理文件保留', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const cA = await contentService.startCreation({ ownerId: user.id, text: '引用方走查' })
    const cB = await contentService.startCreation({ ownerId: user.id, text: '被删方走查' })
    created.push(cA.id, cB.id)

    // A 先落一份真实文件
    const savedA = await assetService.save({
      contentId: cA.id,
      ownerId: user.id,
      kind: 'generated',
      data: Buffer.from('shared-bytes-refcount-check'),
      declaredMime: 'image/png',
    })
    // B 同字节保存 → (hash, kind) 全局幂等命中，复用 A 的行与文件
    const savedB = await assetService.save({
      contentId: cB.id,
      ownerId: user.id,
      kind: 'generated',
      data: Buffer.from('shared-bytes-refcount-check'),
      declaredMime: 'image/png',
    })
    expect(savedB.reused).toBe(true)
    expect(savedB.id).toBe(savedA.id)

    // 删 B（B 没有自己的资产行）→ A 的行与文件必须完好
    await contentService.deleteContent(cB.id, user.id)
    await expect(db.asset.findUnique({ where: { id: savedA.id } })).resolves.not.toBeNull()
    await expect(diskStorage.exists(savedA.storageLocation)).resolves.toBe(true)
  })

  it('非 Owner 删除公开作品 → permission_denied，原作品完好', async () => {
    const { user: owner } = await userRepo.createSessionUser(db)
    const { user: stranger } = await userRepo.createSessionUser(db)
    const c = await contentService.startCreation({ ownerId: owner.id, text: '公开作品删除走查' })
    created.push(c.id)
    await db.content.update({ where: { id: c.id }, data: { visibility: 'public' } })

    await expect(contentService.deleteContent(c.id, stranger.id)).rejects.toMatchObject({
      code: 'permission_denied',
    })
    await expect(db.content.findUnique({ where: { id: c.id } })).resolves.not.toBeNull()
  })

  it('陌生人碰私有作品 → not_found（防枚举探测）', async () => {
    const { user: owner } = await userRepo.createSessionUser(db)
    const { user: stranger } = await userRepo.createSessionUser(db)
    const c = await contentService.startCreation({ ownerId: owner.id, text: '私有防探测' })
    created.push(c.id)

    await expect(contentService.deleteContent(c.id, stranger.id)).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('作品不存在 → not_found', async () => {
    const { user } = await userRepo.createSessionUser(db)
    await expect(contentService.deleteContent('nonexistent-id', user.id)).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})
