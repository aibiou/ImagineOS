// agnes-com /videos 字段名发现：逐个候选试探（带限流间隔）
// 用法：node scripts/probe-agnes-video3.mjs <字段名>
import { PrismaClient } from '@prisma/client';

const field = process.argv[2];
if (!field) { console.error('用法: node probe-agnes-video3.mjs <字段名>'); process.exit(1); }

const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } });
const rows = await prisma.modelProviderConfig.findMany();
const video = rows.find(r => r.channel === 'video');
const base = video.baseUrl.replace(/\/$/, '');
const auth = { Authorization: `Bearer ${video.apiKey}`, 'Content-Type': 'application/json' };

const body = {
  model: video.modelName,
  mode: 'image2video',
  prompt: '轻柔摇尾巴，画面缓慢运动',
  [field]: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Cat_November_2010-1a.jpg/640px-Cat_November_2010-1a.jpg',
};

const t0 = Date.now();
const res = await fetch(`${base}/videos`, {
  method: 'POST', headers: auth, body: JSON.stringify(body),
  signal: AbortSignal.timeout(60000),
});
const json = await res.json().catch(() => null);
console.log(`字段名 "${field}": HTTP ${res.status} (${Date.now() - t0}ms)`);
console.log(JSON.stringify(json)?.slice(0, 600));

// 若提交成功（返回 id/requestId），把响应存下来
if (res.ok && json) {
  const fs = await import('node:fs');
  fs.writeFileSync('scripts/m15/state/agnes-video-submit.json', JSON.stringify({ field, body, response: json }, null, 2));
  console.log('\n✓ 提交成功，已存 scripts/m15/state/agnes-video-submit.json');
}

await prisma.$disconnect();
