// Fork / Remix 集成测试（§35 / 不变量 I2：原作零改动）
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { versionService } from '@/core/content/version-service'
import { forkService } from '@/core/content/fork-service'
import { remixRepo } from '@/core/repositories/remix-repo'
import { RemixNotAllowedError, DomainValidationError, NotFoundError } from '@/core/errors'
import { parseStructure } from '@/core/content/schemas'

let authorId: string
let remixerId: string

beforeAll(async () => {
  const a = await userRepo.createSessionUser(db)
  const b = await userRepo.createSessionUser(db)
  authorId = a.user.id
  remixerId = b.user.id
})

async function readyContent(text: string) {
  const c = await contentService.startCreation({ ownerId: authorId, text })
  for (const to of ['INTENT', 'PLANNING', 'STORY', 'STORYBOARD', 'GENERATING', 'REVIEW', 'RENDERING', 'READY'] as const) {
    await contentService.advanceStatus(c.id, to, authorId)
  }
  await versionService.createVersion(c.id, authorId, {
    method: 'initial',
    changelog: '初版',
    structure: { intentSummary: '原始意图', story: { logline: '原始故事' } },
  })
  return c
}

describe('Fork / Remix 原语', () => {
  it('Remix 创建新 Content + 新 Version + 血缘三件套，原作行零改动（§35 全条）', async () => {
    const source = await readyContent('记录爷爷的修表铺，60秒')
    const sourceBefore = await db.content.findUnique({ where: { id: source.id } })
    const sourceVersionsBefore = await db.contentVersion.findMany({ where: { contentId: source.id } })

    const { content, version, remix } = await forkService.forkContent({
      sourceContentId: source.id,
      newOwnerId: remixerId,
    })

    // 新对象
    expect(content.id).not.toBe(source.id)
    expect(content.ownerId).toBe(remixerId)
    expect(content.title).toContain('Remix')
    expect(version.versionNumber).toBe(1)
    expect(version.creationMethod).toBe('remix')

    // 血缘三件套（§35）
    expect(remix.derivativeContentId).toBe(content.id)
    expect(remix.derivativeVersionId).toBe(version.id)
    expect(remix.sourceContentId).toBe(source.id)
    expect(remix.sourceVersionId).not.toBe(remix.derivativeVersionId)
    expect(remix.remixerId).toBe(remixerId)

    // 配方完整复制
    expect(parseStructure(version.structureJson).story?.logline).toBe('原始故事')

    // 原作零改动（不变量 I2，字段级断言）
    const sourceAfter = await db.content.findUnique({ where: { id: source.id } })
    expect(sourceAfter).toEqual(sourceBefore)
    const sourceVersionsAfter = await db.contentVersion.findMany({ where: { contentId: source.id } })
    expect(sourceVersionsAfter).toEqual(sourceVersionsBefore)
  })

  it('Remix 后新作者可独立修订（进入自己的创作循环），互不影响', async () => {
    const source = await readyContent('海边的风筝，30秒')
    const { content } = await forkService.forkContent({ sourceContentId: source.id, newOwnerId: remixerId })
    const v2 = await versionService.createVersion(content.id, remixerId, {
      method: 'revision',
      changelog: '改成冬日海风',
      structure: { intentSummary: '新的意图' },
    })
    expect(v2.versionNumber).toBe(2)

    // 源作版本数不因 Remix 侧的修订而变化
    const sourceVersions = await db.contentVersion.findMany({ where: { contentId: source.id } })
    expect(sourceVersions).toHaveLength(1)
  })

  it('remixPermission=deny 的作品拒绝 Remix（§32）', async () => {
    const source = await readyContent('私密：写给十年后的自己')
    await contentService.setMetadata(source.id, authorId, { remixPermission: 'deny' })
    await expect(
      forkService.forkContent({ sourceContentId: source.id, newOwnerId: remixerId }),
    ).rejects.toThrow(RemixNotAllowedError)
  })

  it('不能 Remix 自己的作品（修订请用版本系统）', async () => {
    const source = await readyContent('我的晨跑日记')
    await expect(
      forkService.forkContent({ sourceContentId: source.id, newOwnerId: authorId }),
    ).rejects.toThrow(DomainValidationError)
  })

  it('不存在的作品返回 not_found', async () => {
    await expect(forkService.forkContent({ sourceContentId: 'nonexistent', newOwnerId: remixerId })).rejects.toThrow(
      NotFoundError,
    )
  })

  it('还没有版本的作品不能被 Remix（先完成一次创作）', async () => {
    const c = await contentService.startCreation({ ownerId: authorId, text: '空作品' })
    await expect(
      forkService.forkContent({ sourceContentId: c.id, newOwnerId: remixerId }),
    ).rejects.toThrow(DomainValidationError)
  })

  it('Remix 双侧 Provenance 均记录（remixed / remix_received）', async () => {
    const source = await readyContent('巷口的爆米花摊')
    await forkService.forkContent({ sourceContentId: source.id, newOwnerId: remixerId })
    const srcEvents = await db.provenance.findMany({ where: { contentId: source.id, eventType: 'remixed' } })
    expect(srcEvents).toHaveLength(1)
    const remix = await remixRepo.listBySource(db, source.id)
    expect(remix).toHaveLength(1)
  })

  it('两层 Remix：B remix A，C remix B——血缘链各自独立且可回溯（§23）', async () => {
    const a = await readyContent('原点故事')
    const b = await forkService.forkContent({ sourceContentId: a.id, newOwnerId: remixerId })
    // 第三位用户
    const c = await userRepo.createSessionUser(db)
    const cc = await forkService.forkContent({ sourceContentId: b.content.id, newOwnerId: c.user.id })
    expect(cc.remix.sourceContentId).toBe(b.content.id)
    expect(b.remix.sourceContentId).toBe(a.id)
    // A 的衍生树有两层
    const treeA = await remixRepo.listBySource(db, a.id)
    expect(treeA).toHaveLength(1)
    const treeB = await remixRepo.listBySource(db, b.content.id)
    expect(treeB).toHaveLength(1)
  })
})
