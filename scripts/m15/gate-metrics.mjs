// 质量门合格率度量（验收标准 #3，设计 docs/design/quality-reproduction.md §5）
// 数据源：Provenance（model=quality-gate 逐镜事件）+ Generation（type=vision.review 账本）
// 输出：单镜一次通过率 / 重抽分布 / 平均综合分 / 视频严格缺陷率 / 范例沉淀量——后续迭代的基线数字。
// 用法：node scripts/m15/gate-metrics.mjs [contentId]（缺省全库）
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const contentId = process.argv[2]
  const where = contentId ? { contentId } : {}

  const gateEvents = await db.provenance.findMany({
    where: { ...where, model: 'quality-gate' },
    orderBy: { createdAt: 'asc' },
  })
  const visionRows = await db.generation.findMany({
    where: { ...where, type: 'vision.review' },
    orderBy: { createdAt: 'asc' },
  })
  const exemplars = await db.shotExemplar.groupBy({ by: ['contentId'], _count: { _all: true } })

  console.log('========== 质量门度量（单镜合格率基线） ==========')
  if (gateEvents.length === 0) {
    console.log('尚无 quality-gate 事件（还没跑过带质量门的生成）')
  } else {
    const parsed = gateEvents.map((e) => {
      try {
        return JSON.parse(e.payloadJson ?? '{}')
      } catch {
        return {}
      }
    })
    const imageGates = parsed.filter((p) => p.stage === 'image.gate')
    const total = imageGates.length
    const firstPass = imageGates.filter((p) => p.attempts === 1 && p.pass).length
    const passed = imageGates.filter((p) => p.pass).length
    const skipped = imageGates.filter((p) => p.skipped).length
    const regen = imageGates.filter((p) => p.attempts > 1)
    const scores = imageGates.filter((p) => typeof p.score === 'number').map((p) => p.score)
    const avg = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 'n/a'
    console.log(`图像门：镜头数 ${total}｜一次通过 ${firstPass}（${total > 0 ? ((firstPass / total) * 100).toFixed(0) : 0}%）｜最终通过 ${passed}/${total}｜skipped(评审不可用) ${skipped}`)
    console.log(`重抽分布：1 次 ${imageGates.filter((p) => p.attempts === 1).length}｜2 次 ${imageGates.filter((p) => p.attempts === 2).length}｜3 次 ${imageGates.filter((p) => p.attempts === 3).length}`)
    console.log(`平均综合分：${avg}（满分 10）`)
    if (regen.length > 0) {
      const issues = regen.flatMap((p) => p.issues ?? []).slice(0, 8)
      console.log(`重抽镜头的典型问题：${issues.join('；') || '(未记录)'}`)
    }
  }

  const videoVision = visionRows.filter((r) => (r.inputJson ?? '').includes('gate.video'))
  console.log(`\nvision.review 账本：共 ${visionRows.length} 次（视频门 ${videoVision.length}）；成功 ${visionRows.filter((r) => r.status === 'succeeded').length}｜失败 ${visionRows.filter((r) => r.status === 'failed').length}`)
  const reproRows = await db.generation.findMany({
    where: { ...where, type: 'video.shot', status: 'succeeded' },
  })
  const withRepro = reproRows.filter((r) => (r.outputJson ?? '').includes('repro')).length
  console.log(`video.shot 成功 ${reproRows.length} 次，携带 repro 复现参数 ${withRepro} 次（${reproRows.length > 0 ? ((withRepro / reproRows.length) * 100).toFixed(0) : 0}%）`)

  const promptHashRows = await db.generation.findMany({
    where: { ...where, type: 'image.shot', status: 'succeeded' },
  })
  const withHash = promptHashRows.filter((r) => (r.inputJson ?? '').includes('promptHash')).length
  console.log(`image.shot 成功 ${promptHashRows.length} 次，携带 promptHash ${withHash} 次`)

  console.log(`\n范例库：${exemplars.length} 个作品共 ${exemplars.reduce((a, b) => a + b._count._all, 0)} 条高分镜头`)
  if (contentId) {
    const rows = await db.shotExemplar.findMany({ where: { contentId }, orderBy: { shotIndex: 'asc' } })
    for (const r of rows) {
      const s = JSON.parse(r.scoreJson)
      console.log(`  镜 ${r.shotIndex + 1}：${s.score} 分｜promptHash ${r.promptHash}`)
    }
  }

  // 零回落证据（取缔 Ken Burns 的验收口径）
  const fallbacks = await db.provenance.count({ where: { ...where, model: 'native-fallback' } })
  console.log(`\nKen Burns 回落事件（应恒为 0）：${fallbacks}`)
}

main().finally(() => db.$disconnect())
