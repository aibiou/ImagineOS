// scripts/m15/visual-quality.mjs —— Gate 6a：组合式管线视觉质量的客观度量
// 核心判据：帧间差分（YDIF）——Ken Burns 运镜产生的全局缓动 YDIF 显著低于真实视频运动；
//           freezedetect 检出完全静止段；scene 切换检测转场位置。
// 用法：node scripts/m15/visual-quality.mjs [videoPath ...]（缺省 = 全部 M1.5 案例成片）
import { execFileSync } from 'node:child_process'
import { readdirSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const OUT = 'scripts/m15/state/visual-quality.json'
const FRAMES_DIR = 'scripts/m15/frames'

function ff(args) {
  return execFileSync('ffmpeg', args, { maxBuffer: 64 * 1024 * 1024 }).toString()
}

/** 解析逐帧 YDIF（signalstats） */
function frameMetrics(videoPath) {
  const stdout = ff([
    '-i', videoPath,
    '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=-',
    '-f', 'null', '-',
  ])
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

/** freezedetect（静止段） */
function frozenSegments(videoPath) {
  try {
    const stdout = execFileSync('ffmpeg', [
      '-i', videoPath, '-vf', 'freezedetect=n=0.003:d=1', '-f', 'null', '-',
    ], { maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    const segs = []
    for (const line of stdout.split('\n')) {
      const m = line.match(/freezedetect.*start:\s*([\d.]+)/)
      if (m) segs.push(+m[1])
    }
    return segs
  } catch (e) {
    const stderr = e.stderr?.toString() ?? ''
    const segs = []
    for (const line of stderr.split('\n')) {
      const m = line.match(/freezedetect.*start:\s*([\d.]+)/)
      if (m) segs.push(+m[1])
    }
    return segs
  }
}

/** probe */
function probe(videoPath) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration,size,bit_rate:stream=width,height,codec_name,r_frame_rate',
    '-of', 'json', videoPath,
  ]).toString()
  return JSON.parse(out)
}

/** 抽帧（每 4s 一帧，供人工视觉检查） */
function extractFrames(videoPath, caseId) {
  const dir = join(FRAMES_DIR, caseId)
  mkdirSync(dir, { recursive: true })
  execFileSync('ffmpeg', ['-y', '-i', videoPath, '-vf', 'fps=1/4', join(dir, 'f%02d.jpg')])
  return readdirSync(dir).length
}

async function main() {
  // 定位全部 M1.5 案例成片（final 资产 + 所属 case 映射）
  const stateFiles = readdirSync('scripts/m15/state').filter((f) => /^p\d+.*\.json$/.test(f))
  const cases = []
  for (const f of stateFiles) {
    const s = JSON.parse(readFileSync(join('scripts/m15/state', f), 'utf8'))
    if (!s.contentId) continue
    const finalAsset = await db.asset.findFirst({
      where: { contentId: s.contentId, kind: 'final' },
      orderBy: { createdAt: 'desc' },
    })
    if (!finalAsset) continue
    cases.push({ caseId: s.caseId ?? f.replace('.json', ''), phase: s.phase, path: resolve('storage/assets', finalAsset.storageLocation), sizeBytes: finalAsset.sizeBytes })
  }
  console.log(`定位到 ${cases.length} 个成片`)

  const results = []
  for (const c of cases) {
    if (!existsSync(c.path)) { console.log(`✗ ${c.caseId}: 文件缺失`); continue }
    const t0 = Date.now()
    const rows = frameMetrics(c.path)
    const ydifs = rows.map((r) => r.ydif)
    // 转场带来的大跳变（YDIF 高于 p95*3 的帧视为切镜，剔除后看“镜头内”运动）
    const base = ydifs.filter((v) => v < Math.max(...ydifs) * 0.3)
    const frozen = frozenSegments(c.path)
    const meta = probe(c.path)
    const frameCount = extractFrames(c.path, c.caseId)
    const r = {
      caseId: c.caseId,
      phase: c.phase,
      file: c.path.split('/').pop(),
      durationSec: +(+JSON.stringify(meta.format?.duration ?? 0)).toFixed(1) || Math.round(+(meta.format?.duration ?? 0)),
      resolution: `${meta.streams?.[0]?.width}x${meta.streams?.[0]?.height}`,
      frames: rows.length,
      extractedThumbs: frameCount,
      ydifAll: stats(ydifs),
      ydifInShot: stats(base), // 剔除切镜帧后的镜头内运动
      frozenSegments: frozen,
      analyzeMs: Date.now() - t0,
    }
    results.push(r)
    console.log(`✓ ${c.caseId}: ${r.durationSec}s ${r.resolution} 帧内YDIF均值=${r.ydifInShot.mean} p95=${r.ydifInShot.p95} 静止段=${frozen.length}`)
  }

  // 汇总
  const inShot = results.flatMap((r) => [r.ydifInShot.mean])
  const summary = {
    analyzedAt: new Date().toISOString(),
    caseCount: results.length,
    ydifInShotMeanAcrossCases: stats(inShot),
    casesWithFrozenSegments: results.filter((r) => r.frozenSegments.length > 0).map((r) => r.caseId),
    cases: results,
  }
  writeFileSync(OUT, JSON.stringify(summary, null, 2))
  console.log(`\n汇总 → ${OUT}`)
  console.log(JSON.stringify({ 案例数: summary.caseCount, 镜头内YDIF均值: summary.ydifInShotMeanAcrossCases, 含静止段案例: summary.casesWithFrozenSegments }, null, 2))
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
