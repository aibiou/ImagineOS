// 产品语言字典（M0 评审 P0-3 / T7X.2）
// 用户界面唯一文案规范源：底层技术模型不得直接成为用户界面语言。
// 工程术语（Content Object / Intent Engine / V0 / Generation Chain…）只允许出现在
// 内部元数据、Debug/Admin 界面与开发文档中。
//
// 映射表见 docs/product/m0-review-m1-direction.md「P0-3」。

// ---------- 创作阶段（状态机 → 用户语言） ----------

export const STAGE_LABEL: Record<string, string> = {
  IDEA: '理解你的表达',
  INTENT: '挑选创作方向',
  PLANNING: '挑选创作方向',
  STORY: '展开故事',
  STORYBOARD: '分镜确认',
  GENERATING: 'AI 生成中',
  REVIEW: '预览与调整',
  RENDERING: '渲染成片',
  READY: '就绪',
  PUBLISHED: '已发布',
}

/** 创作空间的步骤条（用户视角的 5 步） */
export const CREATE_STEPS = [
  { key: 'understand', label: '理解', match: ['IDEA', 'INTENT'] },
  { key: 'direction', label: '方向', match: ['PLANNING'] },
  { key: 'story', label: '故事', match: ['STORY', 'STORYBOARD'] },
  { key: 'generate', label: '生成', match: ['GENERATING', 'REVIEW', 'RENDERING'] },
  { key: 'finish', label: '作品', match: ['READY', 'PUBLISHED'] },
] as const

// ---------- 版本（V0/V1 → 初稿/第N版） ----------

/** 版本的用户语言：「初稿」「第 2 版」 */
export function versionLabel(versionNumber: number): string {
  return versionNumber <= 1 ? '初稿' : `第 ${versionNumber} 版`
}

/** 版本+总数：「初稿」「第 2 版 · 共 3 版」 */
export function versionWithCount(versionNumber: number, total: number): string {
  if (total <= 1) return versionLabel(versionNumber)
  return `${versionLabel(versionNumber)} · 共 ${total} 版`
}

/** 版本变更方式（creationMethod → 用户语言） */
export const METHOD_LABEL: Record<string, string> = {
  initial: '初稿',
  revision: '修改',
  restore: '回到这一版',
  remix: '从别人的作品开始',
  regenerate: '重新生成',
}

// ---------- 核心动作（评审指定文案） ----------

export const COPY = {
  // 2026-10-06 用户语言规则（docs/product/user-language-rules.md §4）：
  // 普通用户界面禁止直接显示 Remix，默认「从这里开始创作」。
  remixCta: '从这里开始创作',
  remixCtaShort: '开始创作',
  remixDone: '你的创作已经开始了',
  reviseCta: '继续修改',
  revisionTitle: '你想怎么改？',
  revisionConfirm: '就这样改，重新生成',
  continueCreate: '继续创作',
  publishCta: '发布作品',
  regenerateCta: '换一批画面',
  renderCta: '满意，渲染成片',
  aiInvolved: 'AI 参与创作',
  latestVersion: '最新版本',
} as const

// ---------- 生成模式（2026-10-07：真实产物路径必须对用户可见） ----------

/** 生成模式的用户语言（诚实披露：合成动图 ≠ AI 视频模型产物） */
export function generationModeLabel(
  mode: string | null | undefined,
  nativeShots?: number,
  totalShots?: number,
): string | null {
  switch (mode) {
    case 'native':
      return 'AI 视频生成'
    case 'hybrid':
      return nativeShots != null && totalShots != null
        ? `AI 视频 ${nativeShots}/${totalShots} 镜 · 其余图像合成`
        : 'AI 视频 + 图像合成混合'
    case 'composition':
      return 'AI 图像 + 运镜合成'
    default:
      return null
  }
}

/** 生成模式说明（一句话解释，防误解的关键文案） */
export const GENERATION_MODE_DESC: Record<string, string> = {
  native: '每个镜头由 AI 视频模型直接生成动态画面',
  hybrid: '部分镜头由 AI 视频模型生成，其余由 AI 图像加运镜合成',
  composition: '每个镜头是 AI 生成的图像，加上镜头运动与转场合成为视频',
}

// ---------- 工具 ----------

/** 时长（毫秒 → 「45 秒」「1 分 20 秒」） */
export function durationLabel(ms: number | null | undefined): string | null {
  if (!ms || ms < 500) return null
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec} 秒`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`
}

/** 镜头运镜 → 用户语言 */
export const CAMERA_LABEL: Record<string, string> = {
  zoom_in: '缓缓推近',
  zoom_out: '缓缓拉远',
  pan_left: '向左移动',
  pan_right: '向右移动',
  static: '静静注视',
}

/** 镜头景别 → 用户语言（2026-10-08 影视专业升级：景别是观众感知距离与亲密度的语法） */
export const SHOT_SIZE_LABEL: Record<string, string> = {
  extreme_wide: '大远景',
  wide: '远景',
  medium: '中景',
  closeup: '特写',
  extreme_closeup: '大特写',
}

/** 镜头转场 → 用户语言 */
export const TRANSITION_LABEL: Record<string, string> = {
  cut: '硬切',
  dissolve: '叠化',
  fade: '淡出',
}

/** 场景戏剧功能 → 用户语言（三幕微结构：每场戏为什么存在） */
export const SCENE_FUNCTION_LABEL: Record<string, string> = {
  hook: '开场一钩',
  setup: '铺垫',
  turn: '转折',
  climax: '高潮',
  release: '落点',
}
