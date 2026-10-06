// scripts/m15/run-native-golden.mjs —— Gate 6b：Native Video Golden Case（强制 native 全链）
// 前置条件：
//   1. dev server 以 IMAGINEOS_FORCE_NATIVE=1 运行（重启方式：bash scripts/m15/restart-dev.sh native）
//      —— native 分支在 workers/pipeline-executor.ts 的服务端进程内判定，脚本侧设环境变量无效
//   2. Gate 3 父亲故事已完成（其成片作为同代际 composition 基线）
// 流程：真实全链创作（≥5 镜）→ 逐镜 video.shot 记账采集 → 失败/回落事件采集
//       → 成片 YDIF 度量 → 与 G3 composition 基线 + 历史 9 案例统计对比
import { Client, driveCase, loadState, saveState } from './lib.mjs'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const db = new PrismaClient()
const CASE_ID = 'g6-native'
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })
const OUT = 'scripts/m15/state/g6-native.json'

// 运动感强的叙事主体（人物奔跑 + 风 + 萤火虫 + 星空）——native 主体运动的诚实考场
const TEXT = '我想做一个 45 秒的短片：夏天的傍晚，一个小女孩在田野里追萤火虫，从田埂一路跑到河边，风吹起她的裙角，萤火虫像星星一样在她身边飘，最后她停在星空下，轻轻伸出手捧住了一只。'

// ---------------- YDIF 度量（与 visual-quality.mjs 同口径） ----------------
function ff(args) {
  return execFileSync('ffmpeg', args, { maxBuffer: 64 * 1024 * 1024 }).toString()
}

