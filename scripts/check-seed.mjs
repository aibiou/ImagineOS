import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const users = await db.user.findMany({ where: { isDemo: true } })
console.log('demo users:', users.map(u => u.handle).join(', '))
const contents = await db.content.findMany({ include: { owner: true, _count: { select: { versions: true, remixSources: true } } } })
for (const c of contents) {
  console.log(`- [${c.status}/${c.visibility}] ${c.title} (owner=${c.owner.handle}, versions=${c._count.versions}, remixes=${c._count.remixSources})`)
}
const remixed = await db.content.findMany({ where: { title: { contains: 'Remix' } } })
console.log('remix contents:', remixed.length)
const pubs = await db.publication.count()
console.log('publications:', pubs)
await db.$disconnect()
