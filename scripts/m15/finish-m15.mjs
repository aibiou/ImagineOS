// scripts/m15/finish-m15.mjs —— 配额恢复后一键补跑全部阻塞项
// 顺序：探测配额 → p10 收尾 → Gate3 修订链 → Gate4 Remix 链 → 终版完整性 + 指标 + 视觉度量
// 幂等：全部子脚本断点续跑，可重复执行
import { execFileSync, spawnSync } from 'node:child_process'

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

async function quotaOk() {
  const ZAI = (await import('z-ai-web-dev-sdk')).default
  const zai = await ZAI.create()
  try {
    await zai.images.generations.create({ prompt: 'a tiny red leaf, minimal', size: '768x1344' })
    return true
  } catch {
    return false
  }
}

async function waitQuota(maxMinutes = 90) {
  const deadline = Date.now() + maxMinutes * 60_000
  let i = 0
  while (Date.now() < deadline) {
    if (await quotaOk()) return true
    i++
    console.log(`[${ts()}] 配额未恢复（第 ${i} 次探测），90s 后重试…`)
    await new Promise((r) => setTimeout(r, 90_000))
  }
  return false
}

function run(label, cmd) {
  console.log(`\n[${ts()}] ===== ${label} =====`)
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: process.cwd() })
  if (r.status !== 0) console.warn(`⚠ ${label} 退出码 ${r.status}（断点续跑可重试）`)
}

async function main() {
  console.log(`[${ts()}] M1.5 补跑编排器启动`)
  if (!(await waitQuota())) {
    console.log('配额 90 分钟内未恢复，退出（稍后重跑本脚本）')
    process.exit(1)
  }
  console.log(`[${ts()}] ✓ 配额已恢复，开始补跑`)

  run('p10 收尾', 'node scripts/m15/run-cases.mjs p10-cause')
  run('Gate 3 修订链（父亲故事四连改）', 'node scripts/m15/run-revision-chain.mjs')
  run('Gate 4 Remix 链（换母亲 + 再修改）', 'node scripts/m15/run-remix-chain.mjs')
  run('Gate 5 终版完整性', 'node scripts/m15/integrity-check.mjs')
  run('Gate 6a 全量视觉度量', 'node scripts/m15/visual-quality.mjs')
  run('指标终版采集', 'node scripts/m15/collect-metrics.mjs')

  console.log(`\n[${ts()}] 补跑完成。报告更新点：§1.1 p10 行 / §3 Gate3 / §4 Gate4 / §5 §6 数据`)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
