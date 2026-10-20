// 版本系统集成测试（§24–§25 / 不变量 I1、I6）
// 场景：v1 → 修订 v2 → v3 → restore v1 ⇒ v4(parent=v3, 内容=v1)；旧版本永不覆盖
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { versionService } from '@/core/content/version-service'
import { versionRepo } from '@/core/repositories/version-repo'
import { DomainValidationError } from '@/core/errors'
import { parseStructure } from '@/core/content/schemas'

let ownerId: string

beforeAll(async () => {
  const { user } = await userRepo.createSessionUser(db)
  ownerId = user.id
})

async function newContent(text = '测试：给外婆的一封信，温暖短片') {
  return contentService.startCreation({ ownerId, text })
}

describe('版本系统', () => {
  it('创建作品时无版本，currentVersionId 为空', async () => {
    const c = await newContent()
    expect(c.status).toBe('IDEA')
    expect(c.currentVersionId).toBeNull()
    const versions = await versionRepo.listByContent(db, c.id)
    expect(versions).toHaveLength(0)
  })

  it('v1(initial) → v2(revision)：血缘正确、现势指针前移、配方延续', async () => {
    const c = await newContent()
    const v1 = await versionService.createVersion(c.id, ownerId, {
      method: 'initial',
      changelog: '初版',
      structure: { intentSummary: '给外婆的信', story: { logline: '一封没有寄出的信', scenes: [{ index: 0, shots: [{ index: 0, visualDescription: '信纸与老照片' }] }] } },
    })
    expect(v1.versionNumber).toBe(1)
    expect(v1.parentVersionId).toBeNull()

    // v2 未提供 structure ⇒ 继承 v1 配方（§24 修订语义）
    const v2 = await versionService.createVersion(c.id, ownerId, { method: 'revision', changelog: '再温暖一点' })
    expect(v2.versionNumber).toBe(2)
    expect(v2.parentVersionId).toBe(v1.id)
    expect(parseStructure(v2.structureJson).intentSummary).toBe('给外婆的信')

    const content = await db.content.findUnique({ where: { id: c.id } })
    expect(content?.currentVersionId).toBe(v2.id)
  })

  it('v1→v2→v3 后 restore v1 ⇒ v4：parent=当前版(v3)，内容回到 v1（§25 恢复语义）', async () => {
    const c = await newContent()
    const v1 = await versionService.createVersion(c.id, ownerId, { method: 'initial', changelog: 'v1', structure: { intentSummary: '版本A' } })
    await versionService.createVersion(c.id, ownerId, { method: 'revision', changelog: 'v2', structure: { intentSummary: '版本B' } })
    const v3 = await versionService.createVersion(c.id, ownerId, { method: 'revision', changelog: 'v3', structure: { intentSummary: '版本C' } })

    const v4 = await versionService.restoreVersion(c.id, v1.id, ownerId)
    expect(v4.versionNumber).toBe(4)
    expect(v4.parentVersionId).toBe(v3.id)
    expect(v4.creationMethod).toBe('restore')
    expect(v4.changelog).toContain('v1')
    expect(parseStructure(v4.structureJson).intentSummary).toBe('版本A')

    // 历史版本全部可寻址（不变量 I6）
    const timeline = await versionService.listTimeline(c.id)
    expect(timeline.map((t) => t.versionNumber)).toEqual([4, 3, 2, 1])
    expect(timeline.find((t) => t.versionNumber === 4)?.isCurrent).toBe(true)
    expect(timeline.find((t) => t.versionNumber === 1)?.isCurrent).toBe(false)
  })

  it('恢复当前版本被拒绝', async () => {
    const c = await newContent()
    const v1 = await versionService.createVersion(c.id, ownerId, { method: 'initial' })
    await expect(versionService.restoreVersion(c.id, v1.id, ownerId)).rejects.toThrow(DomainValidationError)
  })

  it('不变量 I1：版本仓储结构性不可变（不暴露 update/delete 面）', () => {
    const surface = Object.keys(versionRepo)
    expect(surface).not.toContain('update')
    expect(surface).not.toContain('delete')
    expect(surface).not.toContain('upsert')
  })

  it('非作者不能创建版本（权限负例）', async () => {
    const c = await newContent()
    const { user: other } = await userRepo.createSessionUser(db)
    await expect(
      versionService.createVersion(c.id, other.id, { method: 'revision' }),
    ).rejects.toThrow(DomainValidationError)
  })

  it('每次创建版本都追加 Provenance（version_created）', async () => {
    const c = await newContent()
    await versionService.createVersion(c.id, ownerId, { method: 'initial' })
    await versionService.createVersion(c.id, ownerId, { method: 'revision', changelog: '再暖一点' })
    const events = await db.provenance.findMany({ where: { contentId: c.id, eventType: 'version_created' } })
    expect(events).toHaveLength(2)
  })
})
