// 深挖 cmuw6r7kl 的版本链与 20:53 事件
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const cid = 'cmuw6r7kl014pktgk91ipxxp9';
console.log('════ 版本明细 ════');
const versions = await db.contentVersion.findMany({
  where: { contentId: cid },
  orderBy: { createdAt: 'asc' },
});
for (const v of versions) {
  console.log(`v${v.versionNumber} id=${v.id} method=${v.method} changelog=${v.changelog ?? '-'}`);
  console.log(`  createdAt=${v.createdAt.toISOString()}`);
  const s = v.structureJson ? JSON.parse(v.structureJson) : null;
  const sceneCount = s?.story?.scenes?.length ?? 0;
  let shotCount = 0;
  if (s?.story?.scenes) for (const c of s.story.scenes) shotCount += (c.shots?.length ?? 0);
  console.log(`  structure: style=${s?.style ?? '-'} scenes=${sceneCount} shots=${shotCount}`);
}

console.log('\n════ Provenance 事件流（该作品的完整时间线） ════');
const events = await db.provenance.findMany({
  where: { contentId: cid },
  orderBy: { createdAt: 'asc' },
});
for (const e of events) {
  const payload = (e.payloadJson ?? '').slice(0, 150);
  console.log(`${e.createdAt.toISOString()}  ${e.eventType}  actor=${e.actorType}  ${payload}`);
}

console.log('\n════ Story/Scene/Shot ════');
const stories = await db.story.findMany({ where: { contentId: cid } });
for (const st of stories) {
  console.log(`story id=${st.id} createdAt=${st.createdAt.toISOString()}`);
}
const scenes = await db.scene.findMany({ where: { storyId: { in: stories.map(s => s.id) } }, orderBy: { orderIndex: 'asc' } });
for (const sc of scenes) {
  const shots = await db.shot.findMany({ where: { sceneId: sc.id }, orderBy: { orderIndex: 'asc' } });
  console.log(`  scene ${sc.orderIndex}: ${shots.length} shots`);
}

console.log('\n════ 资产 ════');
const assets = await db.asset.findMany({ where: { contentId: cid }, orderBy: { createdAt: 'asc' } });
for (const a of assets) {
  console.log(`${a.createdAt.toISOString()}  kind=${a.kind} mime=${a.mime} bytes=${a.bytes}`);
}

console.log('\n════ 失败 job 的 outputJson ════');
const job = await db.generationJob.findFirst({ where: { contentId: cid } });
if (job) {
  console.log(`job ${job.id} outputJson=${job.outputJson ?? 'null'}`);
  console.log(`job inputJson=${job.inputJson ?? 'null'}`);
}

await db.$disconnect();
