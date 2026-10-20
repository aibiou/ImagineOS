// 零额度验证 Agnes 视频轮询路径：GET {origin}/agnesapi?video_id=…&model_name=…
// 不提交任何视频任务（不占每日秒数配额）。路径存在 → 返回 JSON 协议体（status/code 字段）；
// 路径不存在 → 404 HTML。用于坐实 agnes-cn 轮询 origin（api.agnes-ai.cn/agnesapi）的文档推导。
// 用法：node scripts/m15/probe-video-poll-path.mjs
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const rows = await db.modelProviderConfig.findMany({ where: { channel: 'video', enabled: true }, orderBy: { priority: 'asc' } });
if (rows.length === 0) {
  console.log(JSON.stringify({ ok: false, error: '无启用的 video provider 行' }));
  await db.$disconnect();
  process.exit(0);
}

for (const row of rows) {
  let origin = '';
  try { origin = new URL(row.baseUrl).origin } catch { origin = row.baseUrl.replace(/\/v1\/?$/, '') }
  const url = `${origin}/agnesapi?video_id=probe-nonexistent-000&model_name=${encodeURIComponent(row.modelName)}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${row.apiKey}` }, signal: AbortSignal.timeout(20_000) });
    const text = await res.text().catch(() => '');
    const looksJson = /^\s*[{[]/.test(text); // JSON 协议体 vs HTML 404 页
    let parsed = null;
    try { parsed = JSON.parse(text) } catch { /* keep null */ }
    const pj = parsed;
    console.log(JSON.stringify({
      label: row.label,
      pollOrigin: origin,
      http: res.status,
      looksJson,
      protocolFields: pj ? [pj.status, pj.code, pj.message].filter((v) => v !== undefined) : null,
      latencyMs: Date.now() - t0,
      sample: text.slice(0, 140),
      verdict: looksJson ? 'PATH_OK（返回 JSON 协议体，轮询路径存在）' : 'PATH_MISSING（非 JSON 响应，路径可能不存在）',
    }));
  } catch (e) {
    console.log(JSON.stringify({ label: row.label, pollOrigin: origin, ok: false, error: String(e.message ?? e).slice(0, 160) }));
  }
}

await db.$disconnect();
