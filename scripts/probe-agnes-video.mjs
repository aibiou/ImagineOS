// agnes-com 视频协议形态深探（找出真实的视频生成端点）
// 策略：先用空/最小 body 探端点存在性（404=不存在 / 400=存在但参数错 / 200=真通了）
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } });
const rows = await prisma.modelProviderConfig.findMany();
const video = rows.find(r => r.channel === 'video');
const base = video.baseUrl.replace(/\/$/, '');
const key = video.apiKey;
const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

const probes = [
  // [方法, 路径, body, 说明]
  ['POST', '/videos', { model: video.modelName, prompt: 'test' }, 'OpenAI Sora 风格 POST /videos'],
  ['GET', '/videos', null, 'GET /videos 列表（Sora 风格存在性）'],
  ['POST', '/video/generations', { model: video.modelName, prompt: 'test' }, 'POST /video/generations'],
  ['POST', '/videos/generations', { model: video.modelName, prompt: 'test' }, 'POST /videos/generations'],
  ['POST', '/video', { model: video.modelName, prompt: 'test' }, 'POST /video'],
];

for (const [method, path, body, label] of probes) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: auth,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => null);
    const bodyStr = JSON.stringify(json)?.slice(0, 400);
    console.log(`[${label}]`);
    console.log(`  HTTP ${res.status} (${Date.now() - t0}ms): ${bodyStr}\n`);
  } catch (e) {
    console.log(`[${label}]`);
    console.log(`  异常 (${Date.now() - t0}ms): ${e.message}\n`);
  }
}

// 关键补充探测：chat/completions + video 模型（agentic hub 常见形态）
// 先用极小请求试探响应形态（不确认是否消耗，视频模型可能贵——只做一次）
console.log('[chat/completions + agnes-video 模型 —— 试探响应形态]');
const t2 = Date.now();
try {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      model: video.modelName,
      messages: [{ role: 'user', content: '生成一个2秒的视频：一只猫摇尾巴' }],
    }),
    signal: AbortSignal.timeout(300000),
  });
  const json = await res.json().catch(() => null);
  console.log(`  HTTP ${res.status} (${Date.now() - t2}ms)`);
  console.log(`  响应: ${JSON.stringify(json)?.slice(0, 1200)}`);
} catch (e) {
  console.log(`  异常 (${Date.now() - t2}ms): ${e.message}`);
}

await prisma.$disconnect();
