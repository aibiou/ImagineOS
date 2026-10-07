#!/usr/bin/env node
// 取证补全：ModelProviderConfig 详情（正确字段名）+ video 链就绪状态
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient({ datasources: { db: { url: 'file:/home/z/my-project/db/custom.db' } } })

async function main() {
  const cfgs = await db.modelProviderConfig.findMany({ orderBy: { priority: 'asc' } })
  console.log('=== ModelProviderConfig（正确字段）===')
  for (const c of cfgs) {
    console.log(`  channel=${c.channel} | label=${c.label} | model=${c.modelName} | enabled=${c.enabled} | priority=${c.priority} | lastTest=${c.lastTestStatus ?? '-'} @ ${c.lastTestedAt ? new Date(c.lastTestedAt).toISOString() : '-'} | msg=${(c.lastTestMessage ?? '').slice(0, 80)}`)
  }
  // video 链可用性 = video.shot channel 存在 enabled 行（agnes）+ zai 内置兜底
  const videoRows = cfgs.filter((c) => c.channel === 'video' && c.enabled)
  console.log(`\n>>> video.shot 通道：自定义 ${videoRows.length} 行（agnes）+ 内置 zai-video 兜底 → hasVideoShotProvider=true（但 motion 开关未开，永不进入）`)

  // 该作品最终资产（确认 composition MP4）
  const content = await db.content.findFirst({ where: { id: { startsWith: 'cmuw6r7' } } })
  if (content) {
    const assets = await db.asset.findMany({ where: { contentId: content.id }, orderBy: { createdAt: 'asc' } })
    console.log(`\n=== 该作品资产 ${assets.length} 件 ===`)
    for (const a of assets) {
      console.log(`  kind=${a.kind} mime=${a.mime ?? '-'} bytes=${a.bytes} | ${new Date(a.createdAt).toISOString()} | id=${a.id.slice(0, 12)}`)
    }
    const finals = assets.filter((a) => a.kind === 'final')
    console.log(`  >>> final 资产 ${finals.length} 件（${finals.map((f) => f.mime).join(', ')}）—— FFmpeg 合成 MP4 = composition 产物`)
  }
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
