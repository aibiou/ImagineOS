// 短剧手法库（reproducible-cinema-024 / 设计文档 §6）
// 回答「专业影视剧集剧情、短剧资源能否进编剧层」：不搬运版权剧本，把成熟手法提炼成可注入的语法。
// 手法来源（公开创作方法论，非剧本文本）：短剧工业化节奏共识（前 3 秒定去留、8–12s 一个信息点、
// 尾镜卡点留钩）、影视钩子类型学（悬念/反常/冲突/奇观）、三幕微结构既有实现。
// 设计纪律：纯数据 + 组装函数；注入点在 story.ts 的 system prompt（测试锁定存在性）。

/** 钩子四型（首 3 秒定去留——每一型给一个句式范例，LLM 学的是型不是句） */
export const HOOK_PATTERNS: ReadonlyArray<{ type: string; spec: string; example: string }> = [
  { type: '悬念型', spec: '把结果先亮出来，但不给原因', example: '「那天之后，他再也没进过那家面馆。」——为什么？观众必须知道。' },
  { type: '反常型', spec: '打破日常惯性，让寻常场景出现不寻常的细节', example: '「凌晨三点，面馆的灯还亮着，老板娘在给一副空碗筷摆两双筷子。」' },
  { type: '冲突型', spec: '欲望与阻碍当场相撞，不铺垫直接开打', example: '「爸，让我自己骑。」「我还没松手呢。」' },
  { type: '奇观型', spec: '一个值得盯住看三秒的强画面', example: '暴雨里的十字路口，唯一的红色雨披逆着人流站着。' },
]

/** 卡点结尾三钩（短剧「再看一集」的语法——单支短片的结尾余韵同一机制） */
export const CLIFFHANGER_PATTERNS: ReadonlyArray<{ type: string; spec: string; example: string }> = [
  { type: '悬念钩', spec: '抛出一个尚未回答的问题', example: '「直到今天我才知道，那晚他等了我多久。」' },
  { type: '情绪钩', spec: '把情绪顶到最高点戛然而止', example: '「我赢了。可我一点也不想赢。」' },
  { type: '反转钩', spec: '让观众以为自己看懂了，最后一个镜头推翻它', example: '「我回头想喊他——巷口空空的，车早就不在了。」' },
]

/** 节奏语法（信息密度基准） */
export const RHYTHM_RULES: ReadonlyArray<string> = [
  '每 8–12 秒必须出现一个新的信息点（新画面信息、新动作、或旁白反转）——观众感到「慢了」的本质是信息点断了',
  '高潮是全片镜头最短、切换最快的地方（3–5s 快切堆情绪）；release 是唯一允许「什么都不发生」的地方（留白 7–10s）',
  '旁白节拍与画面节拍错位：画面给事实，旁白给含义，同一信息不 doubled',
]

/** 注入 STORY_SYSTEM 的手法片段（钩子四型 + 尾场卡点） */
export function storyCraftFragment(): string {
  const hooks = HOOK_PATTERNS.map((h) => `  - ${h.type}（${h.spec}）：${h.example}`).join('\n')
  const cliffs = CLIFFHANGER_PATTERNS.map((c) => `  - ${c.type}（${c.spec}）：${c.example}`).join('\n')
  return `
钩子类型学（hook 场的写实基准——选一型做实，不要四型混杂）：
${hooks}

结尾卡点（release 场的最后一镜旁白必须是钩——给观众「带走的东西」或「没解完的念」）：
${cliffs}`
}

/** 注入 STORYBOARD_SYSTEM 的手法片段（节奏语法 + 尾镜卡点） */
export function storyboardCraftFragment(): string {
  const rules = RHYTHM_RULES.map((r) => `  - ${r}`).join('\n')
  const cliffs = CLIFFHANGER_PATTERNS.map((c) => `${c.type}`).join(' / ')
  return `
短剧节奏语法（硬性要求）：
${rules}
  - 末镜 narrationLine 必须是卡点钩（${cliffs}），不是总结陈词——总结是文案，钩是故事。`
}
