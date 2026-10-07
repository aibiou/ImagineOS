// scripts/m15/gate7-rehearsal.mjs —— Gate 7 执行阶段系统侧预演（2 个多样化匿名会话并发全链）
// 用法：node scripts/m15/gate7-rehearsal.mjs [caseId]（不带参数并发跑全部；带 caseId 单跑=断点续跑）
//
// 定位声明（重要）：本预演为机器侧管道与环境就绪验证（human-test-plan.md §10 Pre-flight 的深化），
// **不是 Gate 7 真人数据**——六指标的人工编码字段（首反应/访谈确认/修订语境）不可由脚本产生，
// 也不得用于填充 m15-human-test-report.md 的人工字段。
// 预演用户创建于今日；真人测试导出用 --since=<真人测试开始时刻>，预演会话自动排除（时间窗隔离）。
//
// 验证目标（与真人测试日同路径）：
//   ① 全新匿名会话（无 cookie 恢复）→ 独立 User → 全链至发布——测试日每位被试即此形态
//   ② 双会话并发——测试日两位被试同时创作的真实并发（SQLite 写锁 + 30s 事务超时修复的真实考验）
//   ③ 预演窗口 --since 导出 + idsFile 批量完整性复核——观察员测试后将执行的完全相同命令
// 幂等：state 落盘断点续跑（lib.mjs），重跑跳过已完成阶段。
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, driveCase } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WINDOW_FILE = join(HERE, 'state', 'gate7-rehearsal-window.json')

// 预演被试人设（对应计划 §2 配额维度：年龄分布 × 题材分布；与 p01-p10 题材不重叠）
export const REHEARSAL_CASES = [
  {
    id: 'g7r1-mom60',
    persona: '预演 R1（配额维度：45+ / 家庭回忆 / 生日礼物场景）',
    text: '我妈下个月六十岁生日。她开了一辈子小卖部，把我们三个拉扯大。我想做一个视频，在她生日那天放给全家人看。',
    preferKeywords: ['温暖', '真实', '亲情'],
  },
  {
    id: 'g7r2-nightroad',
    persona: '预演 R2（配额维度：20-30 / 情绪 / 城市夜归场景）',
    text: '最近老是加班到半夜。想做一个视频，记录凌晨下班那条路：路灯、便利店的光、还有没什么车的街口。',
    preferKeywords: ['安静', '城市', '情绪'],
  },
]

// 预演窗口起点（首次运行写入，重跑保持原值——导出作用域以最早起点计）
if (!existsSync(WINDOW_FILE)) {
  writeFileSync(WINDOW_FILE, JSON.stringify({ startedAt: new Date().toISOString(), note: 'Gate 7 系统侧预演窗口（非真人测试窗口）' }, null, 2))
}
const window_ = JSON.parse(readFileSync(WINDOW_FILE, 'utf8'))

const only = process.argv[2]
const cases = only ? REHEARSAL_CASES.filter((c) => c.id === only) : REHEARSAL_CASES
if (cases.length === 0) { console.error(`未知 caseId：${only}（可用：${REHEARSAL_CASES.map((c) => c.id).join(' / ')}）`); process.exit(1) }

function ts() { return new Date().toISOString().slice(11, 19) }

async function runOne(c) {
  const client = new Client(`rehearsal-${c.id}`) // 全新会话 = 全新匿名 User（不 restore 任何旧 cookie）
  const t0 = Date.now()
  console.log(`[${ts()}] ▶ ${c.id} 开始（${c.persona}）`)
  try {
    const state = await driveCase(client, c.id, { text: c.text, preferKeywords: c.preferKeywords })
    console.log(`[${ts()}] ✔ ${c.id} 完成：phase=${state.phase} contentId=${state.contentId} 耗时=${Math.round((Date.now() - t0) / 1000)}s`)
    return { id: c.id, ok: true, contentId: state.contentId, phase: state.phase, elapsedSec: Math.round((Date.now() - t0) / 1000) }
  } catch (e) {
    console.error(`[${ts()}] ✘ ${c.id} 失败：${String(e.message ?? e).slice(0, 300)}`)
    return { id: c.id, ok: false, error: String(e.message ?? e).slice(0, 300) }
  }
}

console.log(`Gate 7 系统侧预演：${cases.length} 个匿名会话（并发）｜窗口起点 ${window_.startedAt}`)
const t0 = Date.now()
const results = await Promise.all(cases.map(runOne))
const okCount = results.filter((r) => r.ok).length

console.log(`\n===== 预演结果：${okCount}/${cases.length} 会话发布成功，总耗时 ${Math.round((Date.now() - t0) / 1000)}s =====`)
for (const r of results) {
  console.log(r.ok ? `  ✔ ${r.id} → ${r.contentId}（${r.elapsedSec}s）` : `  ✘ ${r.id}：${r.error}`)
}
console.log(`\n导出演练命令（观察员测试日将执行的同款）：`)
console.log(`  node scripts/m15/export-human-test.mjs --since="${window_.startedAt}"`)

// 结果落盘（报告引用 + 断点记录）
writeFileSync(join(HERE, 'state', 'gate7-rehearsal-result.json'), JSON.stringify({
  windowStart: window_.startedAt,
  ranAt: new Date().toISOString(),
  mode: 'concurrent-2-sessions',
  results,
}, null, 2))

if (okCount < cases.length) process.exit(2)
