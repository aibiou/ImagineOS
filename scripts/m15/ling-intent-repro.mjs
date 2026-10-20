// 复现 #2：intent.extract 场景下 Ling-3.1-flash 的 message.content 缺失问题
// 完整复刻 completeJson 组装的 system + intent user prompt，转储原始 message 对象
const KEY = 'sk-studio-8428cf55ea9443c2b1ca1997edaab76e'

const INTENT_SYSTEM = `你是 ImagineOS 的意图理解引擎。用户会说一段自然语言（可能口语化、不完整、带情绪），你的任务是把它编译为结构化的创作意图（Intent Object）。

规则：
1. 只把用户明确表达过的字段标记为 "user"；你推断或补全的字段标记为 "ai_default"。宁可标记 ai_default 也不要臆测用户原意。
2. 用户没提的字段用合理的创作默认值补全（例如 duration: 45，format: "short_film"，visual_style: "cinematic_realism"，narration: true）。
3. topic 必填：用 15 字以内概括用户想表达的主题。
4. duration 单位是秒（数字）。45 秒视频 → 45。
5. emotion 是情绪词数组（中文），如 ["温暖", "怀旧"]。
6. characters 数组：用户提到的人物（含"我""父亲"等），name 用用户原词，description 一句话。
7. 若有关键信息缺失（时长/观众/情绪基调/用途），在 questions 里提出最多 3 个简短自然的问题（面向普通人，不使用任何专业术语）。信息充足时 questions 为空数组。

【输出格式（必须严格遵守）】
只输出一个 JSON 对象，不要输出任何解释、前后缀或 markdown 围栏。
目标 JSON 形态：
{
  "fields": {
    "topic": "string（必填，≤15字）",
    "purpose": "string? 创作用途",
    "emotion": ["情绪词"]?,
    "audience": "string? 给谁看",
    "tone": "string? 语气基调",
    "format": "short_film | vlog | documentary | explainer | ...",
    "duration": 45,
    "visual_style": "cinematic_realism | watercolor | anime | retro_film | ...",
    "narration": true,
    "creator_on_camera": false,
    "characters": [{ "name": "我", "description": "..." }],
    "references": ["用户提到的参照"],
    "constraints": ["用户提到的限制"]
  },
  "sources": { "topic": "user", "duration": "ai_default", "...": "user | ai_default（fields 的每个键都要标注）" },
  "questions": ["最多3个澄清问题，信息充足则空数组"]
}`

const USER = `用户表达：深夜便利店的一碗热汤面，治愈加班到凌晨的人`

async function call(label, extra) {
  const t0 = Date.now()
  const res = await fetch('https://api.ant-ling.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'Ling-3.1-flash',
      messages: [
        { role: 'system', content: INTENT_SYSTEM },
        { role: 'user', content: USER },
      ],
      temperature: 0.4,
      ...extra,
    }),
  })
  const ms = Date.now() - t0
  const j = await res.json().catch(() => ({}))
  console.log(`\n===== ${label}（${ms}ms，HTTP ${res.status}）=====`)
  console.log(`finish_reason=${j?.choices?.[0]?.finish_reason}`)
  console.log(`message keys=${Object.keys(j?.choices?.[0]?.message ?? {}).join(',')}`)
  console.log(`content 类型=${typeof j?.choices?.[0]?.message?.content}，值前120字=${JSON.stringify(j?.choices?.[0]?.message?.content)?.slice(0, 120)}`)
  console.log(`reasoning 长度=${(j?.choices?.[0]?.message?.reasoning_content ?? '').length}`)
  console.log(`usage=${JSON.stringify(j?.usage)}`)
}

// A：完全复刻 adapter（无 max_tokens）——预期复现 content 缺失
await call('A-无 max_tokens', {})
// B：给足 max_tokens —— 预期修复
await call('B-max_tokens=8192', { max_tokens: 8192 })
