// scripts/m15/demo-case-inventory.mjs —— M1.5 Final Package：Demo Case 清单数据提取
// 提取：已发布作品（标题/时长/范式/版本链/Remix 血缘/native 记账），供演示清单引用
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const contents = await db.content.findMany({
  where: { status: 'PUBLISHED' },
  include: {
    versions: { select: { id: true, versionNumber: true, creationMethod: true, changelog: true, createdAt: true } },
    publication: true,
    remixOf: true,
    remixSources: { select: { id: true, derivativeContentId: true, remixerId: true } },
  },
  orderBy: { updatedAt: 'desc' },
})

const rows = []
for (const c of contents) {
  const videoAsset = await db.asset.findFirst({
    where: { contentId: c.id, mime: { startsWith: 'video/' } },
    orderBy: { createdAt: 'desc' },
    select: { durationMs: true, sizeBytes: true },
  })
  const nativeShots = await db.generation.count({ where: { contentId: c.id, type: 'video.shot', status: 'succeeded' } })
  rows.push({
    id: c.id.slice(0, 12),
    title: c.title,
    publishedAt: c.publication?.publishedAt,
    durationSec: videoAsset ? Math.round(videoAsset.durationMs / 100) / 10 : null,
    sizeMB: videoAsset ? Math.round(videoAsset.sizeBytes / 1048576 * 10) / 10 : null,
    versions: c.versions.length,
    versionChain: c.versions
      .sort((a, b) => a.versionNumber - b.versionNumber)
      .map((v) => `v${v.versionNumber}(${v.creationMethod})`),
    changelogHead: (c.versions.find((v) => v.versionNumber > 1 && v.changelog)?.changelog ?? '').slice(0, 50),
    remixOf: c.remixOf ? c.remixOf.sourceContentId.slice(0, 12) : null,
    remixedBy: c.remixSources.length,
    nativeShots,
  })
}

console.log(`已发布作品：${rows.length} 件`)
for (const r of rows) {
  console.log(
    `${r.id} | ${r.title} | ${r.durationSec}s | v链:${r.versionChain.join('→')} | remix源:${r.remixOf ?? '-'} | 被remix:${r.remixedBy} | native镜:${r.nativeShots}`
  )
}
await db.$disconnect()
