// 模型目录排序（纯函数，客户端与测试共享；不依赖 db / @/ai——可安全进客户端包）
// 目标：/models 拉回的列表可能混有对话/图像/配音/视频/嵌入模型，
//       按通道把「疑似该通道用途」的模型排前（推荐组），其余归入「其他」组，
//       仅排序不过滤——判定交给用户（命名不可靠，硬过滤会误伤）。

export interface GroupedModels {
  recommended: string[]
  others: string[]
}

/** 各通道「疑似匹配」命名模式（宽松正则，宁可多推荐不可漏） */
const CHANNEL_PATTERNS: Record<string, RegExp[]> = {
  llm: [
    /gpt|o1|o3|o4|claude|deepseek|qwen|glm|llama|mistral|kimi|moonshot|ernie|grok|doubao|minimax|abab|baichuan|yi-|chat|instruct|aquila|llm|hunyuan-(?!video)/i,
  ],
  image: [
    /cogview|kolors|dall-?e|gpt-image|flux|stable|sd3|sdxl|imagen|wanx|seedream|irag|image|irag|photo/i,
  ],
  tts: [
    /tts|cosyvoice|speech|voice|audio|f5|magnet|fish/i,
  ],
  video: [
    /t2v|i2v|video|wan|kling|cogvideo|ltx|hunyuan-video|seedance|vidu/i,
  ],
}

/** llm 通道的排除模式：命中即降入「其他」（避免 gpt-image 误进推荐组） */
const LLM_EXCLUDE = /embedding|rerank|bge-|gte-|whisper|tts|speech|cosyvoice|audio|kolors|cogview|dall-?e|gpt-image|flux|stable|sd3|sdxl|wan2|t2v|i2v|video|moderation|transcribe/i

function matchesAny(patterns: RegExp[], name: string): boolean {
  return patterns.some((p) => p.test(name))
}

/** 按通道分组排序：recommended（疑似该通道）在前，others 在后；组内保持字母序稳定性 */
export function sortModelsForChannel(channel: string, models: string[]): GroupedModels {
  const patterns = CHANNEL_PATTERNS[channel] ?? []
  const recommended: string[] = []
  const others: string[] = []
  for (const m of models) {
    const isMatch = matchesAny(patterns, m)
    const isExcluded = channel === 'llm' && LLM_EXCLUDE.test(m)
    if (isMatch && !isExcluded) recommended.push(m)
    else others.push(m)
  }
  return { recommended, others }
}
