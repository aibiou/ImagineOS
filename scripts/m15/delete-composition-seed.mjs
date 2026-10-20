// delete-composition-seed.mjs —— 下线 composition 模式产物（2026-10-20 产品红线执行）
// 《天空为什么是蓝色的》由强制 composition 模式生成（动态图片），产品负责人明令：
// 输出必须是真 AI 视频；生成不了就报错。该作品为欺骗性输出，删除。
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const target = await prisma.content.findFirst({ where: { title: { contains: '为什么天空是蓝色的' } } })
if (!target) { console.log('未找到目标作品（可能已删除）'); process.exit(0) }
console.log(`目标: ${target.title} (${target.status}, id=${target.id})`)
// 走应用级删除服务（级联资产/版本/Job 由服务保证一致性）
const { contentService } = await import('../src/core/content/content-service.ts').catch(() => ({}))
if (contentService) {
  const owner = await prisma.intent.findFirst({ where: { contentId: target.id }, select: { userId: true } })
  const actorId = owner?.userId ?? 'seed'
  const res = await contentService.deleteContent(target.id, actorId)
  console.log(`已删除: ${res.title}`)
} else {
  console.log('服务导入失败，回退 SQL 级联删除（先摘关系）')
  const del = async (table, where) => { const n = await prisma[table].deleteMany({ where }); return n.count }
  const counts = []
  counts.push(await del('provenance', { contentId: target.id }))
  counts.push(await del('generation', { contentId: target.id }))
  counts.push(await del('generationJob', { contentId: target.id }))
  counts.push(await del('asset', { contentId: target.id }))
  counts.push(await del('creativePlan', { contentId: target.id }))
  counts.push(await del('story', { contentId: target.id }))
  counts.push(await del('intent', { contentId: target.id }))
  counts.push(await del('contentVersion', { contentId: target.id }))
  counts.push(await del('content', { id: target.id }))
  console.log('SQL 级联删除完成，各行数:', counts.join(', '))
}
const remain = await prisma.content.count()
console.log(`剩余作品数: ${remain}`)
await prisma.$disconnect()
