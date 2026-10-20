// 按案例统计真实 provider 使用分布（真实性记录用）
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const cfgs = await db.modelProviderConfig.findMany({ select: { channel: true, modelName: true, createdAt: true } });
console.log('========== Provider 配置创建时间 ==========');
for (const c of cfgs) console.log(`${c.channel}: ${c.modelName} 创建于 ${c.createdAt.toISOString()}`);

const cases = [
  ['p01', 'cmuw5f8cs00c3ktgkgivqjhvs'],
  ['p02', 'cmuw5f8d100c9ktgk2uy4ajcu'],
  ['p03', 'cmuw61qsq00l1ktgkiwuqga9z'],
  ['p04', 'cmuw59u8f007tktgkrxq3pvjo'],
  ['p05', 'cmuw5da5b00bbktgkzb2rmvag'],
  ['p06', 'cmuw5da5k00bhktgkeqifukw8'],
  ['p07', 'cmuw6ktd700xtktgkhoydtym2'],
  ['p08', 'cmuw6ktdr00xzktgkmmghiyl1'],
  ['p09', 'cmuw6ylc7017tktgkwg2e1v1t'],
  ['p10', 'cmuw6ylcg017zktgkpykk05be'],
  ['g3-father', 'cmuwvsyxj005bkacw9r94szqa'],
];

console.log('\n========== 各案例 provider×type 使用分布 ==========');
for (const [name, id] of cases) {
  const gens = await db.generation.findMany({ where: { contentId: id } });
  const agg = {};
  for (const g of gens) {
    const k = `${g.type}:${g.provider ?? '-'}`;
    agg[k] = agg[k] ?? { ok: 0, fail: 0 };
    agg[k][g.status === 'succeeded' ? 'ok' : 'fail']++;
  }
  const parts = Object.entries(agg).map(([k, v]) => `${k} ${v.ok}✓/${v.fail}✗`);
  console.log(`${name}: ${parts.join(' | ')}`);
}

console.log('\n========== g4-remix / native-golden 案例 ==========');
const extra = await db.content.findMany({
  where: { id: { notIn: cases.map((c) => c[1]) }, createdAt: { gte: new Date('2026-10-06T00:00:00Z') } },
  select: { id: true, title: true, status: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
});
for (const c of extra) console.log(`${c.id} 「${(c.title ?? '').slice(0, 24)}」 ${c.status} ${c.createdAt.toISOString()}`);

await db.$disconnect();
