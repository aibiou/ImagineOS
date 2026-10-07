// 验证看门狗对存量孤儿的修复效果 + 创作页 API 失败态暴露
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const ids = [
  'cmuw6r7kl014pktgk91ipxxp9',
  'cmuwrzppc0003kacwvd9rhbdl',
  'cmuwrfsye000vka4rr7fdevzw',
];

console.log('═══ 看门狗对 3 条存量孤儿的处理结果 ═══');
for (const id of ids) {
  const c = await db.content.findUnique({ where: { id } });
  if (!c) { console.log(`${id} 不存在`); continue; }
  const marker = c.lastErrorJson ? JSON.parse(c.lastErrorJson) : null;
  const events = await db.provenance.count({ where: { contentId: id, eventType: 'generation_failed' } });
  console.log(`${id}`);
  console.log(`  status=${c.status}  lastError=${marker ? `${marker.code}: ${marker.message.slice(0, 50)}…` : 'null'}  溯源事件=${events}`);
}

// 其余 GENERATING/RENDERING 状态是否仍有未标记的
const remaining = await db.content.count({
  where: { status: { in: ['GENERATING', 'RENDERING'] }, lastErrorJson: null },
});
console.log(`\n未标记的 GENERATING/RENDERING 孤儿剩余：${remaining}`);

await db.$disconnect();
