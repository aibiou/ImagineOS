// stop-native-sampling.mjs —— 按产品负责人指令（2026-10-07）终止 native 采样重跑，额度让位 Gate 7 真人测试
// 处置对象：g6-native 重跑遗留的 running storyboard job（dev server native 模式下正在执行/将被回收）
// 动作：job 终态化 failed（防 13:02 lease 过期后被 worker 回收重跑）+ Content 写失败标记（防看门狗二次标记）
// 前置：先 pkill dev server（中断执行中的 provider 调用），再跑本脚本，最后 restart-dev.sh composition
import { PrismaClient } from '@prisma/client'

const JOB_ID = 'cmuy2rpyt001tkan5umixj4lx'
const REASON = '按产品负责人指令终止 native 采样重跑（作品质量交由用户在 Gate 7 体验，额度让位真人测试）'
const db = new PrismaClient({ datasources: { db: { url: 'file:/home/z/my-project/db/custom.db' } } })

const job = await db.generationJob.findUnique({ where: { id: JOB_ID } })
if (!job) { console.log('job 不存在，无需处置'); process.exit(0) }
if (['failed', 'timeout', 'succeeded'].includes(job.status)) {
  console.log(`job 已是终态 ${job.status}，无需处置`); process.exit(0)
}

// 1) job 终态化（等价 jobService.fail 的不可重试分支）
await db.generationJob.update({
  where: { id: JOB_ID },
  data: { status: 'failed', error: REASON, completedAt: new Date() },
})

// 2) Content 失败标记（等价 markGenerationError；防 watchdog 对 GENERATING 孤儿二次标记）
await db.content.update({
  where: { id: job.contentId },
  data: {
    lastErrorJson: JSON.stringify({
      code: 'generation_failed',
      message: '本次生成已按计划终止（native 采样收口），你的创作没有丢，点「重新生成」可以继续。',
      jobId: JOB_ID,
      at: new Date().toISOString(),
    }),
  },
}).catch((e) => console.warn('lastErrorJson 写入失败（不阻塞）：', e.message))

// 3) 溯源事件（处置审计）
await db.provenance.create({
  data: {
    contentId: job.contentId,
    versionId: job.versionId,
    eventType: 'generation_failed',
    actorType: 'system',
    actorId: null,
    provider: 'pipeline',
    model: null,
    payloadJson: JSON.stringify({ code: 'sampling_stopped', message: REASON, jobId: JOB_ID, at: new Date().toISOString() }),
  },
}).catch((e) => console.warn('provenance 写入失败（不阻塞）：', e.message))

console.log(`✓ job ${JOB_ID} 已终态化 failed；content ${job.contentId} 已写失败标记`)
await db.$disconnect()
