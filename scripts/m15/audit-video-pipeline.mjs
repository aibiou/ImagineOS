// Video Pipeline Audit 取证脚本（只读，不写任何数据）
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const CID = 'cmuw6r7kl014pktgk91ipxxp9' // 用户真实创作（Remix 衍生，gate7-incident-001/002 主角）

const line = (s = '') => console.log(s)

async function main() {
  line('===== 1. Provider 配置（video 能力链） =====')
  const configs = await db.modelProviderConfig.findMany({
    where: { channel: 'video' },
    orderBy: { priority: 'asc' },
  })
  for (const c of configs) {
    line(`  [${c.enabled ? 'ENABLED' : 'DISABLED'}] id=${c.id} label=${c.label} providerType=${c.providerType} model=${c.modelName} priority=${c.priority} lastTest=${c.lastTestStatus ?? 'untested'} baseUrl=${c.baseUrl?.slice(0, 40)}…`)
  }
  if (configs.length === 0) line('  （无 video.shot 自定义配置行）')
  line('  注：内置兜底 zaiVideoProvider 恒在链尾（registry.ts:41）')

  line()
  line('===== 2. 用户创作 cmuw6r7kl014pktgk91ipxxp9 的全部 Job =====')
  const jobs = await db.generationJob.findMany({
    where: { contentId: CID },
    orderBy: { createdAt: 'asc' },
  })
  for (const j of jobs) {
    line(`  Job ${j.id} type=${j.type} status=${j.status}`)
    line(`    createdAt=${j.createdAt.toISOString()} startedAt=${j.startedAt?.toISOString() ?? '-'} finishedAt=${j.finishedAt?.toISOString() ?? '-'}`)
    line(`    attempts=${j.attempts} lastError=${(j.lastError ?? '').slice(0, 120)}`)
    const out = j.outputJson ? JSON.parse(j.outputJson) : null
    if (out?.shotAssets) {
      const native = out.shotAssets.filter((s) => s.videoAssetId).length
      line(`    shotAssets=${out.shotAssets.length} 带videoAssetId(native)镜头数=${native}`)
    }
  }
  if (jobs.length === 0) line('  （无 Job）')

  line()
  line('===== 3. 当前版本配方 structureJson 中的 motion 字段 =====')
  const content = await db.content.findUnique({ where: { id: CID }, include: { versions: true } })
  if (content) {
    line(`  content.status=${content.status} currentVersionId=${content.currentVersionId}`)
    for (const v of content.versions) {
      const st = JSON.parse(v.structureJson ?? '{}')
      const shots = (st?.story?.scenes ?? []).flatMap((s) => s.shots ?? [])
      const motions = shots.map((s) => s.motion ?? 'undefined')
      line(`  version ${v.id.slice(0, 8)} label=${v.label} shots=${shots.length} motion值=[${motions.join(', ')}]`)
    }
  } else {
    line('  （content 不存在——可能已被清理）')
  }

  line()
  line('===== 4. 全库 video.shot 记账（按 purpose 分布） =====')
  const videoCalls = await db.generation.findMany({ where: { type: 'video.shot' } })
  const byPurpose = {}
  for (const g of videoCalls) {
    const purpose = (() => { try { return JSON.parse(g.inputJson ?? '{}').purpose ?? '-' } catch { return '-' } })()
    const k = `${purpose} | ${g.status} | ${g.provider} | ${g.model}`
    byPurpose[k] = (byPurpose[k] ?? 0) + 1
  }
  line(`  总数=${videoCalls.length}`)
  for (const [k, n] of Object.entries(byPurpose)) line(`    ${k}: ${n}`)

  line()
  line('===== 5. 全库 Provenance native 相关事件 =====')
  const events = await db.provenance.findMany({
    where: { OR: [{ model: 'native-fallback' }, { payloadJson: { contains: 'video.shot' } }] },
    orderBy: { createdAt: 'asc' },
  })
  line(`  native-fallback / video.shot 相关事件总数=${events.length}`)
  for (const e of events.slice(0, 10)) {
    line(`    ${e.createdAt.toISOString()} content=${e.contentId?.slice(0, 8)} model=${e.model} payload=${(e.payloadJson ?? '').slice(0, 100)}`)
  }

  line()
  line('===== 6. 全库 Job 类型分布（证明 video.storyboard 是唯一生成类型） =====')
  const allJobs = await db.generationJob.groupBy({ by: ['type'], _count: true })
  for (const g of allJobs) line(`    ${g.type}: ${g._count}`)

  line()
  line('===== 7. 近 24h 生成模式分布（computeGenerationMode 口径：storyboard 成功 Job 的 shotAssets） =====')
  const recent = await db.generationJob.findMany({
    where: { type: 'video.storyboard', status: 'succeeded', createdAt: { gte: new Date(Date.now() - 86400000 * 2) } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  let comp = 0, nat = 0, hyb = 0
  for (const j of recent) {
    const out = j.outputJson ? JSON.parse(j.outputJson) : null
    if (!out?.shotAssets) continue
    const n = out.shotAssets.filter((s) => s.videoAssetId).length
    if (n === 0) comp++
    else if (n === out.shotAssets.length) nat++
    else hyb++
  }
  line(`    近2天成功 storyboard Job：composition=${comp} native=${nat} hybrid=${hyb}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
