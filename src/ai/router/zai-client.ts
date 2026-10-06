// z-ai SDK 客户端单例（全项目唯一 import z-ai-web-dev-sdk 的位置之一，连同 providers/）
// 测试环境从不触达此模块（测试注入 fake provider），因此惰性初始化 + 明确错误信息。
import ZAI from 'z-ai-web-dev-sdk'
import type ZAIClass from 'z-ai-web-dev-sdk'

let client: ZAIClass | null = null
let initPromise: Promise<ZAIClass> | null = null

/** 获取已初始化的 SDK 实例（进程内单例） */
export async function getZai(): Promise<ZAIClass> {
  if (client) return client
  if (!initPromise) {
    initPromise = ZAI.create().then((instance) => {
      client = instance
      return instance
    })
  }
  try {
    return await initPromise
  } catch (e) {
    initPromise = null // 允许下次重试初始化
    throw new Error(
      `[z-ai] SDK 初始化失败：${e instanceof Error ? e.message : String(e)}。请检查网络与凭据环境。`,
    )
  }
}
