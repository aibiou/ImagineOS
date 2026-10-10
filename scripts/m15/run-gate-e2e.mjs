// scripts/m15/run-gate-e2e.mjs —— Gate 7：质量门 + 全 native 零回落 真实管线走查（quality-repro-023 的遗留边界）
// 前置：dev server 以 native 模式运行（bash scripts/m15/restart-dev.sh native）
//       三通道供给已配置（restore-provider-config.mjs）；vision.review 可用（probe-vision-review.mjs）
// 验收口径（docs/design/quality-reproduction.md §5）：
//   1. 每镜图像门 in-loop 真跑：Provenance quality-gate 事件逐镜在案（pass/score/attempts/issues）
//   2. 视频门真跑：vision.review 账本含 gate.video 用途；shotAssets[].videoGate 摘要在案
//   3. Ken Burns 回落事件 = 0（取缔验收恒等式）
//   4. 复现资产：video.shot 携带 repro、image.shot 携带 promptHash
//   5. 范例沉淀：≥8.0 高分镜头入 ShotExemplar（若无高分镜头则如实记录，不伪造）
//   6. 成片可渲染（native 全镜）：ffprobe 实测时长/分辨率
// 断点续跑：state 落盘（scripts/m15/state/g7-gate.json），客户端只轮询、服务端 Job 独立推进。
import { Client, driveCase, loadState, saveState } from './lib.mjs'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const db = new PrismaClient()
const CASE_ID = 'g7-gate'
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })
const OUT = 'scripts/m15/state/g7-gate-report.json'

// 单主角 + 强视觉锚点 + 冷暖对比 + 有运动（native 视频的诚实考场）：
// 深夜便利店里刚下夜班的年轻护士——人物锚点（制服/年龄/神态）逐镜一致性由质量门把守
const TEXT = '我想做一个 40 秒的短剧：深夜的便利店，一位刚下夜班的年轻女护士买了关东煮，坐在窗边慢慢吃。雨水顺着玻璃流下来，她望着窗外空无一人的街道出神。最后她对自己轻轻笑了一下，把热汤一口喝完，走进雨里。'

