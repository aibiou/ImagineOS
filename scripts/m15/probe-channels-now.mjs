// 快速探测四通道当前可用性（z-ai TTS 是关键闸门；agnes 三通道一并确认）
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

console.log('========== 当前 ModelProviderConfig ==========');
const cfgs = await db.modelProviderConfig.findMany({ orderBy: [{ channel: 'asc' }, { priority: 'asc' }] });
for (const c of cfgs) {
  console.log(JSON.stringify({ id: c.id, channel: c.channel, providerType: c.providerType, baseUrl: c.baseUrl, modelName: c.modelName, enabled: c.enabled, priority: c.priority }));
}
await db.$disconnect();

// ---- z-ai TTS 探测（真实最小合成） ----
console.log('\n========== z-ai TTS 探测 ==========');
try {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  const t0 = Date.now();
  const response = await zai.audio.tts.create({ input: '配额探测', voice: 'tongtong', response_format: 'wav' });
  const buf = Buffer.from(await response.arrayBuffer());
  console.log(JSON.stringify({ ok: true, bytes: buf.length, latencyMs: Date.now() - t0 }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e.message ?? e).slice(0, 160) }));
}

// ---- agnes LLM 探测（近零消耗） ----
console.log('\n========== agnes LLM 探测 ==========');
try {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  const t0 = Date.now();
  const res = await zai.chat.completions.create({ messages: [{ role: 'user', content: '回复：ok' }], max_tokens: 4 });
  console.log(JSON.stringify({ ok: true, latencyMs: Date.now() - t0, sample: res.choices?.[0]?.message?.content?.slice(0, 20) }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e.message ?? e).slice(0, 160) }));
}
