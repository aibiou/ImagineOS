// scripts/m15/reproducible-cinema-continue.mjs —— 024 E2E 续跑守护（健壮版 v2）
// 语义同 v1；改进：全程 try/catch（单轮异常不退出）+ appendFileSync 心跳（抗 stdout 缓冲）+
// 心跳每 60s 一条（可观测）。setsid 运行扛工具会话超时。
// 用法：setsid node scripts/m15/reproducible-cinema-continue.mjs > /tmp/rc024-cont2.log 2>&1 &
import { appendFileSync } from 'node:fs'
import { Client, loadState, sleep } from './lib.mjs'

const CASE_ID = 'reproducible-cinema'
const LOG = '/tmp/rc024-cont2.log'
const state = loadState(CASE_ID)
if (!state?.contentId) throw new Error('state 缺失 contentId（先跑 drive）')
const client = new Client(CASE_ID)
client.restore(state.cookies)

const LIMIT_MS = 100 * 60_000 // 供给恢复窗口最长等 100 分钟
const start = Date.now()
let rounds = 0
let beats = 0
const log = (m) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${m}`
  console.log(line)
  try { appendFileSync(LOG, line + '\n') } catch {}
}

while (Date.now() - start < LIMIT_MS) {
  try {
    const data = await client.get(`/api/contents/${state.contentId}/creation`)
    if (data.content.status === 'REVIEW') {
      log('REVIEW ✓ 退出守护')
      break
    }
    if (data.content.status !== 'GENERATING') {
      log(`状态 ${data.content.status}（非 GENERATING，退出）`)
      break
    }
    const job = data.job
    const failed = job && (job.status === 'failed' || job.status === 'timeout')
    const stalled = !job
    if (failed || stalled) {
      rounds++
      log(`检测到${failed ? '失败' : '僵死'}态 → regenerate 第 ${rounds} 轮（${String(job?.error ?? data.lastError?.message ?? '').slice(0, 80)}）`)
      const reg = await client.post(`/api/contents/${state.contentId}/regenerate`, {})
      const after = await client.get(`/api/contents/${state.contentId}/creation`)
      log(`regenerate → jobType=${after.job?.type} ${after.job?.type === 'video.resume' ? '断点续跑 ✓' : ''}（jobId=${reg.jobId}）`)
    } else if (++beats % 6 === 0) {
      log(`心跳：${job?.type}/${job?.status}「${String(job?.label ?? '').slice(0, 40)}」`)
    }
  } catch (e) {
    log(`本轮异常（继续）：${String(e.message).slice(0, 120)}`)
  }
  await sleep(10_000)
}
log(`守护结束（rounds=${rounds}）`)