async function main() {
  // 1) 全链创作（断点续跑；native 模式 = 全镜原生视频 + 61s 节奏化提交）
  const state = loadState(CASE_ID)
  if (state?.phase !== 'published') {
    console.log(`[${ts()}] Gate 7 质量门全 native 走查：「${TEXT.slice(0, 28)}…」`)
    const client = new Client(CASE_ID)
    await driveCase(client, CASE_ID, {
      text: TEXT,
      description: '深夜便利店·下夜班护士的关东煮时刻（质量门全 native 走查）',
      preferKeywords: ['电影', '夜', '雨'],
    })
  } else {
    console.log(`[${ts()}] 案例已完成（断点续跑），直接采集证据`)
  }
  const finalState = loadState(CASE_ID)
  const contentId = finalState.contentId
  console.log(`[${ts()}] contentId=${contentId} phase=${finalState.phase}`)
  if (finalState.phase !== 'published') throw new Error('未完成——请再次运行本脚本续跑')

  // 2) 图像门事件（Provenance quality-gate, stage=image.gate）
  const gateEvents = await db.provenance.findMany({
    where: { contentId, model: 'quality-gate' },
    orderBy: { createdAt: 'asc' },
  })
  const gates = gateEvents.map((e) => { try { return JSON.parse(e.payloadJson ?? '{}') } catch { return {} } })
  const imageGates = gates.filter((p) => p.stage === 'image.gate')
  console.log(`\n[${ts()}] ── 图像门（in-loop 快审·择优）── 共 ${imageGates.length} 镜`)
  for (const g of imageGates) {
    console.log(
      `  镜 ${(g.shotIndex ?? -1) + 1}: ${g.skipped ? 'SKIPPED(评审不可用)' : g.pass ? 'PASS' : 'FAIL'} ` +
      `score=${g.score ?? 'n/a'} attempts=${g.attempts} referenceUsed=${g.referenceUsed ? '是' : '否'}${(g.issues ?? []).length ? ` issues=[${g.issues.join('；')}]` : ''}`,
    )
  }

  // 3) 视频门摘要（Job outputJson shotAssets[].videoGate）
  const sbJob = await db.generationJob.findFirst({
    where: { contentId, type: 'video.storyboard', status: 'succeeded' },
    orderBy: { createdAt: 'desc' },
  })
  const shotAssets = sbJob?.outputJson ? (JSON.parse(sbJob.outputJson).shotAssets ?? []) : []
  const videoGates = shotAssets.filter((s) => s.videoGate)
  console.log(`\n[${ts()}] ── 视频门（抽中点帧严格审）── 共 ${videoGates.length} 镜`)
  for (const s of videoGates) {
    const vg = s.videoGate
    console.log(`  镜 ${s.shotIndex + 1}: ${vg.skipped ? 'SKIPPED' : vg.pass ? 'PASS' : 'FAIL'} score=${vg.score ?? 'n/a'}${s.videoAssetId ? '' : ' ⚠无视频资产'}`)
  }

  // 4) vision.review in-loop 账本（含 gate.video 用途）
  const visionRows = await db.generation.findMany({
    where: { contentId, type: 'vision.review' },
    orderBy: { createdAt: 'asc' },
    select: { status: true, latencyMs: true, inputJson: true, createdAt: true },
  })
  const videoVision = visionRows.filter((r) => (r.inputJson ?? '').includes('gate.video'))
  const okVision = visionRows.filter((r) => r.status === 'succeeded')
  console.log(`\n[${ts()}] ── vision.review 账本 ── 共 ${visionRows.length} 次（图像门 ${visionRows.length - videoVision.length} / 视频门 ${videoVision.length}）成功 ${okVision.length}`)
  if (okVision.length > 0) {
    const lat = okVision.map((r) => r.latencyMs ?? 0).filter((v) => v > 0)
    if (lat.length) console.log(`  快审延迟：均值 ${(lat.reduce((a, b) => a + b, 0) / lat.length / 1000).toFixed(1)}s / 最大 ${(Math.max(...lat) / 1000).toFixed(1)}s`)
  }

  // 5) 零回落验收（Ken Burns 取缔恒等式）
  const fallbacks = await db.provenance.count({ where: { contentId, model: 'native-fallback' } })
  console.log(`\n[${ts()}] Ken Burns 回落事件：${fallbacks}（必须为 0）${fallbacks === 0 ? ' ✓' : ' ✗ 违约'}`)

  // 6) 复现资产覆盖（repro / promptHash）
  const videoRows = await db.generation.findMany({ where: { contentId, type: 'video.shot' }, select: { status: true, outputJson: true } })
  const videoOk = videoRows.filter((r) => r.status === 'succeeded')
  const withRepro = videoOk.filter((r) => (r.outputJson ?? '').includes('repro'))
  const imageRows = await db.generation.findMany({ where: { contentId, type: 'image.shot' }, select: { status: true, inputJson: true } })
  const imageOk = imageRows.filter((r) => r.status === 'succeeded')
  const withHash = imageOk.filter((r) => (r.inputJson ?? '').includes('promptHash'))
  console.log(`[${ts()}] 复现资产：video.shot 成功 ${videoOk.length} 携带 repro ${withRepro.length}｜image.shot 成功 ${imageOk.length} 携带 promptHash ${withHash.length}`)

  // 7) 范例沉淀（经验复利层）
  const exemplars = await db.shotExemplar.findMany({ where: { contentId }, orderBy: { shotIndex: 'asc' } })
  console.log(`[${ts()}] 范例库沉淀：${exemplars.length} 条高分镜头（阈值 ≥8.0）`)
  for (const x of exemplars) {
    const s = JSON.parse(x.scoreJson ?? '{}')
    console.log(`  镜 ${x.shotIndex + 1}：${s.score} 分｜${(s.verdictSummary ?? '').slice(0, 40)}`)
  }

  // 8) 成片实测
  const finalAsset = await db.asset.findFirst({ where: { contentId, kind: 'final' }, orderBy: { createdAt: 'desc' } })
  let finalProbe = null
  if (finalAsset) {
    const p = resolve('storage/assets', finalAsset.storageLocation)
    if (existsSync(p)) {
      const meta = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=width,height', '-of', 'json', p]).toString())
      finalProbe = {
        file: finalAsset.storageLocation,
        durationSec: Math.round(+meta.format?.duration ?? 0),
        resolution: `${meta.streams?.[0]?.width}x${meta.streams?.[0]?.height}`,
        sizeMB: +((+meta.format?.size ?? 0) / 1024 / 1024).toFixed(1),
      }
      console.log(`[${ts()}] 成片：${finalProbe.durationSec}s ${finalProbe.resolution} ${finalProbe.sizeMB}MB（全镜 native）`)
    }
  }

  // 9) 结构快照
  const finalVersion = await db.contentVersion.findFirst({ where: { contentId }, orderBy: { versionNumber: 'desc' } })
  const structure = JSON.parse(finalVersion?.structureJson ?? '{}')
  const shots = (structure?.story?.scenes ?? []).flatMap((s) => s.shots ?? [])

  const report = {
    caseId: CASE_ID,
    collectedAt: new Date().toISOString(),
    text: TEXT,
    contentId,
    shotCount: shots.length,
    imageGates,
    videoGates: videoGates.map((s) => ({ shotIndex: s.shotIndex, ...s.videoGate, hasVideo: s.videoAssetId != null })),
    visionLedger: {
      total: visionRows.length,
      imageGate: visionRows.length - videoVision.length,
      videoGate: videoVision.length,
      succeeded: okVision.length,
    },
    fallbackEvents: fallbacks,
    repro: { videoSucceeded: videoOk.length, withRepro: withRepro.length, imageSucceeded: imageOk.length, withHash: withHash.length },
    exemplars: exemplars.map((x) => ({ shotIndex: x.shotIndex, score: JSON.parse(x.scoreJson ?? '{}').score })),
    finalProbe,
    pipeline: finalState.elapsed ?? {},
    verdict: {
      // 门跑通 = 每镜至少一条 image.gate 事件（含重试全历史）且成套 shotAssets 均带门摘要
      gateRanInLoop:
        shots.length > 0 &&
        new Set(imageGates.map((g) => g.shotIndex)).size === shots.length &&
        shotAssets.length === shots.length &&
        shotAssets.every((s) => s.gate != null),
      videoGateRan: videoGates.length === shots.length,
      zeroFallback: fallbacks === 0,
      reproCoverage: videoOk.length > 0 && withRepro.length === videoOk.length,
    },
  }
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log(`\n[${ts()}] 报告 → ${OUT}`)
  console.log(`[${ts()}] 验收：门跑通=${report.verdict.gateRanInLoop ? '✓' : '✗'} 视频门=${report.verdict.videoGateRan ? '✓' : '✗'} 零回落=${report.verdict.zeroFallback ? '✓' : '✗'} repro覆盖=${report.verdict.reproCoverage ? '✓' : '✗'}`)
  await db.$disconnect()
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
