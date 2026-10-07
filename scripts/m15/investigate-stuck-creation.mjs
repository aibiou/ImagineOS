// Gate 7 故障调查：卡 GENERATING 的 creation 全链路追踪
// 用法: node scripts/m15/investigate-stuck-creation.mjs <publicId>
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';

const db = new PrismaClient();
const target = process.argv[2];
if (!target) { console.error('usage: node investigate-stuck-creation.mjs <publicId>'); process.exit(1); }

const content = await db.content.findFirst({
  where: { id: target },
  include: {
    versions: { orderBy: { createdAt: 'asc' } },
    intents: { orderBy: { createdAt: 'asc' } },
    plans: { orderBy: { createdAt: 'asc' } },
    stories: true,
  },
});

if (!content) {
  console.log(`❌ Content not found: ${target}`);
  const recent = await db.content.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, status: true, createdAt: true } });
  console.log('\n最近 10 条 Content:');
  for (const c of recent) console.log(`  ${c.id}  status=${c.status}  createdAt=${c.createdAt.toISOString()}`);
  process.exit(0);
}

console.log('════════ 1. CONTENT 基本信息 ════════');
console.log(`id:            ${content.id}`);
console.log(`status:        ${content.status}`);
console.log(`createdAt:     ${content.createdAt.toISOString()}`);
console.log(`updatedAt:     ${content.updatedAt.toISOString()}`);
const ageMin = (Date.now() - content.updatedAt.getTime()) / 60000;
console.log(`updatedAt 距今: ${ageMin.toFixed(1)} 分钟`);
console.log(`currentVersionId: ${content.currentVersionId ?? 'null'}`);
console.log(`publishedAt:   ${content.publishedAt?.toISOString() ?? 'null'}`);

console.log(`\n════════ 2. VERSIONS (${content.versions.length}) ════════`);
for (const v of content.versions) {
  console.log(`  v${v.versionNumber} id=${v.id} status=${v.status} createdAt=${v.createdAt.toISOString()}`);
}

console.log(`\n════════ 3. INTENTS (${content.intents.length}) ════════`);
for (const i of content.intents) {
  console.log(`  id=${i.id} createdAt=${i.createdAt.toISOString()} fields=${i.fieldsJson ? 'yes' : 'null'} interview=${i.interviewJson ? 'yes' : 'null'}`);
  const raw = (i.rawExpression ?? '').slice(0, 120);
  console.log(`  rawExpression: ${raw}`);
}

console.log(`\n════════ 4. CREATIVE PLANS (${content.plans.length}) ════════`);
for (const p of content.plans) {
  console.log(`  id=${p.id} versionId=${p.versionId} createdAt=${p.createdAt.toISOString()}`);
}

console.log(`\n════════ 5. GENERATION JOBS ════════`);
// 先按 contentId 直查，再按 versionId 查
const jobsByContent = await db.generationJob.findMany({
  where: { contentId: content.id },
  orderBy: { createdAt: 'asc' },
});
const versionIds = content.versions.map(v => v.id);
const jobsByVersion = versionIds.length ? await db.generationJob.findMany({
  where: { versionId: { in: versionIds } },
  orderBy: { createdAt: 'asc' },
}) : [];
const allJobs = [...jobsByContent, ...jobsByVersion.filter(j => !jobsByContent.some(x => x.id === j.id))];
if (allJobs.length === 0) {
  console.log('  ⚠️ 无任何 GenerationJob —— 孤儿 GENERATING 实锤');
} else {
  for (const j of allJobs) {
    console.log(`  jobId=${j.id}`);
    console.log(`    type=${j.type} status=${j.status} createdAt=${j.createdAt.toISOString()}`);
    console.log(`    claimedAt=${j.claimedAt?.toISOString() ?? 'null'} leaseExpiresAt=${j.leaseExpiresAt?.toISOString() ?? 'null'} completedAt=${j.completedAt?.toISOString() ?? 'null'}`);
    console.log(`    retryCount=${j.retryCount}/${j.maxRetries} error=${(j.error ?? '').slice(0, 300)}`);
  }
}

console.log(`\n════════ 6. GENERATION 记账（provider 侧是否收到请求） ════════`);
const gens = await db.generation.findMany({
  where: { OR: [{ contentId: content.id }, ...(versionIds.length ? [{ versionId: { in: versionIds } }] : [])] },
  orderBy: { createdAt: 'asc' },
  take: 50,
});
if (gens.length === 0) {
  console.log('  ⚠️ 无任何 Generation 记账 —— provider 从未收到请求（plan 生成阶段即未发出）');
} else {
  for (const g of gens) {
    console.log(`  ${g.createdAt.toISOString()} kind=${g.kind} status=${g.status} model=${g.model ?? '-'} latencyMs=${g.latencyMs ?? '-'} err=${(g.errorMessage ?? '').slice(0, 120)}`);
  }
}

// 7. 全库 GENERATING 孤儿扫描
console.log(`\n════════ 7. 全库 GENERATING 状态扫描 ════════`);
const generating = await db.content.findMany({ where: { status: 'GENERATING' }, select: { id: true, updatedAt: true } });
console.log(`GENERATING 状态的 Content 共 ${generating.length} 条:`);
for (const c of generating) {
  const activeJobs = await db.generationJob.count({ where: { contentId: c.id, status: { in: ['queued', 'claimed', 'running'] } } });
  const total = await db.generationJob.count({ where: { contentId: c.id } });
  console.log(`  ${c.id}  updatedAt=${c.updatedAt.toISOString()}  活跃Job=${activeJobs} 总Job=${total}`);
}

await db.$disconnect();
