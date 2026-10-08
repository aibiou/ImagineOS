// 复现：Ling-3.1-flash 无 max_tokens 时 content 是否为空（推理烧预算假设）
// prompt 复刻 completeJson 真实组装：STORY_SYSTEM + 输出格式段 + userPrompt（src/ai/planning/story.ts）
const KEY = 'sk-studio-8428cf55ea9443c2b1ca1997edaab76e'

const SYSTEM = `你是 ImagineOS 的故事策划师。把选定的创作方向展开为一条可拍成短视频的故事。

规则：
1. logline：一句话故事（≤50字，具体、有画面感）。
2. emotionArc：情绪曲线，3–5 个节拍，每个节拍一个情绪词（如 ["平静","怀念","涌动","温暖"]）。
3. narrationStyle：旁白风格描述（第一人称/第三人称、口语/诗意，≤20字）。
4. scenes：2–4 个场景，每个含 summary（这个场景发生什么，≤40字）与 location（地点）。
5. 为普通人写作：具体、真诚，避免空洞形容词。

【输出格式（必须严格遵守）】
只输出一个 JSON 对象，不要输出任何解释、前后缀或 markdown 围栏。
目标 JSON 形态：
{
  "logline": "string",
  "narrationStyle": "string",
  "emotionArc": ["平静", "怀念", "温暖"],
  "scenes": [
    { "index": 0, "summary": "夏夜巷口，父亲扶着我第一次骑车", "location": "老巷口" }
  ]
}`

const USER = `创作意图：主题「深夜便利店的一碗热汤面，治愈加班到凌晨的人」，约 45 秒，期望情绪 温暖、治愈、安静
选定创作方向：「关东煮的热气」——深夜便利店里，一碗关东煮的热气成为两个陌生人之间无声的温柔。（情绪：温暖）（视觉：暖色调、蒸汽、安静的城市夜晚）

请展开故事。`

async function call(label, body) {
  const t0 = Date.now()
  const res = await fetch('https://api.ant-ling.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'Ling-3.1-flash', messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: USER },
    ], temperature: 0.4, ...body }),
  })
  const ms = Date.now() - t0
  const j = await res.json().catch(() => ({}))
  const msg = j?.choices?.[0]?.message ?? {}
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
  const reasoning = typeof msg.reasoning_content === 'string' ? msg.reasoning_content : ''
  console.log(`\n===== ${label}（${ms}ms，HTTP ${res.status}）=====`)
  console.log(`finish_reason=${j?.choices?.[0]?.finish_reason}`)
  console.log(`content 长度=${content?.length ?? 0}，reasoning 长度=${reasoning.length}`)
  console.log(`usage=${JSON.stringify(j?.usage)}`)
  console.log(`content 前200字：${content?.slice(0, 200) ?? '(空)'}`)
}

// A：完全模拟 adapter（无 max_tokens）
await call('A-无 max_tokens（复刻 adapter）', {})
// B：显式给足 max_tokens（假设修复方案）
await call('B-max_tokens=8192', { max_tokens: 8192 })
