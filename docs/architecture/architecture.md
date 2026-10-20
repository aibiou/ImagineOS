# ImagineOS 架构总览（Architecture）

> 文档地位：系统架构主文档 · GitHub 主事实源
> 源文件：`docs/architecture/architecture-understanding-report.md`（Phase 1 架构理解报告，含 10 问 / R1–R8 风险 / D1–D3 决策全文）
> 定稿：2026-10-06

## 1. 系统一句话

ImagineOS = **意图编译器 + AI 创作管线 + 活内容图谱（Content Object）**，模型层经 Model Router 隔离且可整体替换。

## 2. 分层结构（ADR-0002）

```text
┌─────────────────────────────────────────────┐
│  app 层（src/app）                           │  Next.js App Router 页面 + API 路由
│  禁止直接触 DB；只经 API/服务层              │
├─────────────────────────────────────────────┤
│  core 层（src/core）                         │  领域层：content/intent/planning/jobs/assets/auth
│  禁止 import 模型 SDK；纯领域逻辑+测试护栏   │
├─────────────────────────────────────────────┤
│  ai 层（src/ai）                             │  Intent Engine / Planner / Revision locator
│  + Model Router（registry）+ Provider 适配器 │  provider/model 名唯一合法区
├─────────────────────────────────────────────┤
│  media 层（src/media）                       │  FFmpeg 组合式合成器
├─────────────────────────────────────────────┤
│  workers 层（workers/）                      │  Job 执行器（pipeline-executor）+ 进程内 worker
├─────────────────────────────────────────────┤
│  infra 层（src/infra）                       │  配置 + 存储抽象（S3 语义本地磁盘适配器）
└─────────────────────────────────────────────┘
```

边界纪律由 ESLint 架构守卫强制（app 层禁触 DB、core 层禁绑模型 SDK）。

## 3. 技术基线

| 项 | 决策 | 依据 |
|----|------|------|
| 框架 | Next.js 16 App Router + TypeScript strict（+ noUncheckedIndexedAccess） | D2：单应用内部边界 |
| 数据库 | Prisma + SQLite（Postgres-ready，19 表 §47） | D2；SQLite 约束用 String+Zod 应用层校验解决 |
| 认证 | 最小会话（匿名 cookie → User/Identity，ADR-0003） | D3 |
| 队列 | **无 Redis**：DB 持久化 Job + 乐观锁 claim + 租约超时重入队 | 接口按 BullMQ 语义设计，可平移 |
| AI SDK | z-ai-web-dev-sdk（LLM / 图像 / TTS / 视频） | 唯一 import 点：`src/ai/router/zai-client.ts` |
| 视频合成 | FFmpeg 7.1.5（组合式管线，ADR-0001） + Native video.shot（Rev.2 双路径） | ADR-0001 修订 |

## 4. 关键决策索引（ADR）

| ADR | 主题 | 状态 |
|-----|------|------|
| ADR-0001 | Alpha 视频生成策略：组合式优先 → **Rev.2 双路径（Composition + Native）** | Accepted |
| ADR-0002 | 仓库形态：单 Next.js 应用 + 内部分层 | Accepted |
| ADR-0003 | 认证：最小会话（匿名优先） | Accepted |

## 5. 创作主链（M1 已全链真实运行）

```text
POST /api/imagine/start      → Content(IDEA) + Intent.rawExpression
POST /api/contents/:id/intent       → LLM 结构化抽取（可 ≤5 问访谈）→ INTENT
POST /api/contents/:id/directions   → 2–4 创作方向
POST /api/contents/:id/directions/select → Concept 冻结 → PLANNING
POST /api/contents/:id/story        → 叙述弧+场景 → STORY
POST /api/contents/:id/storyboard   → 镜头配方 → STORYBOARD
POST /api/contents/:id/generate     → 版本密封 + Job 入队（HTTP 快速返回）→ GENERATING
  worker: video.storyboard          → 逐镜图像(并发2) + TTS(并发3) → REVIEW
POST /api/contents/:id/render       → Job 入队 → RENDERING
  worker: video.render              → FFmpeg 合成(final+poster) → READY
POST /api/contents/:id/revision/plan|apply → 修订定位 + 新版本 + 重跑
POST /api/contents/:id/remix        → fork（血缘三件套，原作零改动）
POST /api/contents/:id/publish      → PUBLISHED + Publication
```

## 6. 异步与失败恢复

- HTTP 绝不长请求挂生成（§53）：Job 入队即返回，前端轮询 `GET /api/contents/:id/creation`（含 job 进度）
- 进程内 worker（instrumentation 启动，tick 2.5s，每轮 ≤3 Job）；测试直接调 `runOneTick()`
- 失败不丢工作：Job failed 时状态机原地（§51）；M1.5 补全 GENERATING 态失败恢复入口（regenerate 接受 GENERATING）
- 资产 content-addressed + hash 去重（重试幂等）

## 7. 风险与缓解（R1–R8 摘要）

详见架构理解报告。当前活跃项：
- R3（修订定位误伤）：修订确认点已上线（"我将修改 X"）
- LLM JSON 稳定性：completeJson 统一修复轮
- SQLite 并发写：事务超时 30s（M1.5 P2028 修复）+ 并发限流

## 8. 专题文档

- Content Object：`docs/architecture/content-object.md`
- AI 模型层：`docs/architecture/ai-model-layer.md`
- 信任层：`docs/architecture/trust.md`
