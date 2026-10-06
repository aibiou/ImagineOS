// Next.js instrumentation：服务进程启动时拉起生成 Worker（§53 异步 Job）
// 仅 nodejs runtime；vitest 显式禁用。
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && !process.env.VITEST) {
    const { startWorker } = await import('../workers/generation-worker')
    startWorker()
  }
}
