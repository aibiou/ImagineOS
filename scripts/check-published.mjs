// 快查:当前库中公开作品清单 + 媒体落盘核对(用户要亲眼看产出质量)
import { PrismaClient } from '@prisma/client'
import { existsSync, statSync } from 'node:fs'

const p = new PrismaClient()
const pubs = await p.publication.findMany({
  select: { title: true, publishedAt: true, contentId: true },
  orderBy: { publishedAt: 'asc' },
})
console.log(`公开作品 ${pubs.length} 件:`)
for (const x of pubs) console.log(` - ${x.title}  (contentId=${x.contentId.slice(0, 8)}…)`)

const assets = await p.asset.count()
const finals = await p.asset.findMany({
  where: { kind: { contains: 'final' } },
  select: { id: true, kind: true, path: true },
  take: 10,
})
console.log(`资产总数 ${assets},final 类 ${finals.length} 件`)
for (const f of finals) {
  const ok = existsSync(f.path) && statSync(f.path).size > 0
  console.log(`   final: ${ok ? '✓ 可播放' : '✗ 缺失'} ${f.path} (${statSync(f.path)?.size ?? 0} bytes)`)
}
await p.$disconnect()
