// Provider 调用串行化原语（2026-10-08 E2E 缺陷修复，gate7-core-native-013）
// 根因实证（/tmp 账本时间线）：storyboard 管线 IMAGE_CONCURRENCY=2 使两镜的 native
// 视频调用并发提交，而 zai key 视频并发=1（agnes 免费档 RPM 1 同型约束）——后提交者
// 429，600ms 指数退避 3 连烧穿（~2s）即逐镜回落合成。E2E 实测 5 镜 4 亡、仅 1 镜
// native（恰为独占通道的提交）。
// 语义：createCallSerializer() 返回包装器——被包装的调用整体互斥排队（提交+轮询+
// 下载全周期），前序失败不阻塞后序（错误各自传播）；FIFO 保证可预测的镜头顺序。

export interface CallSerializer {
  <T>(fn: () => Promise<T>): Promise<T>
}

/** 创建一个调用串行化器：同实例包装的异步调用永不并发执行 */
export function createCallSerializer(): CallSerializer {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn)
    chain = run.then(
      () => undefined,
      () => undefined, // 前序失败不废队列：错误已向调用方传播，链继续
    )
    return run
  }
}
