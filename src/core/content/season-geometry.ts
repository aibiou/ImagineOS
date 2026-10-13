// 分集几何（serial-season-027 §2）——纯函数，零 LLM，零副作用
// 使命：把「50 分钟」这类长片时长编译为分集结构（每集 1-2 分钟），
//       几何在规划期确定，后续一切（圣经集数、Episode 创建、供给预算）都从这份几何出发。
// 设计纪律：
//   - 单集短片（< 240s）不分集——既有路径零行为变化（向后兼容铁律）
//   - 每集目标区间 [90, 120] 秒（产品口径「每集 1-2 分钟」）
//   - 集数上限 60（一小时逐分钟的极端；正常 50min→25 集远在界内）
//   - hint（用户显式偏好，如「每集 1 分钟」）只影响 episodeSec 目标，不破坏总时长守恒

/** 单集触发分集的时长下限（秒）：≥ 4 分钟视为连续剧 */
export const SERIAL_MIN_TOTAL_SEC = 240

/** 每集时长的舒适区间（秒）——产品口径「每集 1-2 分钟」 */
export const EPISODE_SEC_MIN = 90
export const EPISODE_SEC_MAX = 120

/** 集数上限（保护 LLM 输出与供给预算；50min→25 集远在界内） */
export const MAX_EPISODES = 60

/** 用户显式分集偏好的解析（「每集1分钟」「一集两分钟」「每集 90 秒」→ 秒；无法解析返回 undefined） */
export function episodeSecHintFromExpression(raw: string): number | undefined {
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  // 中文数字映射（「一集两分钟」→ 120）
  const cnNum: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 半: 0.5, 十: 10 }
  // 「每集/一集/单集 X 分钟」（X = 数字或中文数字）
  const minMatch = cleaned.match(/[每一单]集\s*(?:大约|大概|约|左右)?\s*(\d+(?:\.\d+)?|[一两二三四五六七八九十])\s*分钟/)
  if (minMatch?.[1]) {
    const n = cnNum[minMatch[1]] ?? Number(minMatch[1])
    if (Number.isFinite(n)) {
      const sec = Math.round(n * 60)
      if (sec >= 30 && sec <= 300) return sec
    }
  }
  // 「每集/一集 X 秒」
  const secMatch = cleaned.match(/[每一单]集\s*(?:大约|大概|约|左右)?\s*(\d{2,3})\s*秒/)
  if (secMatch?.[1]) {
    const sec = Number(secMatch[1])
    if (sec >= 30 && sec <= 300) return sec
  }
  return undefined
}

/** 连续剧意图检测（关键词；时长条件由 isSerialDuration 判定） */
export function serialKeywordsInExpression(raw: string): boolean {
  return /连续剧|分集|短剧|系列剧|第[一二三一二三四五六七八九十]{1,2}季|每集|一集|单集|多少集|集数/.test(raw)
}

export interface SeasonGeometry {
  /** 是否分集（false = 单集短片，走既有路径） */
  serial: boolean
  /** 总时长（秒，守恒量） */
  totalSec: number
  /** 集数（serial=true 时 ≥2） */
  episodeCount: number
  /** 每集时长（秒；totalSec/episodeCount 归一——几何自洽，总时长守恒） */
  episodeSec: number
  /** 用户显式偏好生效（hint 被采纳） */
  hintApplied: boolean
}

/** 分集几何编译（纯函数）：
 *  - totalSec < 240 → 单集（serial: false，episodeCount=1，episodeSec=totalSec）
 *  - hint ∈ [30, 300] → 以 hint 为每集目标（夹到 [60, 180] 的理性区间），count = round(total/hint)
 *  - 无 hint → episodeSec 目标 120s（区间中点偏上），count = round(total/120)
 *  - 归一：episodeSec = totalSec / count（总时长守恒）；count 夹 [2, MAX_EPISODES]
 *  典型：50min=3000s → 25 集 × 120s；8min=480s → 4 集 × 120s；「每集1分钟」的 50min → 50 集 × 60s */
export function planSeasonGeometry(totalSec: number, hintSec?: number): SeasonGeometry {
  const total = Math.max(1, Math.round(totalSec))
  if (total < SERIAL_MIN_TOTAL_SEC) {
    return { serial: false, totalSec: total, episodeCount: 1, episodeSec: total, hintApplied: false }
  }

  // hint 的理性区间：产品口径 1-2 分钟，允许 60-180 秒（30-300 是解析宽容区间，几何层收紧）
  let targetSec = 120
  let hintApplied = false
  if (hintSec !== undefined && Number.isFinite(hintSec) && hintSec >= 30 && hintSec <= 300) {
    targetSec = Math.min(180, Math.max(60, Math.round(hintSec)))
    hintApplied = true
  }

  let count = Math.max(2, Math.round(total / targetSec))
  count = Math.min(MAX_EPISODES, count)
  // 集数收缩后每集可能超长（如 total=6000 上限 60 集 → 100s/集 仍在舒适区间；极端时也守恒）
  const episodeSec = total / count
  return { serial: true, totalSec: total, episodeCount: count, episodeSec, hintApplied }
}

/** 每集时长（毫秒，取整）——供镜头时长预算（与单集 planShotCount 同源口径） */
export function episodeDurationMs(geometry: SeasonGeometry): number {
  return Math.round(geometry.episodeSec * 1000)
}

/** 时长条件独立判定（意图层用：duration 本身是否达到分集量级） */
export function isSerialDuration(durationSec: number | undefined): boolean {
  return (durationSec ?? 0) >= SERIAL_MIN_TOTAL_SEC
}
