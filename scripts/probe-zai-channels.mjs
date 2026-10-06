// z-ai 三通道配额探测（TTS 兜底可用性 + fallback 验证前置）
import ZAI from 'z-ai-web-dev-sdk';

const zai = await ZAI.create();
const results = {};

// 1. LLM
try {
  const t0 = Date.now();
  const r = await zai.chat.completions.create({
    messages: [{ role: 'user', content: '回复：ok' }],
    max_tokens: 8,
  });
  results.llm = { ok: true, latencyMs: Date.now() - t0, text: r.choices?.[0]?.message?.content?.slice(0, 30) };
} catch (e) {
  results.llm = { ok: false, error: String(e.message ?? e).slice(0, 150) };
}

// 2. Image（1 张小图）
try {
  const t0 = Date.now();
  const r = await zai.images.generations.create({
    prompt: 'a simple red circle on white background',
    size: '512x512',
  });
  const b64 = r?.data?.[0]?.base64 ?? r?.data?.[0]?.b64_json;
  results.image = { ok: true, latencyMs: Date.now() - t0, hasImage: Boolean(b64), bytes: b64?.length ?? 0 };
} catch (e) {
  results.image = { ok: false, error: String(e.message ?? e).slice(0, 150) };
}

// 3. TTS
try {
  const t0 = Date.now();
  const r = await zai.audio.speech.create({
    input: '测试',
    voice: 'tongtong',
  });
  const buf = Buffer.from(r.audio, 'base64');
  results.tts = { ok: true, latencyMs: Date.now() - t0, bytes: buf.length };
} catch (e) {
  results.tts = { ok: false, error: String(e.message ?? e).slice(0, 150) };
}

console.log(JSON.stringify(results, null, 2));
const fs = await import('node:fs');
fs.writeFileSync('scripts/m15/state/zai-probe.json', JSON.stringify({ probedAt: new Date().toISOString(), results }, null, 2));
