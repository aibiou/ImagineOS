// 查询 ModelProviderConfig 表当前配置
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } });

const configs = await prisma.modelProviderConfig.findMany({
  orderBy: [{ channel: 'asc' }, { priority: 'asc' }],
});

console.log(`=== ModelProviderConfig 共 ${configs.length} 条 ===\n`);
for (const c of configs) {
  const keyMasked = c.apiKey && c.apiKey.length > 10
    ? c.apiKey.slice(0, 6) + '...' + c.apiKey.slice(-4)
    : '(空)';
  console.log(`[${c.channel}] #${c.id}`);
  console.log(`  providerType : ${c.providerType}`);
  console.log(`  baseUrl      : ${c.baseUrl}`);
  console.log(`  modelName    : ${c.modelName}`);
  console.log(`  apiKey       : ${keyMasked} (${c.apiKey?.length ?? 0} chars)`);
  console.log(`  enabled      : ${c.enabled}  priority: ${c.priority}`);
  console.log(`  lastTest     : ${c.lastTestStatus ?? '未测试'} @ ${c.lastTestedAt ?? '-'} | ${c.lastTestMessage ?? ''}`);
  console.log(`  verified     : modelVerified=${c.modelVerified ?? false}`);
  console.log('');
}
await prisma.$disconnect();
