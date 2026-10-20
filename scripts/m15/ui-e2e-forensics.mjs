// UI E2E 取证：删除前抓取 Generation 账本 + Provenance 事件 + ffprobe 成片
// 用途：解释「生成中标签 (2/3) vs 终态 nativeShots=1」的差异；级联删除会抹掉证据
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';

const CONTENT_ID = process.argv[2] ?? 'cmuz90s4z004vpr5os9fiud1m';
const db = new PrismaClient();

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

const gens = await db.generation.findMany({
  where: { contentId: CONTENT_ID },
  orderBy: { createdAt: 'asc' },
});
console.log(`Generation rows: ${gens.length}`);
for (const g of gens) {
  const input = parse(g.inputJson) ?? {};
  const output = parse(g.outputJson) ?? {};
  const shot = input.shotIndex ?? input.shot ?? '?';
  const err = output.error ? String(output.error).slice(0, 110) : '';
  console.log(`${g.createdAt.toISOString().slice(11, 19)} | ${g.type} | ${g.provider} | ${g.status} | ${g.latencyMs ?? '?'}ms | shot=${shot} ${err}`);
}

const provs = await db.provenance.findMany({
  where: { contentId: CONTENT_ID },
  orderBy: { createdAt: 'asc' },
});
console.log(`\nProvenance events: ${provs.length}`);
for (const p of provs) {
  const data = parse(p.payloadJson) ?? {};
  if ((p.eventType ?? '').includes('mode') || (p.eventType ?? '') === 'ai_generated') {
    console.log(`${p.createdAt.toISOString().slice(11, 19)} | ${p.eventType} | ${JSON.stringify(data).slice(0, 200)}`);
  }
}

const content = await db.content.findUnique({
  where: { id: CONTENT_ID },
  select: { id: true, status: true, visibility: true, currentVersionId: true },
});
const versions = await db.contentVersion.findMany({
  where: { contentId: CONTENT_ID },
  select: { id: true, versionNumber: true, structureJson: true },
});
console.log(`\nContent: ${JSON.stringify(content)} | versions: ${versions.length}`);
for (const v of versions) {
  const recipe = parse(v.structureJson) ?? {};
  const shots = recipe.shots ?? [];
  const motions = shots.map((s) => ({ motion: s.motion ?? undefined, videoAssetId: s.videoAssetId ?? null }));
  console.log(`v${v.versionNumber}: shots=${shots.length} motion/videoAsset=${JSON.stringify(motions)}`);
}

const assets = await db.asset.findMany({
  where: { contentId: CONTENT_ID },
  select: { id: true, kind: true, storageKey: true, durationMs: true, byteSize: true },
});
console.log(`\nAssets: ${assets.length}`);
const finalVideo = assets.find((a) => a.kind === 'video' && !(a.storageKey ?? '').includes('shot'));
if (finalVideo) {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${`/home/z/my-project/storage/${finalVideo.storageKey}`}"`,
      { encoding: 'utf8' },
    );
    const meta = JSON.parse(out);
    console.log('final video ffprobe:', JSON.stringify({
      duration: meta.format?.duration,
      size: meta.format?.size,
      vcodec: meta.streams?.find((s) => s.codec_type === 'video')?.codec_name,
      acodec: meta.streams?.find((s) => s.codec_type === 'audio')?.codec_name,
    }));
  } catch (e) {
    console.log('ffprobe failed:', String(e).slice(0, 120));
  }
}
await db.$disconnect();
