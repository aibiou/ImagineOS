// 快速探测四通道当前可用性（z-ai TTS 是关键闸门；agnes 逐行探测——每个启用的 provider 配置独立验证）
// 限速背景（wiki.agnes-ai.com tokenplan.md 免费档）：文本 RPM 10 / 图片 1K RPM 10 / 视频 RPM 1 + 每日秒数配额。
// 消耗说明：LLM 探测近零；Image 每行 1 张免费额度；Video 每行提交 1 个 4s 任务（占用每日秒数配额）。
// 用法：node scripts/m15/probe-channels-now.mjs          → LLM（逐行）+ z-ai TTS
//       node scripts/m15/probe-channels-now.mjs --full   → 追加 Image（逐行）+ Video 队列（逐行）
//       node scripts/m15/probe-channels-now.mjs --video  → 仅 Video 队列（逐行）——最小额度验证轮询路径
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const FULL = process.argv.includes('--full');
const VIDEO_ONLY = process.argv.includes('--video');

console.log('========== 当前 ModelProviderConfig ==========');
const cfgs = await db.modelProviderConfig.findMany({ orderBy: [{ channel: 'asc' }, { priority: 'asc' }] });
for (const c of cfgs) {
  console.log(JSON.stringify({ id: c.id, channel: c.channel, label: c.label, providerType: c.providerType, baseUrl: c.baseUrl, modelName: c.modelName, enabled: c.enabled, priority: c.priority, lastTest: c.lastTestStatus ?? 'untested' }));
}

// ---- z-ai TTS 探测（真实最小合成；内置通道，关键闸门） ----
if (!VIDEO_ONLY) {
  console.log('\n========== z-ai TTS 探测（内置） ==========');
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
}

// ---- agnes LLM 逐行探测（近零消耗；每行 = 一个独立免费额度池） ----
if (!VIDEO_ONLY) {
  console.log('\n========== agnes LLM 探测（逐行） ==========');
  for (const row of cfgs.filter((c) => c.channel === 'llm' && c.enabled)) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${row.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${row.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: row.modelName, messages: [{ role: 'user', content: '回复：ok' }], max_tokens: 4 }),
        signal: AbortSignal.timeout(30_000),
      });
      const j = await res.json().catch(() => null);
      console.log(JSON.stringify({ label: row.label, ok: res.ok, http: res.status, latencyMs: Date.now() - t0, sample: j?.choices?.[0]?.message?.content?.slice(0, 20) }));
    } catch (e) {
      console.log(JSON.stringify({ label: row.label, ok: false, error: String(e.message ?? e).slice(0, 160) }));
    }
  }
}

if (!FULL && !VIDEO_ONLY) {
  console.log('\n（未加 --full：跳过 Image / Video 探测以节省免费额度——Image 每行 1 张、Video 每行 4 秒每日配额）');
  await db.$disconnect();
  process.exit(0);
}

if (!FULL && VIDEO_ONLY) {
  console.log('\n（--video 模式：跳过 TTS/LLM/Image，仅探测 Video 队列——最小额度验证轮询路径）');
}

// ---- agnes Image 逐行探测（每行消耗 1 张免费额度） ----
if (!VIDEO_ONLY) {
  console.log('\n========== agnes Image 探测（逐行，各耗 1 张额度） ==========');
  for (const row of cfgs.filter((c) => c.channel === 'image' && c.enabled)) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${row.baseUrl.replace(/\/$/, '')}/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${row.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: row.modelName, prompt: '一张极简的浅色卡片，中心一个圆点', size: '768x1344', n: 1 }),
        signal: AbortSignal.timeout(120_000),
      });
      const j = await res.json().catch(() => null);
      const d0 = j?.data?.[0] ?? {};
      const hasB64 = typeof d0.b64_json === 'string' && d0.b64_json.length > 100;
      const hasUrl = typeof d0.url === 'string' && /^https?:\/\//.test(d0.url);
      console.log(JSON.stringify({ label: row.label, ok: res.ok && (hasB64 || hasUrl), http: res.status, latencyMs: Date.now() - t0, form: hasB64 ? 'b64' : hasUrl ? 'url' : 'none' }));
    } catch (e) {
      console.log(JSON.stringify({ label: row.label, ok: false, error: String(e.message ?? e).slice(0, 160) }));
    }
  }
}

// ---- agnes Video 队列逐行探测（每行提交 1 个 4s 任务，占每日秒数配额；首帧取 storage 现成镜头图） ----
console.log('\n========== agnes video 队列探测（逐行，各耗 4s 每日额度） ==========');
{
  const { readFile, readdir } = await import('node:fs/promises');
  const pngs = (await readdir('storage/assets')).filter((f) => f.endsWith('.png'));
  if (pngs.length === 0) {
    console.log(JSON.stringify({ ok: false, error: 'storage/assets 无 PNG 可用作首帧' }));
  } else {
    const imgBuf = await readFile(`storage/assets/${pngs[0]}`);
    const dataUri = `data:image/png;base64,${imgBuf.toString('base64')}`;
    for (const row of cfgs.filter((c) => c.channel === 'video' && c.enabled)) {
      const t0 = Date.now();
      try {
        const submit = await fetch(`${row.baseUrl.replace(/\/$/, '')}/videos`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${row.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: row.modelName,
            mode: 'keyframe',
            prompt: 'subtle camera drift, ambient life（通道健康探测，可忽略产物）',
            first_frame: dataUri,
            seconds: '4',
            size: '720P',
            aspect_ratio: '9:16',
          }),
          signal: AbortSignal.timeout(60_000),
        });
        const submitJson = await submit.json().catch(() => null);
        if (!submit.ok) {
          console.log(JSON.stringify({ label: row.label, ok: false, stage: 'submit', http: submit.status, error: String(JSON.stringify(submitJson)).slice(0, 160) }));
          continue;
        }
        const videoId = submitJson?.video_id ?? submitJson?.id ?? submitJson?.task_id;
        if (!videoId) {
          console.log(JSON.stringify({ label: row.label, ok: false, stage: 'submit', error: '提交 200 但未返回 video_id', body: String(JSON.stringify(submitJson)).slice(0, 160) }));
          continue;
        }
        // 轮询 ≤90s：终态即出（不下载成品，省额度）
        const origin = new URL(row.baseUrl).origin;
        let last = 'UNKNOWN';
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const st = await fetch(`${origin}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(row.modelName)}`,
            { headers: { Authorization: `Bearer ${row.apiKey}` }, signal: AbortSignal.timeout(15_000) });
          const sj = await st.json().catch(() => null);
          last = (sj?.status ?? 'UNKNOWN').toUpperCase();
          if (['COMPLETED', 'SUCCEEDED', 'SUCCESS', 'FAILED', 'ERROR', 'CANCELED'].includes(last)) break;
        }
        const ok = last === 'COMPLETED' || last === 'SUCCEEDED' || last === 'SUCCESS';
        console.log(JSON.stringify({ label: row.label, ok, stage: 'poll', videoId, finalStatus: last, elapsedMs: Date.now() - t0 }));
      } catch (e) {
        console.log(JSON.stringify({ label: row.label, ok: false, error: String(e.message ?? e).slice(0, 160) }));
      }
    }
  }
}

await db.$disconnect();
