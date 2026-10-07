// 找出与用户提供的 ID 最接近的 Content + 全库 GENERATING 扫描
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const target = 'cmuw6r7k10l4pktgk91ipxxp9';

// 1. 模糊匹配：前 6 位
const prefix = target.slice(0, 6);
const candidates = await db.content.findMany({
  where: { id: { startsWith: prefix } },
  orderBy: { createdAt: 'desc' },
});
console.log(`前缀 ${prefix} 匹配到 ${candidates.length} 条:`);
for (const c of candidates) {
  const jobs = await db.generationJob.count({ where: { contentId: c.id } });
  console.log(`  ${c.id}  status=${c.status}  createdAt=${c.createdAt.toISOString()}  jobs=${jobs}`);
}

// 2. 全库 GENERATING 扫描（含活跃 job 判定）
console.log(`\n═══ 全库 GENERATING 扫描 ═══`);
const generating = await db.content.findMany({
  where: { status: 'GENERATING' },
  orderBy: { updatedAt: 'desc' },
});
console.log(`GENERATING 状态共 ${generating.length} 条:`);
for (const c of generating) {
  const activeJobs = await db.generationJob.count({ where: { contentId: c.id, status: { in: ['queued', 'claimed', 'running'] } } });
  const total = await db.generationJob.count({ where: { contentId: c.id } });
  const gens = await db.generation.count({ where: { contentId: c.id } });
  const owner = await db.user.findUnique({ where: { id: c.ownerId }, select: { displayName: true } });
  const staleMin = ((Date.now() - c.updatedAt.getTime()) / 60000).toFixed(0);
  console.log(`  ${c.id}`);
  console.log(`    owner=${owner?.displayName ?? c.ownerId}  updatedAt=${c.updatedAt.toISOString()} (stale ${staleMin}min)`);
  console.log(`    活跃Job=${activeJobs} 总Job=${total} Generation记账=${gens}  lastError=${(c.lastErrorJson ?? '').slice(0, 100)}`);
  const intent = await db.intent.findFirst({ where: { contentId: c.id }, orderBy: { createdAt: 'desc' } });
  if (intent) console.log(`    意图原话: ${intent.rawExpression.slice(0, 80)}`);
}

// 3. 最近 24h 内的所有内容动态（真人测试期间产生的）
console.log(`\n═══ 最近 5 小时创建的 Content（真人测试窗口） ═══`);
const since = new Date(Date.now() - 5 * 3600 * 1000);
const recent = await db.content.findMany({
  where: { createdAt: { gte: since } },
  orderBy: { createdAt: 'desc' },
});
for (const c of recent) {
  const jobs = await db.generationJob.count({ where: { contentId: c.id } });
  const gens = await db.generation.count({ where: { contentId: c.id } });
  console.log(`  ${c.id}  status=${c.status}  createdAt=${c.createdAt.toISOString()}  jobs=${jobs} gens=${gens}`);
}

// 4. 最近 5 小时的 GenerationJob
console.log(`\n═══ 最近 5 小时的 GenerationJob ═══`);
const recentJobs = await db.generationJob.findMany({
  where: { createdAt: { gte: since } },
  orderBy: { createdAt: 'desc' },
  take: 30,
});
for (const j of recentJobs) {
  console.log(`  ${j.createdAt.toISOString()} content=${j.contentId} type=${j.type} status=${j.status} err=${(j.error ?? '').slice(0, 80)}`);
}

await db.$disconnect();
