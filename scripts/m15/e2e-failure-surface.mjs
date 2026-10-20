// E2E 验证：创作页 API 失败态暴露（模拟线上孤儿形态）+ 数据清理
// 形态复刻：status=GENERATING + failed Job + lastErrorJson（看门狗/失败传导产物）
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const BASE = 'http://localhost:3000';

// 1) 匿名会话创建作品（拿到 owner 会话 cookie）
const startRes = await fetch(`${BASE}/api/imagine/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'E2E 失败态验证：一艘纸船漂过清晨的河面。' }),
});
const setCookie = startRes.headers.get('set-cookie') ?? '';
const cookie = setCookie.split(';')[0];
const startJson = await startRes.json();
const contentId = startJson.contentId;
console.log(`1. 会话创建 ✓ contentId=${contentId} http=${startRes.status}`);

// 2) 直接落库为线上孤儿同形态（绕过 provider 调用）
const past = new Date(Date.now() - 3600_000);
await db.content.update({
  where: { id: contentId },
  data: {
    status: 'GENERATING',
    updatedAt: past,
    lastErrorJson: JSON.stringify({
      code: 'generation_timeout',
      message: '生成长时间没有进展（可能遇到服务中断），你的创作没有丢，点「重新生成」再试一次。',
      at: past.toISOString(),
    }),
  },
});
await db.generationJob.create({
  data: {
    contentId,
    type: 'video.storyboard',
    status: 'failed',
    error: '[ModelRouter] 能力 image.shot 的全部候选 Provider 失败：zai-image(429)',
    retryCount: 3,
    completedAt: past,
    inputJson: JSON.stringify({ contentId, versionId: null, actorId: null }),
  },
});
console.log('2. 孤儿形态落库 ✓（GENERATING + failed Job + lastErrorJson）');

// 3) 创作页轮询 API —— 修复前 job=null 无限转圈；修复后必须返回失败态
const bundleRes = await fetch(`${BASE}/api/contents/${contentId}/creation`, { headers: { cookie } });
const bundle = await bundleRes.json();
const checks = [
  ['http 200', bundleRes.status === 200],
  ['content.status=GENERATING', bundle.content?.status === 'GENERATING'],
  ['job 非空', bundle.job != null],
  ['job.status=failed', bundle.job?.status === 'failed'],
  ['job.error 含 Provider 信息', typeof bundle.job?.error === 'string' && bundle.job.error.includes('image.shot')],
  ['lastError 非空', bundle.lastError != null],
  ['lastError.code=generation_timeout', bundle.lastError?.code === 'generation_timeout'],
  ['lastError.message 含恢复指引', typeof bundle.lastError?.message === 'string' && bundle.lastError.message.includes('重新生成')],
];
let pass = 0;
for (const [name, ok] of checks) {
  console.log(`   ${ok ? '✓' : '✗'} ${name}`);
  if (ok) pass++;
}
console.log(`3. 创作页 API 失败态：${pass}/${checks.length} 通过`);

// 4) 清理（不污染 Gate 7 导出窗口）
await db.content.delete({ where: { id: contentId } }).catch((e) => console.log('   content 清理失败：', e.message));
const ownerId = await db.user.findFirst({ where: { displayName: { startsWith: '旅人' } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
// 找到刚才会话用户的稳妥方式：通过 Provenance 反查已删——改为直接按时间删本脚本创建的匿名用户
const recentUser = await db.user.findFirst({
  where: { createdAt: { gte: new Date(Date.now() - 10 * 60_000) }, displayName: { startsWith: '旅人' } },
  orderBy: { createdAt: 'desc' },
});
if (recentUser) {
  await db.user.delete({ where: { id: recentUser.id } }).catch((e) => console.log('   user 清理失败：', e.message));
  console.log('4. 清理 ✓（content + 匿名 user 已删除）');
} else {
  console.log('4. 匿名 user 未找到（可能已被级联清理）');
}

await db.$disconnect();
process.exit(pass === checks.length ? 0 : 1);
