// agnes-com /videos mode 值发现：批量候选 + 限流间隔
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } });
const rows = await prisma.modelProviderConfig.findMany();
const video = rows.find(r => r.channel === 'video');
const base = video.baseUrl.replace(/\/$/, '');
const auth = { Authorization: `Bearer ${video.apiKey}`, 'Content-Type': 'application/json' };

const IMG = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Cat_November_2010-1a.jpg/640px-Cat_November_2010-1a.jpg';

const candidates = [
  'i2v', 't2v', 'img2video', 'imageToVideo', 'video',
  'image_to_video', 'text2vedio', 'gen', 'generate',
];

const findings = [];
for (const mode of candidates) {
  await new Promise(r => setTimeout(r, 20000)); // 限流保护
  const body = { model: video.modelName, mode, prompt: '轻柔摇尾巴', image: IMG };
  try {
    const res = await fetch(`${base}/videos`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json().catch(() => null);
    const msg = json?.message ?? json?.error?.message ?? '';
    const tag = res.status === 400 && /invalid mode/i.test(msg) ? '✗ 非法mode'
      : res.status === 429 ? '⏳ 限流'
      : res.status === 400 ? `? 400: ${msg.slice(0, 100)}`
      : `⚠️ HTTP ${res.status}`;
    console.log(`mode=${mode}: ${tag}`);
    findings.push({ mode, status: res.status, message: msg, json: res.ok ? json : undefined });
    if (res.ok) {
      console.log(`  提交成功！响应: ${JSON.stringify(json)?.slice(0, 500)}`);
      const fs = await import('node:fs');
      fs.writeFileSync('scripts/m15/state/agnes-video-submit.json', JSON.stringify({ mode, body, response: json }, null, 2));
      break; // 找到合法 mode 即停
    }
  } catch (e) {
    console.log(`mode=${mode}: 异常 ${e.message}`);
    findings.push({ mode, error: e.message });
  }
}

console.log('\n=== 汇总 ===');
console.log(JSON.stringify(findings.map(f => ({ mode: f.mode, status: f.status, message: (f.message || f.error || '').slice(0, 80) })), null, 2));
await prisma.$disconnect();
