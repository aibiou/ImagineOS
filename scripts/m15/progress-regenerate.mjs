// scripts/m15/progress-regenerate.mjs —— regenerate 轮：争取 native 视频到达以验证
// 「AI 视频一到即可点播」的 Lightbox 视频路径（本轮目标：≥1 videoUrl）
// 断点续跑：state 独立落盘 scripts/m15/state/progress-regen.json
import { Client, loadState, saveState, sleep } from './lib.mjs'

const CASE_ID = 'progress-visibility' // 复用同一内容的作者会话
const REGEN_STATE = 'progress-regen'
const state = loadState(REGEN_STATE) ?? { phase: 'init', evidence: {} }
const base = loadState(CASE_ID)
if (!base?.contentId) throw new Error('先跑 progress-visibility-e2e.mjs drive')
const contentId = base.contentId
const client = new Client('progress-regen')
client.restore(base.cookies)

const now = () => new Date().toISOString()
const persist = () => saveState(REGEN_STATE, state)

async function poll() {
  return client.get(`/api/contents/${contentId}/creation`)
}

// 段1：发起 regenerate（REVIEW 态合法）
if (state.phase === 'init') {
  const res = await client.post(`/api/contents/${contentId}/regenerate`, {})
  state.evidence.regenerateAcceptedAt = now()
  state.evidence.regenJobId = res.jobId
  console.log(`[regen] 入队 ✓ jobId=${res.jobId}`)
  state.phase = 'regenerating'
  persist()
}

// 段2：轮询直到首个 videoUrl 出现（或全部回落/到 REVIEW）
if (state.phase === 'regenerating') {
  const start = Date.now()
  while (Date.now() - start < 540_000) {
    const data = await poll()
    const shots = data.assets?.shots ?? []
    const withVideo = shots.filter((s) => s.videoUrl)
    const withFallback = shots.filter((s) => s.videoFallback)
    const withImage = shots.filter((s) => s.imageUrl)
    if (withVideo.length > 0 && !state.evidence.firstVideo) {
      state.evidence.firstVideo = {
        at: now(),
        elapsed: `${((Date.now() - Date.parse(state.evidence.regenerateAcceptedAt)) / 1000).toFixed(0)}s`,
        shotIndexes: withVideo.map((s) => s.shotIndex),
        videoUrls: withVideo.map((s) => s.videoUrl),
      }
      console.log(`[regen] AI 视频到达 ✓ shots=${state.evidence.firstVideo.shotIndexes}（+${state.evidence.firstVideo.elapsed}）`)
      state.phase = 'videoSeen'
      persist()
      break
    }
    if (data.job && (data.job.status === 'failed' || data.job.status === 'timeout')) {
      throw new Error(`regenerate Job 失败：${String(data.job.error).slice(0, 200)}`)
    }
    if (data.content.status === 'REVIEW' && withImage.length > 0 && withFallback.length === withImage.length) {
      console.log('[regen] 全部回落（供给窗口仍 429）——诚实边界，视频路径以单测+组件断言为准')
      state.evidence.allFallback = { at: now(), fallbacks: withFallback.map((s) => s.shotIndex) }
      state.phase = 'videoSeen'
      persist()
      break
    }
    await sleep(3000)
  }
}

if (state.phase === 'videoSeen') {
  console.log(JSON.stringify(state.evidence, null, 2))
}
