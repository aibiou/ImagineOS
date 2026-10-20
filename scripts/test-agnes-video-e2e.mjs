// Agnes 视频协议全链真实测试：真实首帧（库内资产）→ 提交 → 轮询 → 下载
// 目的：在改写 provider 之前，端到端确认协议可行性
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } });

const rows = await prisma.modelProviderConfig.findMany();
const video = rows.find(r => r.channel === 'video');
const base = video.baseUrl.replace(/\/$/, '');
const auth = { Authorization: `Bearer ${video.apiKey}`, 'Content-Type': 'application/json' };

// 1. 取一张真实生成的分镜图（768x1344）
const asset = await prisma.asset.findFirst({
  where: { kind: 'generated', mime: { startsWith: 'image' } },
  orderBy: { createdAt: 'desc' },
});
if (!asset) { console.error('无图像资产'); process.exit(1); }
const { readFile } = await import('node:fs/promises');
const path = await import('node:path');
const fs = await import('node:fs');
const storageRoot = path.resolve(process.cwd(), 'storage/assets');
const localPath = path.join(storageRoot, asset.storageLocation);
console.log(`首帧资产: ${asset.id} (${asset.mime}, ${asset.width}x${asset.height})`);
console.log(`本地路径: ${localPath} → 存在: ${fs.existsSync(localPath)}`);
const imgBuf = await readFile(localPath);
const dataUri = `data:${asset.mime};base64,${imgBuf.toString('base64')}`;
console.log(`data URI 长度: ${(dataUri.length / 1024).toFixed(0)} KB`);

// 2. 提交任务
console.log('\n=== 提交视频任务 ===');
const t0 = Date.now();
const res = await fetch(`${base}/videos`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    model: video.modelName,
    mode: 'keyframe',
    prompt: 'The scene comes alive with gentle natural motion: soft wind moves fabric and hair, light shifts slowly, subtle handheld camera drift. Cinematic, warm tone.',
    first_frame: dataUri,
    seconds: '4',
    size: '720P',
    aspect_ratio: '9:16',
  }),
  signal: AbortSignal.timeout(120000),
});
const submitJson = await res.json().catch(() => null);
console.log(`HTTP ${res.status} (${Date.now() - t0}ms): ${JSON.stringify(submitJson)?.slice(0, 600)}`);

const videoId = submitJson?.video_id ?? submitJson?.videoId ?? submitJson?.id;
if (!res.ok || !videoId) { console.log('\n提交失败，测试终止'); process.exit(1); }
console.log(`\nvideo_id = ${videoId}`);

// 3. 轮询（1.5s 间隔，上限 8 分钟）
const pollUrl = `${new URL(base).origin}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(video.modelName)}`;
console.log(`\n=== 轮询 ${pollUrl.replace(/model_name=[^&]+/, 'model_name=...')} ===`);
let finalJson = null;
const t1 = Date.now();
for (let i = 1; i <= 320; i++) {
  await new Promise(r => setTimeout(r, 1500));
  try {
    const st = await fetch(pollUrl, { headers: auth, signal: AbortSignal.timeout(20000) });
    const sj = await st.json().catch(() => null);
    if (i % 8 === 0 || sj?.status === 'completed' || sj?.status === 'failed') {
      console.log(`[${i}] HTTP ${st.status} status=${sj?.status} progress=${sj?.progress} (${((Date.now() - t1) / 1000).toFixed(0)}s)`);
    }
    if (sj?.status === 'completed' || sj?.status === 'failed') { finalJson = sj; break; }
  } catch (e) {
    if (i % 20 === 0) console.log(`[${i}] 轮询异常: ${e.message}`);
  }
}

if (!finalJson) { console.log('轮询超时（8 分钟）'); process.exit(1); }
console.log(`\n最终状态: ${finalJson.status}，总耗时 ${((Date.now() - t1) / 1000).toFixed(0)}s`);
console.log(`完整响应: ${JSON.stringify(finalJson)?.slice(0, 800)}`);

// 4. 下载视频
if (finalJson.status === 'completed' && finalJson.url) {
  console.log('\n=== 下载视频 ===');
  const t2 = Date.now();
  const dl = await fetch(finalJson.url, { signal: AbortSignal.timeout(240000) });
  const buf = Buffer.from(await dl.arrayBuffer());
  console.log(`HTTP ${dl.status}，${(buf.length / 1024 / 1024).toFixed(2)} MB，耗时 ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  if (buf.length > 10000) {
    const fs2 = await import('node:fs');
    const out = 'storage/generated-test-agnes-native.mp4';
    fs2.writeFileSync(out, buf);
    console.log(`已保存: ${out}`);
    // ffprobe 验证
    const { execSync } = await import('node:child_process');
    try {
      const probe = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,codec_name -of json ${out}`).toString();
      console.log('ffprobe:', probe.trim());
    } catch (e) {
      console.log('ffprobe 失败:', e.message?.slice(0, 200));
    }
  }
}

// 记录测试结果
const fs3 = await import('node:fs');
fs3.writeFileSync('scripts/m15/state/agnes-video-e2e.json', JSON.stringify({
  testedAt: new Date().toISOString(),
  model: video.modelName,
  firstFrameAssetId: asset.id,
  submitLatencyMs: Date.now() - t0,
  submitResponse: submitJson,
  finalStatus: finalJson?.status,
  videoUrl: finalJson?.url,
}, null, 2));
console.log('\n结果已存 scripts/m15/state/agnes-video-e2e.json');
await prisma.$disconnect();
