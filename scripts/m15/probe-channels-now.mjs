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

// ---- agnes video 通道探测（R1 核实：队列是否开放；提交 4s 视频 + 轮询状态，不下载成品） ----
// 注：图片边长须 256-5760（openai-compat.ts 实测约束）；首帧取自 storage 现成镜头图
console.log('\n========== agnes video 通道探测（agnes-video-2.5-flash） ==========');
try {
  const videoCfg = cfgs.find((c) => c.channel === 'video' && c.enabled);
  if (!videoCfg) {
    console.log(JSON.stringify({ ok: false, error: '无启用的 video 通道配置' }));
  } else {
    const { readFile } = await import('node:fs/promises');
    const { readdir } = await import('node:fs/promises');
    const pngs = (await readdir('storage/assets')).filter((f) => f.endsWith('.png'));
    if (pngs.length === 0) throw new Error('storage/assets 无 PNG 可用作首帧');
    const imgBuf = await readFile(`storage/assets/${pngs[0]}`);
    const dataUri = `data:image/png;base64,${imgBuf.toString('base64')}`;
    const t0 = Date.now();
    const submit = await fetch(`${videoCfg.baseUrl.replace(/\/$/, '')}/videos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${videoCfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: videoCfg.modelName,
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
      console.log(JSON.stringify({ ok: false, stage: 'submit', http: submit.status, error: String(JSON.stringify(submitJson)).slice(0, 200) }));
    } else {
      const videoId = submitJson?.video_id ?? submitJson?.id ?? submitJson?.task_id;
      if (!videoId) {
        console.log(JSON.stringify({ ok: false, stage: 'submit', error: '提交 200 但未返回 video_id', body: String(JSON.stringify(submitJson)).slice(0, 200) }));
      } else {
        // 轮询 ≤90s：只要见到 RUNNING/COMPLETED 即证明队列真实消化（不等待下载）
        const origin = new URL(videoCfg.baseUrl).origin;
        let last = 'UNKNOWN';
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const st = await fetch(`${origin}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(videoCfg.modelName)}`,
            { headers: { Authorization: `Bearer ${videoCfg.apiKey}` }, signal: AbortSignal.timeout(15_000) });
          const sj = await st.json().catch(() => null);
          last = (sj?.status ?? 'UNKNOWN').toUpperCase();
          if (['COMPLETED', 'SUCCEEDED', 'SUCCESS', 'FAILED', 'ERROR', 'CANCELED'].includes(last)) break;
        }
        console.log(JSON.stringify({ ok: last === 'COMPLETED' || last === 'SUCCEEDED' || last === 'SUCCESS', stage: 'poll', videoId, finalStatus: last, submitLatencyMs: Date.now() - t0 }));
      }
    }
  }
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e.message ?? e).slice(0, 200) }));
}
