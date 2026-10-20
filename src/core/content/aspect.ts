// 画幅纯函数模块（多画幅支持 / 产品级）
// 设计纪律：
//   - 画幅的唯一权威来源 = VersionStructure.aspectRatio（随配方密封）；
//     Intent.fields.aspectRatio 是它的上游（用户原话识别 / 用户 UI 选择）。
//   - 本模块只做「画幅 → 各执行点尺寸」的确定性映射，供管线执行器消费；
//     返回字符串字面量联合类型，与 router 层 ImageSize 兼容但不依赖 AI 层（方向纪律）。
//   - 缺省 9:16：所有旧配方（无 aspectRatio 字段）自动落入竖屏路径——零迁移、向后兼容。

import type { AspectRatio } from './schemas'

/** 配方画幅读取（缺省 9:16，向后兼容旧版本） */
export function aspectRatioOf(structure: Pick<{ aspectRatio?: AspectRatio }, 'aspectRatio'>): AspectRatio {
  return structure.aspectRatio === '16:9' ? '16:9' : '9:16'
}

/** 画幅 → 分镜图像生成尺寸（1K 档：竖屏 768x1344 / 横屏 1344x768） */
export function imageSizeForAspect(ar: AspectRatio): '768x1344' | '1344x768' {
  return ar === '16:9' ? '1344x768' : '768x1344'
}

/** 画幅 → 原生视频生成尺寸（720P 档） */
export function videoSizeForAspect(ar: AspectRatio): '720x1280' | '1280x720' {
  return ar === '16:9' ? '1280x720' : '720x1280'
}

/** 画幅 → 成片渲染分辨率（H.264 输出与资产宽高记录共用） */
export function renderDimensionsForAspect(ar: AspectRatio): { width: number; height: number } {
  return ar === '16:9' ? { width: 1280, height: 720 } : { width: 720, height: 1280 }
}

/** 资产宽高 → 画幅推断（展示面自适应：分享页/首页播放；未知按竖屏） */
export function aspectFromDimensions(width: number | null | undefined, height: number | null | undefined): AspectRatio {
  return width != null && height != null && width > height ? '16:9' : '9:16'
}

/** 用户原话 → 画幅识别（意图启发式兜底；未提及返回 null = 交给默认值） */
export function aspectFromExpression(text: string): AspectRatio | null {
  if (/横屏|横版|宽屏|横幅|宽幅|16[:：xX×]9/.test(text)) return '16:9'
  if (/竖屏|竖版|9[:：xX×]16/.test(text)) return '9:16'
  return null
}
