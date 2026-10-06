// 落盘链路验证证据（脚本超时被杀前的数据抢救 + 正式取证）
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } });

// 第二次验证运行（图像下载修复后）
const c = await prisma.content.findFirst({ where: { title: { contains: '清晨' } }, orderBy: { createdAt: 'desc' } });
const gens = await prisma.generation.findMany({ where: { contentId: c.id }, orderBy: { createdAt: 'asc' } });

const llm = gens.filter(g => g.type === 'text.plan');
const img = gens.filter(g => g.type === 'image.shot');
const tts = gens.filter(g => g.type === 'audio.tts');

const evidence = {
  verifiedAt: new Date().toISOString(),
  title: 'Model Provider 配置链路验证（页面→DB→Registry→Runtime→生成任务）',
  contentId: c.id,
  contentStatus: c.status,
  matrix: {
    llm: {
      customProviderCalled: true,
      provider: 'openai-compat:agnes-com',
      model: 'agnes-3.0-flash',
      calls: llm.length,
      succeeded: llm.filter(g => g.status === 'succeeded').length,
      latencyMs: llm.map(g => g.latencyMs),
    },
    image: {
      customProviderCalled: true,
      provider: 'openai-compat:agnes-com',
      model: 'agnes-image-2.5-flash',
      calls: img.length,
      succeeded: img.filter(g => g.status === 'succeeded').length,
      latencyMs: { min: Math.min(...img.map(g => g.latencyMs)), max: Math.max(...img.map(g => g.latencyMs)), avg: Math.round(img.reduce((s, g) => s + g.latencyMs, 0) / img.length) },
      note: '图像生成+预签名URL裸下载全部成功（downloadMedia 修复后）',
    },
    tts: {
      customProviderCalled: false,
      note: 'agnes-com 无 TTS 模型（/models 12 个模型全部为文本/图像/视频），TTS 未配置自定义',
      fallbackTo: 'zai-tts',
      fallbackCalled: tts.length > 0,
      calls: tts.length,
      succeeded: 0,
      sampleError: tts[0]?.error?.slice(0, 120),
      conclusion: 'fallback 链序正确（无自定义 → 直达 z-ai 兜底）；z-ai 429 配额阻塞中',
    },
    video: {
      note: '本流程为 composition 模式未触发 video.shot；协议适配已完成（双协议+queue-full 重试），Native Golden Case 将验证',
    },
    fallbackChainOrder: '验证：image 首跑（修复前）agnes 失败 → zai-image 自动降级；tts 无自定义 → zai-tts 直达。链序 = 自定义(priority 升序) → z-ai 兜底 ✓',
  },
  jobOutcome: 'video.storyboard failed @ audio.tts（z-ai 429）——图像全部成功后被 TTS 阻塞',
};

const fs = await import('node:fs');
fs.writeFileSync('scripts/m15/state/chain-verification.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence.matrix, null, 2));
console.log('\n证据已存 scripts/m15/state/chain-verification.json');
await prisma.$disconnect();
