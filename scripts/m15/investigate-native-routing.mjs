#!/usr/bin/env node
// 取证：用户作品 native/composition 真实路径（不修改任何数据，只读）
// 证据链：Content → Job → structureJson.motion → Provenance → provider 记账 → ModelProviderConfig
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient({ datasources: { db: { url: 'file:/home/z/my-project/db/custom.db' } } })

const contentIdLike = process.argv[2] ?? 'cmuw6r7%'

function jcut(s, n = 800) {
  if (!s) return '(null)'
  return s.length > n ? s.slice(0, n) + `…(${s.length} chars)` : s
}

async function main() {
  // 1) 找到目标 Content
  const contents = await db.content.findMany({
    where: { id: { startsWith: contentIdLike.replace(/%$/, '') } },
    include: { jobs: { orderBy: { createdAt: 'desc' } } },
  })
  console.log(`=== Content 匹配 ${contents.length} 条 ===`)
  for (const c of contents) {
    console.log(`\n--- Content ${c.id} ---`)
    console.log(`title=${c.title?.slice(0, 30)} status=${c.status}`)
    console.log(`createdAt=${new Date(c.createdAt).toISOString()} updatedAt=${new Date(c.updatedAt).toISOString()}`)
    console.log(`currentVersionId=${c.currentVersionId ?? '(null)'}`)
    console.log(`lastErrorJson=${jcut(c.lastErrorJson, 300)}`)

    // 2) Jobs
    console.log(`\n[Jobs] 共 ${c.jobs.length} 条：`)
    for (const j of c.jobs.slice(0, 12)) {
      console.log(`  ${j.type} | status=${j.status} | createdAt=${new Date(j.createdAt).toISOString()} | finished=${j.finishedAt ? new Date(j.finishedAt).toISOString() : '-'} | attempts=${j.attempts}`)
      if (j.error) console.log(`    error=${jcut(j.error, 300)}`)
      const out = j.outputJson ? JSON.parse(j.outputJson) : null
      if (out?.shotAssets) {
        const motions = out.shotAssets.map((s) => `#${s.shotIndex}:img${s.imageAssetId ? '✓' : '✗'}${s.videoAssetId ? '+video✓' : ''}${s.ttsAssetId ? '+tts✓' : ''}`)
        console.log(`    shotAssets: ${motions.join(' ')}`)
        const nativeCount = out.shotAssets.filter((s) => s.videoAssetId).length
        console.log(`    >>> native video 资产数: ${nativeCount}/${out.shotAssets.length}`)
      }
    }

    // 3) 配方 motion 实际值（当前版本）
    if (c.currentVersionId) {
      const v = await db.contentVersion.findUnique({ where: { id: c.currentVersionId } })
      if (v) {
        const st = JSON.parse(v.structureJson)
        const shots = (st.story?.scenes ?? []).flatMap((s) => s.shots ?? [])
        console.log(`\n[配方 motion 取值] 版本 v${v.versionNumber}，镜头 ${shots.length} 个：`)
        for (const sh of shots) console.log(`  shot#${sh.index}: motion=${JSON.stringify(sh.motion ?? '(undefined→composition)')} cameraMotion=${sh.cameraMotion ?? '-'} durationMs=${sh.durationMs ?? '-'}`)
      }
    }

    // 4) Provenance：video.shot / native-fallback / storyboard 事件
    const provs = await db.provenance.findMany({
      where: { contentId: c.id },
      orderBy: { createdAt: 'desc' },
      take: 400,
    })
    const videoShotEvents = provs.filter((p) => (p.payloadJson ?? '').includes('video.shot') || p.model === 'native-fallback' || (p.payloadJson ?? '').includes('video'))
    console.log(`\n[Provenance] 总事件 ${provs.length} 条；video 相关 ${videoShotEvents.length} 条：`)
    for (const p of videoShotEvents.slice(0, 30)) {
      console.log(`  ${new Date(p.createdAt).toISOString()} | ${p.eventType} | provider=${p.provider} model=${p.model} | ${jcut(p.payloadJson, 200)}`)
    }
    if (videoShotEvents.length === 0) console.log('  （零条 video.shot 事件 → 从未尝试过 native video 路径）')
  }

  // 5) Provider 记账：video 类调用（Generation.type）
  const videoCalls = await db.generation.findMany({
    where: { type: { contains: 'video' } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  console.log(`\n=== 全库 Generation 记账（type 含 video）：${videoCalls.length} 条（最近 30）===`)
  for (const m of videoCalls) {
    console.log(`  ${new Date(m.createdAt).toISOString()} | content=${m.contentId} | type=${m.type} | provider=${m.provider}/${m.model} | status=${m.status} | ${m.latencyMs ?? '-'}ms`)
  }
  const genTypes = await db.generation.groupBy({ by: ['type'], _count: { _all: true } })
  console.log('  >>> 全库 Generation type 分布：', genTypes.map((g) => `${g.type}=${g._count._all}`).join(', '))
  // 5b) 该作品逐条记账
  if (contents[0]) {
    const ownGens = await db.generation.findMany({ where: { contentId: contents[0].id }, orderBy: { createdAt: 'asc' } })
    console.log(`\n[该作品 Generation 记账] ${ownGens.length} 条：`)
    for (const g of ownGens) console.log(`  ${new Date(g.createdAt).toISOString()} | ${g.type} | ${g.provider}/${g.model} | ${g.status}`)
  }

  // 6) video 通道 Provider 配置现状
  const cfgs = await db.modelProviderConfig.findMany()
  console.log(`\n=== ModelProviderConfig（${cfgs.length} 行）===`)
  for (const cfg of cfgs) {
    console.log(`  channel=${cfg.channel} provider=${cfg.provider} model=${cfg.model} enabled=${cfg.enabled}${cfg.isDefault ? ' [default]' : ''}`)
  }

  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