function frameMetrics(videoPath) {
  const stdout = ff(['-i', videoPath, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=-', '-f', 'null', '-'])
  const rows = []
  let frame = null
  for (const line of stdout.split('\n')) {
    const m = line.match(/^frame:\s*(\d+)\s+pts:\S*\s+pts_time:(\S+)/)
    if (m) { frame = { n: +m[1], t: +m[2] }; continue }
    const y = line.match(/^lavfi\.signalstats\.YDIF=([\d.]+)/)
    if (y && frame) { frame.ydif = +y[1]; rows.push(frame); frame = null }
  }
  return rows
}

function stats(nums) {
  if (nums.length === 0) return { mean: 0, p50: 0, p95: 0, min: 0, max: 0 }
  const sorted = [...nums].sort((a, b) => a - b)
  return {
    mean: +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(3),
    p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(3),
    p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(3),
    min: +sorted[0].toFixed(3),
    max: +sorted[sorted.length - 1].toFixed(3),
  }
}

function frozenSegments(videoPath) {
  try {
    const stdout = execFileSync('ffmpeg', ['-i', videoPath, '-vf', 'freezedetect=n=0.003:d=1', '-f', 'null', '-'], { maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    return [...stdout.matchAll(/freezedetect.*start:\s*([\d.]+)/g)].map((m) => +m[1])
  } catch (e) {
    const stderr = e.stderr?.toString() ?? ''
    return [...stderr.matchAll(/freezedetect.*start:\s*([\d.]+)/g)].map((m) => +m[1])
  }
}

function probe(videoPath) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate:stream=width,height,codec_name,r_frame_rate', '-of', 'json', videoPath]).toString())
}

function extractFrames(videoPath, dir) {
  mkdirSync(dir, { recursive: true })
  execFileSync('ffmpeg', ['-y', '-i', videoPath, '-vf', 'fps=1/4', join(dir, 'f%02d.jpg')])
  return readdirSync(dir).length
}

function measureVideo(label, videoPath, caseId) {
  const rows = frameMetrics(videoPath)
  const ydifs = rows.map((r) => r.ydif)
  const base = ydifs.filter((v) => v < Math.max(...ydifs) * 0.3) // 剔切镜帧
  const frozen = frozenSegments(videoPath)
  const meta = probe(videoPath)
  const thumbs = extractFrames(videoPath, join('scripts/m15/frames', caseId))
  return {
    label,
    file: videoPath.split('/').pop(),
    durationSec: Math.round(+(meta.format?.duration ?? 0)),
    resolution: `${meta.streams?.[0]?.width}x${meta.streams?.[0]?.height}`,
    frames: rows.length,
    extractedThumbs: thumbs,
    ydifAll: stats(ydifs),
    ydifInShot: stats(base),
    frozenSegments: frozen,
  }
}

// ---------------- 主流程 ----------------
async function main() {
  // 0) 前置校验：G3 基线存在
  const g3 = loadState('g3-father')
  if (!g3 || g3.phase !== 'published') throw new Error('G3 父亲故事未完成——它是 composition 基线（先跑 run-revision-chain.mjs）')

  // 1) 全链创作（断点续跑；server 端 FORCE_NATIVE=1 时全部镜头走 native）
  const state = loadState(CASE_ID)
  if (state?.phase !== 'published') {
    console.log(`[${ts()}] Gate 6b Native Golden Case：「${TEXT.slice(0, 30)}…」`)
    const client = new Client(CASE_ID)
    await driveCase(client, CASE_ID, { text: TEXT, description: '夏夜追萤火虫的短片（native 全镜路径）', preferKeywords: ['电影', '梦境', '夜'] })
  } else {
    console.log(`[${ts()}] Golden Case 已完成（断点续跑），进入采集与度量`)
  }
  const finalState = loadState(CASE_ID)
  const contentId = finalState.contentId
  console.log(`[${ts()}] contentId=${contentId} phase=${finalState.phase}`)

  // 2) native 记账采集（Generation: video.shot / image.shot / audio.tts）
  const generations = await db.generation.findMany({
    where: { contentId },
    orderBy: { createdAt: 'asc' },
    select: { type: true, provider: true, model: true, status: true, latencyMs: true, costJson: true, createdAt: true },
  })
  const videoGens = generations.filter((g) => g.type === 'video.shot')
  const imageGens = generations.filter((g) => g.type === 'image.shot')
  const byType = {}
  for (const g of generations) {
    byType[g.type] ??= { total: 0, succeeded: 0, latencies: [] }
    byType[g.type].total++
    if (g.status === 'succeeded') { byType[g.type].succeeded++; if (g.latencyMs) byType[g.type].latencies.push(g.latencyMs) }
  }
  const shotTimings = videoGens.map((g, i) => ({ shot: i + 1, status: g.status, latencyMs: g.latencyMs, provider: g.provider, model: g.model }))
  console.log(`\n[${ts()}] video.shot 记账：${videoGens.length} 次（成功 ${videoGens.filter((g) => g.status === 'succeeded').length}）`)
  for (const t of shotTimings) console.log(`  镜头${t.shot}: ${t.status} ${((t.latencyMs ?? 0) / 1000).toFixed(0)}s (${t.provider}/${t.model})`)

  // 3) 回落事件采集（Provenance: native-fallback）
  const fallbacks = await db.provenance.findMany({
    where: { contentId, model: 'native-fallback' },
    orderBy: { createdAt: 'asc' },
    select: { payloadJson: true, createdAt: true },
  })
  console.log(`[${ts()}] native 回落事件：${fallbacks.length} 次`)
  for (const f of fallbacks) { const p = JSON.parse(f.payloadJson ?? '{}'); console.log(`  镜头${(p.shotIndex ?? -1) + 1} 回落：${String(p.error ?? '').slice(0, 80)}`) }

  // 4) 成片与基线度量
  const finalAsset = await db.asset.findFirst({ where: { contentId, kind: 'final' }, orderBy: { createdAt: 'desc' } })
  const g3FinalAsset = await db.asset.findFirst({ where: { contentId: g3.contentId, kind: 'final' }, orderBy: { createdAt: 'desc' } })
  const nativePath = finalAsset ? resolve('storage/assets', finalAsset.storageLocation) : null
  const basePath = g3FinalAsset ? resolve('storage/assets', g3FinalAsset.storageLocation) : null

  let nativeMeasure = null
  let baselineMeasure = null
  if (nativePath && existsSync(nativePath)) {
    nativeMeasure = measureVideo('native-golden', nativePath, CASE_ID)
    console.log(`\n[${ts()}] Native 成片：${nativeMeasure.durationSec}s ${nativeMeasure.resolution} 帧内YDIF均值=${nativeMeasure.ydifInShot.mean} p95=${nativeMeasure.ydifInShot.p95}`)
  } else {
    console.log('✗ Native 成片缺失')
  }
  if (basePath && existsSync(basePath)) {
    baselineMeasure = measureVideo('composition-baseline(g3)', basePath, 'g3-father-baseline')
    console.log(`[${ts()}] Composition 基线（G3 父亲故事）：${baselineMeasure.durationSec}s 帧内YDIF均值=${baselineMeasure.ydifInShot.mean}`)
  }

  // 历史 9 案例组合式统计（重置前真实测量）
  let historical = null
  try { historical = JSON.parse(readFileSync('scripts/m15/state/visual-quality.json', 'utf8')) } catch { /* 无则跳过 */ }

  // 5) 镜头结构（首帧一致性 = 每镜 imageAsset 与 videoAsset 同源；结构来自最终版本）
  const finalVersion = await db.contentVersion.findFirst({ where: { contentId }, orderBy: { versionNumber: 'desc' } })
  const structure = JSON.parse(finalVersion?.structureJson ?? '{}')
  const shots = (structure?.story?.scenes ?? []).flatMap((s) => s.shots ?? [])
  const shotStructure = shots.map((sh, i) => ({ i: i + 1, cameraMotion: sh.cameraMotion ?? null, emotion: sh.emotion ?? null, narration: (sh.narrationLine ?? '').slice(0, 50) }))

  // 6) 汇总落盘
  const report = {
    caseId: CASE_ID,
    collectedAt: new Date().toISOString(),
    text: TEXT,
    contentId,
    shotCount: shots.length,
    forceNativeNote: 'dev server 以 IMAGINEOS_FORCE_NATIVE=1 运行；脚本仅驱动 HTTP，native 分支由服务端 worker 执行',
    generation: {
      byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { total: v.total, succeeded: v.succeeded, latencyMeanMs: v.latencies.length ? Math.round(v.latencies.reduce((a, b) => a + b, 0) / v.latencies.length) : null, latencyMaxMs: v.latencies.length ? Math.max(...v.latencies) : null }])),
      shotTimings,
      fallbackCount: fallbacks.length,
      fallbacks: fallbacks.map((f) => JSON.parse(f.payloadJson ?? '{}')),
    },
    shotStructure,
    visual: {
      native: nativeMeasure,
      compositionBaseline: baselineMeasure,
      ratio: nativeMeasure && baselineMeasure ? { ydifMean: +(nativeMeasure.ydifInShot.mean / (baselineMeasure.ydifInShot.mean || 1)).toFixed(2) } : null,
      historicalComposition: historical ? { caseCount: historical.caseCount, ydifInShotMeanAcrossCases: historical.ydifInShotMeanAcrossCases, note: '重置前真实测量（2026-10-06 04:1x）' } : null,
    },
    pipeline: finalState.elapsed ?? {},
    qualitative: {
      note: '人工观感评估（人物运动/环境运动/镜头运动/首帧一致性/角色一致性/场景连续性/音画关系/最终观感）由决策报告基于抽帧 + 成片回放填写，不自动生成结论',
      framesDir: 'scripts/m15/frames/g6-native',
    },
  }
  saveState(CASE_ID, { ...finalState, goldenReport: report })
  const { saveState: _s, ...rest } = { saveState: null }
  const fs = await import('node:fs')
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log(`\n[${ts()}] Golden Case 报告 → ${OUT}`)
  console.log(`[${ts()}] 镜头数=${shots.length} native成功=${videoGens.filter((g) => g.status === 'succeeded').length}/${videoGens.length} 回落=${fallbacks.length}`)
  await db.$disconnect()
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
