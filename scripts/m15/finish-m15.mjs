// scripts/m15/finish-m15.mjs —— Phase B 一键补跑（多 Provider 版）
// 通道现状（2026-10-06 联调后）：
//   LLM/Image/Video → agnes-com 自定义 Provider（已链路验证）；TTS → 无自定义（agnes 无 TTS 模型）→ z-ai 兜底
// 因此阻塞项收敛为：z-ai TTS 配额（p10/G3/G4 依赖）+ agnes 视频队列（Native Golden Case 依赖）
// 顺序：等 TTS → p10 收尾 → Gate3 修订链 → Gate4 Remix 链 → 等 agnes 视频 → Native Golden Case → 终版度量
// 幂等：全部子脚本断点续跑，可重复执行
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const FLAGS = join(process.cwd(), 'scripts/m15/state/flags')
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

async function ttsQuotaOk() {
  const ZAI = (await import('z-ai-web-dev-sdk')).default
  const zai = await ZAI.create()
  try {
    const response = await zai.audio.tts.create({ input: '好', voice: 'tongtong', response_format: 'wav' })
    const buf = Buffer.from(await response.arrayBuffer())
    return buf.length > 256
  } catch {
    return false
  }
}

async function waitTts(maxMinutes = 240) {
  // 优先看守望器旗（后台持续探测）；旗缺失时本地探测兜底
  const deadline = Date.now() + maxMinutes * 60_000
  let i = 0
  while (Date.now() < deadline) {
    if (existsSync(join(FLAGS, 'zai-tts-ok'))) return true
    if (await ttsQuotaOk()) return true
    i++
    console.log(`[${ts()}] z-ai TTS 未恢复（第 ${i} 次探测），120s 后重试…`)
    await new Promise((r) => setTimeout(r, 120_000))
  }
  return false
}

function videoQueueOk() {
  return existsSync(join(FLAGS, 'agnes-video-ok'))
}

function run(label, cmd) {
  console.log(`\n[${ts()}] ===== ${label} =====`)
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: process.cwd() })
  if (r.status !== 0) console.warn(`⚠ ${label} 退出码 ${r.status}（断点续跑可重试）`)
}

async function main() {
  console.log(`[${ts()}] M1.5 Phase B 补跑编排器（多 Provider 版）启动`)

  // ---- 阶段 1：TTS 依赖项（p10 / G3 / G4；TTS 也是 Native Golden Case 前置）----
  console.log(`[${ts()}] 等待 z-ai TTS 恢复（先短探 2 分钟，后长等待最长 4 小时）…`)
  const ttsOk = (await waitTts(2)) || (await waitTts(240))

  if (ttsOk) {
    console.log(`[${ts()}] ✓ z-ai TTS 已恢复，开始补跑 p10 / G3 / G4`)
    run('p10 收尾（含失败 Job regenerate 重入）', 'node scripts/m15/run-cases.mjs p10-cause')
    run('Gate 3 修订链（父亲故事四连改）', 'node scripts/m15/run-revision-chain.mjs')
    run('Gate 4 Remix 链（换母亲 + 再修改）', 'node scripts/m15/run-remix-chain.mjs')
  } else {
    console.log(`[${ts()}] TTS 全程未恢复（诚实记录：TTS 通道无可用 Provider——agnes 无 TTS 模型 + z-ai 429）`)
    console.log(`[${ts()}] p10/G3/G4/Native Golden Case 均无法执行（全部依赖 TTS），编排器结束。可用性恢复后重跑本脚本。`)
    process.exit(2)
  }

  // ---- 阶段 2：Native Golden Case（agnes 视频队列；队列未确认也尝试——失败回落自动记录）----
  if (videoQueueOk()) {
    console.log(`\n[${ts()}] agnes 视频队列已确认可用（守望器旗）`)
  } else {
    console.log(`\n[${ts()}] agnes 视频队列未确认——Native Golden Case 直接尝试（脚本内含失败回落与逐镜记账）`)
  }
  run('切 native 模式重启 dev server', 'bash scripts/m15/restart-dev.sh native')
  run('Gate 6b Native Golden Case（全镜 native）', 'node scripts/m15/run-native-golden.mjs')
  run('切回 composition 模式', 'bash scripts/m15/restart-dev.sh composition')

  // ---- 阶段 3：终版数据 ----
  run('Gate 5 终版完整性', 'node scripts/m15/integrity-check.mjs')
  run('Gate 6a 全量视觉度量', 'node scripts/m15/visual-quality.mjs')
  run('指标终版采集', 'node scripts/m15/collect-metrics.mjs')

  console.log(`\n[${ts()}] Phase B 补跑完成。报告更新点：§1.1 p10 行 / §3 Gate3 / §4 Gate4 / §5 §6 数据 / Gate6b Golden Case / Model Provider 章节`)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
