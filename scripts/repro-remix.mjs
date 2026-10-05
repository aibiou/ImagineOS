import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const lin = await db.user.findUnique({ where: { handle: 'lin-yiye' } })
const he = await db.user.findUnique({ where: { handle: 'a-he' } })
const bicycle = await db.content.findFirst({ where: { ownerId: lin.id }, orderBy: { createdAt: 'asc' } })
console.log('bicycle:', bicycle.id, bicycle.status, bicycle.remixPermission, 'currentVersion:', bicycle.currentVersionId)
const v = await db.contentVersion.findFirst({ where: { contentId: bicycle.id }, orderBy: { versionNumber: 'desc' } })
console.log('latest version:', v?.id, v?.versionNumber)
try {
  // 手动走 forkContent 的关键步骤，定位失败点
  const newContent = await db.content.create({ data: { ownerId: he.id, title: '测试 Remix', status: 'READY' } })
  console.log('new content ok:', newContent.id)
  const newVersion = await db.contentVersion.create({ data: { contentId: newContent.id, versionNumber: 1, parentVersionId: null, createdBy: he.id, creationMethod: 'remix', changelog: 'test', structureJson: v.structureJson } })
  console.log('new version ok:', newVersion.id)
  const remix = await db.remix.create({ data: { derivativeContentId: newContent.id, derivativeVersionId: newVersion.id, sourceContentId: bicycle.id, sourceVersionId: v.id, remixerId: he.id } })
  console.log('remix ok:', remix.id)
  // 清理
  await db.remix.delete({ where: { id: remix.id } })
  await db.contentVersion.delete({ where: { id: newVersion.id } })
  await db.content.delete({ where: { id: newContent.id } })
  console.log('cleanup ok')
} catch (e) {
  console.error('FAILED AT:', e.message)
}
await db.$disconnect()
