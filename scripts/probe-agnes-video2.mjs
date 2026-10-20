// agnes-com /videos 端点参数发现（迭代 400 错误，零消耗）
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } });
const rows = await prisma.modelProviderConfig.findMany();
const video = rows.find(r => r.channel === 'video');
const base = video.baseUrl.replace(/\/$/, '');
const key = video.apiKey;
const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

// 第一轮：mode 取值试探
const modes = ['image2video', 'image-to-video', 'i2v', 'text2video', 'text-to-video', 't2v', 'video'];

console.log('=== 第一轮：mode 取值试探（空 body + mode）===');
for (const mode of modes) {
  try {
    const res = await fetch(`${base}/videos`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ model: video.modelName, mode }),
      signal: AbortSignal.timeout(15000),
    });
    const json = await res.json().catch(() => null);
    console.log(`mode=${mode}: HTTP ${res.status} → ${JSON.stringify(json)?.slice(0, 300)}`);
    // 找到合法 mode 后深入
    if (res.status === 400 && json?.data?.param && json?.data?.param !== 'mode') {
      console.log(`  ↑ mode 合法！下一个缺失参数: ${json.data.param}`);
    }
    if (res.status !== 400) {
      console.log(`  ↑ ⚠️ 非 400 响应，注意：${JSON.stringify(json)?.slice(0, 500)}`);
    }
  } catch (e) {
    console.log(`mode=${mode}: 异常 ${e.message}`);
  }
}

await prisma.$disconnect();
