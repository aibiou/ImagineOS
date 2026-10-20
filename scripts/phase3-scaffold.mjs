#!/usr/bin/env node
// ImagineOS Phase 3 / T0.2 — src/server module skeleton (ADR-001 mapping + ADR-002 commands)
// Creates module dirs, boundary READMEs, and typed placeholders. Idempotent.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/home/z/my-project'
const S = join(ROOT, 'src/server')

const dirs = [
  'commands', 'http',
  'db', 'content', 'intent', 'planner',
  'ai/router', 'ai/adapters',
  'jobs', 'media', 'trust', 'auth',
]

const files = {
  'db/README.md': `# packages/database 映射（ADR-001）
Prisma schema: prisma/schema.prisma；Client 入口: @/lib/db。
仅 src/server/** 与 src/lib/db.ts 可引用 client；UI 一律经 API。SQLite 纪律：schema 保持 PostgreSQL 可迁移（禁 SQLite 方言依赖）。`,

  'content/README.md': `# packages/content — Content Object 域层
作品 = 可继续创造的状态树（charter §7 红线）。版本记录 append-only 不可变（ADR-002）。
依赖方向：仅 db/env。禁止 import intent/planner/jobs/media/ai/commands（这些是上层）。`,

  'intent/README.md': `# packages/intent — Intent Engine
NL → 结构化 Intent Object（zod 校验，user_specified vs ai_default 全标记）。
依赖方向：db/env、ai（经 Model Router 调 LLM）。禁止 import planner/jobs/media/content。`,

  'planner/README.md': `# packages/planner — Creative Planner
Intent → Creative Direction → Story → Scene → Shot → Generation Plan，步步可改。
依赖方向：intent、ai、db/env。禁止 import jobs/media/content/commands。`,

  'ai/README.md': `# packages/ai + model-router（Brief §27/§28）
分层：orchestrator → router → adapters → 外部模型。业务层禁止出现 provider 名字与 \`if provider ==\` 判断；
z-ai-web-dev-sdk 仅允许出现在 ai/adapters/**（ESLint 强制）。`,
  'ai/router/types.ts': `// Model Router task types (Brief §27). Alpha provider: ZAI adapter only.
export type RouterTask =
  | 'llm.chat' | 'image.generate' | 'audio.tts' | 'audio.asr'
  | 'video.generate' // 预留：替换为真视频模型时上层零改动（ADR-001）
export interface RouterResult<T> {
  data: T
  provider: string
  model: string
  latencyMs: number
  costEstimate?: number
}
`,
  'ai/adapters/README.md': `# Provider Adapters
唯一允许 import z-ai-web-dev-sdk 的位置。模型差异封装于此；
新增 Provider = 新增 adapter 文件 + router 注册，上层零改动。`,

  'jobs/README.md': `# workers/generation — Generation Jobs
DB-backed 队列 + 进程内 Worker（接口对齐 BullMQ：enqueue/process/retry/fail）。
依赖方向：content、ai、media、db。禁止 import commands/http。`,

  'media/README.md': `# packages/media — Media Pipeline
FFmpeg/FFprobe 管线：转码/缩略图/合成/混音 + Asset 入库（hash/mime/尺寸/storage_location）。
依赖方向：ai、db/env。禁止 import jobs/content/intent/planner。`,

  'trust/README.md': `# packages/trust — Provenance / Trust Layer
provider/model/generationTime/sourceAssets/editHistory 聚合；字段命名 C2PA-mappable。
公开内容 AI Generated / AI Assisted 标识的事实来源。`,

  'auth/README.md': `# packages/auth
Alpha：demo actor（单一演示用户，类型从第一天就是 actor.role，为 RBAC 留位）。
NextAuth 可用时接入，不改变命令层签名。`,

  'http/README.md': `# HTTP 绑定层（ADR-002 薄传输）
route handler = 解析 → executeCommand → 序列化。禁止业务逻辑（ESLint 强制：
api 仅可 import @/server/commands/**、@/server/http、@/server/env）。`,

  // typed placeholders so imports/fixtures resolve before Epic 2/3 land
  'content/domain.ts': `// Creative State Machine (Brief §51) — placeholder, typed from day one.
export const CONTENT_STATES = [
  'IDEA', 'INTENT', 'PLANNING', 'STORY', 'STORYBOARD',
  'GENERATING', 'REVIEW', 'RENDERING', 'READY', 'PUBLISHED',
] as const
export type ContentStatus = (typeof CONTENT_STATES)[number]
export type Visibility = 'PRIVATE' | 'UNLISTED' | 'PUBLIC'
`,
}

for (const d of dirs) mkdirSync(join(S, d), { recursive: true })
let created = 0
for (const [rel, body] of Object.entries(files)) {
  const p = join(S, rel)
  if (!existsSync(p)) { writeFileSync(p, body + '\n'); created++ }
}
console.log(`skeleton ok: ${dirs.length} dirs, ${created} files created`)
