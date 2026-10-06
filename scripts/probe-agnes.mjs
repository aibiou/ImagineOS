// agnes-com 三通道协议直接探测（Phase B 联调前置）
// 目的：在跑完整 Phase B 之前，用最小消耗确认三个端点的协议兼容性
//  - llm   : POST /chat/completions max_tokens=8（近零消耗）
//  - image : 仅探测模型列表存在性 + GET /models（零消耗）——真实生图留给正式链路
//  - video : POST /video/submit 协议探测（提交最小任务，验证 SiliconFlow 风格协议）
//  - models: GET /models 全列表快照（供报告记录）
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } });
const results = [];

function section(name) {
  console.log(`\n${'='.repeat(60)}\n[${name}]\n${'='.repeat(60)}`);
}

async function main() {
  const rows = await prisma.modelProviderConfig.findMany();
  const llm = rows.find(r => r.channel === 'llm');
  const image = rows.find(r => r.channel === 'image');
  const video = rows.find(r => r.channel === 'video');
  const base = llm.baseUrl;
  const key = llm.apiKey;
  const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  // ---------- 1. GET /models（零消耗） ----------
  section('GET /models（零消耗）');
  try {
    const res = await fetch(`${base}/models`, { headers: auth, signal: AbortSignal.timeout(30000) });
    const json = await res.json();
    const ids = (json?.data ?? json ?? []).map(m => typeof m === 'string' ? m : m.id).filter(Boolean);
    console.log(`HTTP ${res.status}，共 ${ids.length} 个模型`);
    console.log('相关模型：', ids.filter(id => /agnes|image|video|tts|audio/i.test(id)).slice(0, 30));
    results.push({ channel: 'models', ok: res.ok, count: ids.length });
  } catch (e) {
    console.log('失败：', e.message);
    results.push({ channel: 'models', ok: false, error: e.message });
  }

  // ---------- 2. LLM 最小调用 ----------
  section('LLM POST /chat/completions（max_tokens=8，近零消耗）');
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ model: llm.modelName, messages: [{ role: 'user', content: '回复两个字：你好' }], max_tokens: 16 }),
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json().catch(() => null);
    const text = json?.choices?.[0]?.message?.content;
    const usage = json?.usage;
    console.log(`HTTP ${res.status}，耗时 ${Date.now() - t0}ms`);
    console.log(`回复: ${JSON.stringify(text)?.slice(0, 120)}`);
    console.log(`usage: ${JSON.stringify(usage)}`);
    results.push({ channel: 'llm', ok: res.ok, latencyMs: Date.now() - t0, usage });
  } catch (e) {
    console.log('失败：', e.message);
    results.push({ channel: 'llm', ok: false, error: e.message });
  }

  // ---------- 3. Video 协议探测（SiliconFlow 风格 /video/submit） ----------
  section('Video POST /video/submit 协议探测');
  const t1 = Date.now();
  try {
    const res = await fetch(`${base}/video/submit`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        model: video.modelName,
        prompt: '一只猫轻轻摇尾巴，画面缓慢运动',
        image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Cat_November_2010-1a.jpg/640px-Cat_November_2010-1a.jpg',
      }),
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json().catch(() => null);
    console.log(`HTTP ${res.status}，耗时 ${Date.now() - t1}ms`);
    console.log(`响应: ${JSON.stringify(json)?.slice(0, 500)}`);
    results.push({ channel: 'video-submit', ok: res.ok, httpStatus: res.status, response: json });

    // 如果提交成功且返回 requestId，做一次状态轮询（只查一次，不等待完成）
    const requestId = json?.requestId ?? json?.id;
    if (res.ok && requestId) {
      console.log(`\n获得 requestId=${requestId}，做一次即时状态轮询...`);
      const st = await fetch(`${base}/video/status?requestId=${encodeURIComponent(requestId)}`, {
        headers: auth, signal: AbortSignal.timeout(15000),
      });
      const sj = await st.json().catch(() => null);
      console.log(`状态查询 HTTP ${st.status}: ${JSON.stringify(sj)?.slice(0, 300)}`);
      results.push({ channel: 'video-status', ok: st.ok, httpStatus: st.status, response: sj });
    }
  } catch (e) {
    console.log('失败：', e.message);
    results.push({ channel: 'video-submit', ok: false, error: e.message });
  }

  // ---------- 4. Image 端点形态探测（不发真实生成请求，只看错误形态判断端点是否存在） ----------
  // 说明：POST 一个空 body 到 /images/generations——若端点存在会返回 400 参数错误（区别于 404 端点不存在）
  section('Image 端点存在性探测（空 body，预期 400=端点存在 / 404=不存在）');
  try {
    const res = await fetch(`${base}/images/generations`, {
      method: 'POST', headers: auth, body: JSON.stringify({ model: image.modelName }),
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => null);
    console.log(`HTTP ${res.status}: ${JSON.stringify(json)?.slice(0, 300)}`);
    results.push({ channel: 'image-endpoint', httpStatus: res.status, note: res.status === 404 ? '端点不存在' : '端点存在（参数错误属预期）' });
  } catch (e) {
    console.log('失败：', e.message);
    results.push({ channel: 'image-endpoint', ok: false, error: e.message });
  }

  // ---------- 汇总 ----------
  section('探测汇总');
  console.log(JSON.stringify(results.map(r => ({ ...r, response: undefined })), null, 2));

  // 保存完整结果供后续报告引用
  const fs = await import('node:fs');
  fs.writeFileSync('scripts/m15/state/agnes-probe.json', JSON.stringify({
    probedAt: new Date().toISOString(),
    baseUrl: base,
    models: { llm: llm.modelName, image: image.modelName, video: video.modelName },
    results,
  }, null, 2));
  console.log('\n完整结果已存 scripts/m15/state/agnes-probe.json');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('探测脚本异常：', e);
  await prisma.$disconnect();
  process.exit(1);
});
