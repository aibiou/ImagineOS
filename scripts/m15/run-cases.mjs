// scripts/m15/run-cases.mjs —— Gate 1 + Gate 2：10 个真实创作案例（3 范式）
// 用法：node scripts/m15/run-cases.mjs [caseId]（不带参数跑全部）
// 每案例 = 真实 HTTP 全链（intent→directions→select→story→storyboard→generate→render→publish），零 mock。
import { Client, driveCase, loadState, saveState, blankState } from './lib.mjs'

// 10 类型 × 3 范式（A 写实/现实 ×4，B 电影故事 ×3，C 强想象 ×3）
export const CASES = [
  {
    id: 'p01-persona',
    type: '人物故事', paradigm: 'A-写实',
    text: '我想做一个 45 秒的视频，讲我外婆的一生。她 82 岁了，一辈子都在江南小镇上度过，年轻时是镇上最好的裁缝。',
    preferKeywords: ['写实', '朴素', '真实', '纪录片'],
  },
  {
    id: 'p02-family',
    type: '家庭回忆', paradigm: 'A-写实',
    text: '我想做一个视频，记录我们家每个周日一起做晚饭的传统。三代人挤在一个小厨房里，切菜声和笑声混在一起。',
    preferKeywords: ['写实', '温暖', '日常'],
  },
  {
    id: 'p03-travel',
    type: '旅行', paradigm: 'A-写实',
    text: '我想把我在川西高原看到星空的那一晚做成一个视频。海拔四千米，风很冷，银河就悬在头顶，安静得能听见自己的心跳。',
    preferKeywords: ['写实', '星空', '沉浸'],
  },
  {
    id: 'p04-knowledge',
    type: '知识', paradigm: 'A-写实',
    text: '我想做一个 30 秒的视频，给孩子解释为什么天空是蓝色的。要简单、好看、能看懂。',
    preferKeywords: ['清晰', '科普', '简单'],
  },
  {
    id: 'p05-mood',
    type: '情绪', paradigm: 'B-电影故事',
    text: '我想表达我最近的状态：工作压力很大，在城市里感觉喘不过气，但还在咬牙坚持。',
    preferKeywords: ['电影', '情绪', '氛围'],
  },
  {
    id: 'p06-dream',
    type: '梦境', paradigm: 'C-强想象',
    text: '我梦见自己变成了一滴水，从云里落到城市屋顶，流过街道，最后汇进大海。我想把这个梦做成视频。',
    preferKeywords: ['超现实', '梦境', '想象'],
  },
  {
    id: 'p07-future',
    type: '未来想象', paradigm: 'C-强想象',
    text: '我想做一个视频，想象 2085 年普通人的一天：城市、交通、人们怎么生活、怎么彼此相处。',
    preferKeywords: ['未来', '科幻', '想象'],
  },
  {
    id: 'p08-scifi',
    type: '科幻', paradigm: 'C-强想象',
    text: '我想做一个科幻短片：人类最后一枚火箭发射升空的清晨，整个地球安静地目送它离开。',
    preferKeywords: ['科幻', '史诗', '宏大'],
  },
  {
    id: 'p09-product',
    type: '产品介绍', paradigm: 'B-电影故事',
    text: '我想给我们的手工咖啡品牌做一个 30 秒介绍视频，主题是慢下来的生活：豆子、水流、晨光。',
    preferKeywords: ['质感', '电影', '商业'],
  },
  {
    id: 'p10-cause',
    type: '公益/帮助', paradigm: 'B-电影故事',
    text: '我想做一个视频，呼吁大家关注身边的流浪动物。冬天快到了，它们需要一个纸箱、一碗水和一点点善意。',
    preferKeywords: ['温情', '电影', '叙事'],
  },
]

const CONCURRENCY = 2

async function runOne(c) {
  const client = new Client(`case-${c.id}`)
  const t0 = Date.now()
  console.log(`[${ts()}] ▶ ${c.id}（${c.type} · ${c.paradigm}）开始`)
  try {
    const state = await driveCase(client, c.id, {
      text: c.text,
      preferKeywords: c.preferKeywords,
    })
    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    console.log(`[${ts()}] ✓ ${c.id} 已发布（${secs}s）contentId=${state.contentId} 镜头=${state.record?.storyboard?.shotCount ?? '?'} 成片=${state.record?.final?.durationMs ?? '?'}ms`)
  } catch (e) {
    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    console.error(`[${ts()}] ✗ ${c.id} 失败（${secs}s）：${e.message}`)
    const state = loadState(c.id) ?? blankState(c.id, { text: c.text })
    state.lastError = { message: e.message, at: new Date().toISOString() }
    saveState(c.id, state)
  }
}

function ts() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

async function main() {
  const only = process.argv[2]
  const list = only ? CASES.filter((c) => c.id === only) : CASES
  console.log(`[${ts()}] M1.5 Gate1+2：${list.length} 个案例，并发 ${CONCURRENCY}`)
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(runOne))
  }
  // 汇总
  const done = list.filter((c) => loadState(c.id)?.phase === 'published').length
  console.log(`[${ts()}] 完成：${done}/${list.length} 已发布`)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
