// agnes 视频队列快速探测：提交即知（503=队列满 / 2xx=可提交）
// 用最小 4 秒请求探测；若被受理则说明队列开着 → 立即触发 Golden Case regenerate
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const cfg = await db.modelProviderConfig.findFirst({ where: { channel: 'video', enabled: true } });
await db.$disconnect();
if (!cfg) { console.log('无 video 配置'); process.exit(1); }

// 512x512 蓝灰色 PNG 首帧（满足 256-5760 边长校验）
const firstFrame = 'data:image/png;base64,' + (await import('node:fs')).readFileSync('/tmp/probe-frame.b64', 'utf8');

const body = {
  model: cfg.modelName,
  prompt: 'probe: gentle flowing water, minimal motion',
  mode: 'keyframe',
  first_frame: firstFrame,
  seconds: '4',
  size: '720P',
  aspect_ratio: '9:16',
};

const t0 = Date.now();
try {
  const res = await fetch(`${cfg.baseUrl}/videos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(70_000),
  });
  const text = await res.text();
  console.log(JSON.stringify({
    status: res.status,
    latencyMs: Date.now() - t0,
    body: text.slice(0, 300),
    verdict: res.status === 503 ? '队列满（503）' : res.ok ? '可提交（队列开放）' : '其他错误',
  }, null, 1));
} catch (e) {
  console.log(JSON.stringify({ error: String(e.message ?? e).slice(0, 200), latencyMs: Date.now() - t0 }));
}
