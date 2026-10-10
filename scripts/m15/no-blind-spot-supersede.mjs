// 025 战线二②补充验证：feedback #1 运行中重提 feedback #2 → supersede 实证
// （主 E2E 已等 #1 完成再提 #2——那是「无活跃 Job」分支；本脚本覆盖真正的取代分支）
import { PrismaClient } from '@prisma/client'
import { Client } from './lib.mjs'

const db = new PrismaClient()
const state = JSON.parse((await import('node:fs')).readFileSync('scripts/m15/state/no-blind-spot.json', 'utf8'))
const client = new Client('no-blind-spot')
client.restore(state.cookies)
const id = state.contentId

const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` —— ${detail}` : ''}`)
}

try {
  // 1) 提交反馈 A（Job 开始跑）
  const rA = await client.post(`/api/contents/${id}/revision/plan`, { feedback: '画面整体再亮一点' })
  ok('提交 A：入队即返', !!rA.jobId, `jobA=${rA.jobId?.slice(-6)}`)

  // 2) 立即（运行中）改主意提交反馈 B → 应取代 A
  const rB = await client.post(`/api/contents/${id}/revision/plan`, { feedback: '旁白语气再温柔一点' })
  ok('运行中重提 B：supersededJobId=A', rB.supersededJobId === rA.jobId && !!rB.jobId, `old=${rB.supersededJobId?.slice(-6)} new=${rB.jobId?.slice(-6)}`)

  // 3) 旧 Job 终态 failed + 人话原因（即使执行器稍后返回也翻不回）
  const oldJob = await client.get(`/api/contents/${id}/revision/plan?jobId=${rA.jobId}`)
  ok('A 终态 failed + 取代原因', oldJob?.status === 'failed' && String(oldJob?.error ?? '').includes('已被新的修订请求取代'), oldJob?.error)

  // 4) B 的 plan 正常到达（取代不阻塞新工作）
  let planB = null
  for (let i = 0; i < 90 && !planB; i++) {
    await new Promise((r) => setTimeout(r, 2500))
    const j = await client.get(`/api/contents/${id}/revision/plan?jobId=${rB.jobId}`)
    if (j?.status === 'succeeded' && j?.plan) planB = j
    if (j?.status === 'failed') throw new Error(`B 失败：${j.error}`)
  }
  ok('B plan 到达（取代不阻塞新反馈）', !!planB?.plan?.targetLevel, `targetLevel=${planB?.plan?.targetLevel} summary=${planB?.plan?.summary}`)

  const passed = results.filter((r) => r.pass).length
  console.log(`\n===== supersede 补充验证：${passed}/${results.length} =====`)
  process.exitCode = results.every((r) => r.pass) ? 0 : 1
} catch (e) {
  console.error(`中断：${e.message}`)
  process.exitCode = 2
} finally {
  await db.$disconnect()
}
