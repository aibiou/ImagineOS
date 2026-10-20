// Content 生命周期与会话集成测试（§48 / §51 / ADR-0003）
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { ensureSessionUser, resolveUserFromToken } from '@/core/auth/session'
import { DomainValidationError, IllegalTransitionError, NotFoundError } from '@/core/errors'

describe('startCreation（主链第一环）', () => {
  it('自然语言表达 → Content(IDEA) + Intent.rawExpression + Provenance(content_created)', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const text = '我想做一个45秒的视频，记录我小时候和父亲一起骑自行车。'
    const c = await contentService.startCreation({ ownerId: user.id, text })
    expect(c.status).toBe('IDEA')
    expect(c.title.length).toBeGreaterThan(0)
    expect(c.title.length).toBeLessThanOrEqual(25)

    const intent = await db.intent.findFirst({ where: { contentId: c.id } })
    expect(intent?.rawExpression).toBe(text)

    const events = await db.provenance.findMany({ where: { contentId: c.id } })
    expect(events.map((e) => e.eventType)).toContain('content_created')
  })

  it('超长标题自动截断为 24 字 + 省略号', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const long = '这是一段非常非常长的表达'.repeat(10)
    const c = await contentService.startCreation({ ownerId: user.id, text: long })
    expect(c.title.endsWith('…')).toBe(true)
    expect(c.title.length).toBe(25)
  })
})

describe('advanceStatus（状态机唯一合法入口）', () => {
  it('合法链路逐步推进到 READY 并记录 status_changed 溯源', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const c = await contentService.startCreation({ ownerId: user.id, text: '状态机走查' })
    for (const to of ['INTENT', 'PLANNING', 'STORY', 'STORYBOARD', 'GENERATING', 'REVIEW', 'RENDERING', 'READY'] as const) {
      const updated = await contentService.advanceStatus(c.id, to, user.id)
      expect(updated.status).toBe(to)
    }
    const events = await db.provenance.findMany({
      where: { contentId: c.id, eventType: 'status_changed' },
      orderBy: { createdAt: 'asc' },
    })
    expect(events).toHaveLength(8)
  })

  it('非法跳转（IDEA→REVIEW）抛 illegal_transition 且状态不变', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const c = await contentService.startCreation({ ownerId: user.id, text: '非法跳转' })
    await expect(contentService.advanceStatus(c.id, 'REVIEW', user.id)).rejects.toThrow(IllegalTransitionError)
    const after = await db.content.findUnique({ where: { id: c.id } })
    expect(after?.status).toBe('IDEA')
  })

  it('未知状态被拒绝（脏数据防御）', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const c = await contentService.startCreation({ ownerId: user.id, text: '未知状态' })
    await expect(contentService.advanceStatus(c.id, 'FAILED', user.id)).rejects.toThrow(DomainValidationError)
  })
})

describe('publishMinimal（最小发布）', () => {
  it('仅 READY 可发布；发布写 Publication + 状态 PUBLISHED + 可见性', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const c = await contentService.startCreation({ ownerId: user.id, text: '发布走查' })
    await expect(
      contentService.publishMinimal(c.id, user.id, { visibility: 'public' }),
    ).rejects.toThrow(IllegalTransitionError)

    for (const to of ['INTENT', 'PLANNING', 'STORY', 'STORYBOARD', 'GENERATING', 'REVIEW', 'RENDERING', 'READY'] as const) {
      await contentService.advanceStatus(c.id, to, user.id)
    }
    const published = await contentService.publishMinimal(c.id, user.id, {
      visibility: 'public',
      description: '第一个作品',
    })
    expect(published.status).toBe('PUBLISHED')
    expect(published.visibility).toBe('public')

    const pub = await db.publication.findUnique({ where: { contentId: c.id } })
    expect(pub?.visibility).toBe('public')
    expect(pub?.description).toBe('第一个作品')

    // 进入 Explore
    const explore = await contentService.listExplore()
    expect(explore.some((x) => x.id === c.id)).toBe(true)
  })

  it('非作者不能发布', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const { user: other } = await userRepo.createSessionUser(db)
    const c = await contentService.startCreation({ ownerId: user.id, text: '他人发布' })
    for (const to of ['INTENT', 'PLANNING', 'STORY', 'STORYBOARD', 'GENERATING', 'REVIEW', 'RENDERING', 'READY'] as const) {
      await contentService.advanceStatus(c.id, to, user.id)
    }
    await expect(
      contentService.publishMinimal(c.id, other.id, { visibility: 'public' }),
    ).rejects.toThrow(DomainValidationError)
  })
})

describe('可见性（§32 雏形）', () => {
  it('私有作品对非作者以 not_found 语义隐藏（防枚举探测）', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const { user: other } = await userRepo.createSessionUser(db)
    const c = await contentService.startCreation({ ownerId: user.id, text: '私有作品' })
    await expect(contentService.getOwnedOrVisibleContent(c.id, other.id)).rejects.toThrow(NotFoundError)
    await expect(contentService.getOwnedOrVisibleContent(c.id, null)).rejects.toThrow(NotFoundError)
    const owned = await contentService.getOwnedOrVisibleContent(c.id, user.id)
    expect(owned.isOwner).toBe(true)
  })
})

describe('会话身份（ADR-0003）', () => {
  it('ensureSessionUser：无 token 创建匿名用户；token 可解析回同一用户', async () => {
    const first = await ensureSessionUser(null)
    expect(first.isNew).toBe(true)
    expect(first.user.displayName).toContain('旅人')

    const again = await ensureSessionUser(first.token)
    expect(again.isNew).toBe(false)
    expect(again.user.id).toBe(first.user.id)

    const resolved = await resolveUserFromToken(first.token)
    expect(resolved?.id).toBe(first.user.id)
    expect(await resolveUserFromToken('bogus-token')).toBeNull()
    expect(await resolveUserFromToken(null)).toBeNull()
  })
})
