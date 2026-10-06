// 诊断 Phase B 补跑失败根因：p10 卡 GENERATING job=null；G3 修订 3 同样卡死
// 查询窗口：2026-10-06T16:01 ~ 16:40（TTS 恢复后的补跑段）
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const WIN_START = new Date('2026-10-06T15:55:00Z');
const WIN_END = new Date('2026-10-06T16:45:00Z');

const p10Id = 'cmuw6ylcg017zktgkpykk05be';
const g3Id = 'cmuwvsyxj005bkacw9r94szqa';

console.log('========== p10-cause 内容状态 ==========');
const p10 = await db.content.findUnique({ where: { id: p10Id } });
console.log(JSON.stringify({ id: p10?.id, status: p10?.status, updatedAt: p10?.updatedAt, currentVersion: p10?.currentVersionId }, null, 2));

console.log('\n========== p10 的 Jobs（全部） ==========');
const p10jobs = await db.generationJob.findMany({ where: { contentId: p10Id }, orderBy: { createdAt: 'asc' } });
for (const j of p10jobs) console.log(JSON.stringify({ id: j.id, type: j.type, status: j.status, createdAt: j.createdAt, updatedAt: j.updatedAt, error: (j.error ?? '').slice(0, 200) }));

console.log('\n========== p10 窗口内 generations ==========');
const p10gens = await db.generation.findMany({
  where: { contentId: p10Id, createdAt: { gte: WIN_START } },
  orderBy: { createdAt: 'asc' },
});
console.log(`共 ${p10gens.length} 条`);
for (const g of p10gens.slice(-25)) console.log(JSON.stringify({ at: g.createdAt, type: g.type, status: g.status, provider: g.provider, model: g.model, latencyMs: g.latencyMs, err: (g.error ?? '').slice(0, 120) }));

console.log('\n========== g3-father 内容状态 ==========');
const g3 = await db.content.findUnique({ where: { id: g3Id } });
console.log(JSON.stringify({ id: g3?.id, status: g3?.status, updatedAt: g3?.updatedAt, currentVersion: g3?.currentVersionId }, null, 2));

console.log('\n========== g3-father 全部版本 ==========');
const g3versions = await db.contentVersion.findMany({ where: { contentId: g3Id }, orderBy: { versionNumber: 'asc' } });
for (const v of g3versions) console.log(JSON.stringify({ id: v.id, version: v.versionNumber, changelog: (v.changelog ?? '').slice(0, 60), createdAt: v.createdAt }));

console.log('\n========== g3-father 的 Jobs ==========');
const g3jobs = await db.generationJob.findMany({ where: { contentId: g3Id }, orderBy: { createdAt: 'asc' } });
for (const j of g3jobs) console.log(JSON.stringify({ id: j.id, type: j.type, status: j.status, createdAt: j.createdAt, updatedAt: j.updatedAt, error: (j.error ?? '').slice(0, 300) }));

console.log('\n========== g3-father 修订3窗口 generations（16:22 后） ==========');
const g3gens = await db.generation.findMany({
  where: { contentId: g3Id, createdAt: { gte: new Date('2026-10-06T16:22:00Z') } },
  orderBy: { createdAt: 'asc' },
});
console.log(`共 ${g3gens.length} 条`);
for (const g of g3gens) console.log(JSON.stringify({ at: g.createdAt, type: g.type, status: g.status, provider: g.provider, model: g.model, latencyMs: g.latencyMs, err: (g.error ?? '').slice(0, 160) }));

console.log('\n========== 全库窗口内 generations 汇总（按 provider×status） ==========');
const allGens = await db.generation.findMany({ where: { createdAt: { gte: WIN_START, lte: WIN_END } } });
const agg = {};
for (const g of allGens) {
  const k = `${g.type} | ${g.provider ?? '-'} | ${g.status}`;
  agg[k] = (agg[k] ?? 0) + 1;
}
for (const [k, n] of Object.entries(agg).sort()) console.log(`${k} × ${n}`);

console.log('\n========== 窗口内失败 generation 的错误样本 ==========');
const failed = allGens.filter(g => g.status === 'failed').slice(0, 12);
for (const g of failed) console.log(JSON.stringify({ at: g.createdAt, type: g.type, provider: g.provider, err: (g.error ?? '').slice(0, 200) }));

console.log('\n========== z-ai TTS 在窗口内是否再次 429（含 16:39 后至当日末） ==========');
const lateGens = await db.generation.findMany({
  where: { type: 'audio.tts', createdAt: { gte: new Date('2026-10-06T16:00:00Z') } },
  orderBy: { createdAt: 'asc' },
});
console.log(`TTS generations 总数（16:00 后）：${lateGens.length}`);
let last = null;
for (const g of lateGens) last = g;
if (last) console.log('最后一条：', JSON.stringify({ at: last.createdAt, status: last.status, provider: last.provider, err: (last.error ?? '').slice(0, 150) }));

await db.$disconnect();
