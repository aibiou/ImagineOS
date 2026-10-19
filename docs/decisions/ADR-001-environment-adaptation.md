# ADR-001：沙箱环境架构适配（Monorepo 期望 vs 单应用现实）

- 日期：2026-10-05
- 状态：已决策（AI CTO 权限内的工程适配，未触碰 §84 红线）
- 背景：Master Brief §46 推荐 apps/packages/workers monorepo；本运行环境为单 Next.js 16 应用沙箱。

## 问题

Brief 推荐的物理 monorepo 在本环境不可部署（单一部署单元、单端口、无独立 worker 进程、无 Redis/PostgreSQL）。如何既尊重"边界清晰"的强制要求，又不破坏未来向目标结构迁移的能力？

## 影响域

仓库结构 / 数据库 / 任务队列 / 模型接入 / 视频合成路径 / 前端导航。

## 方案 A（已采纳）：模块化单应用

物理上单 Next.js 应用；逻辑上以 `src/server/*` 模块 1:1 承载 packages 语义，边界由 ESLint import 规则强制：

| Brief 目标结构 | 本环境映射 | 边界规则 |
| - | - | - |
| apps/web + apps/api | `src/app`（页面+route handlers） | UI 不得 import server 内部实现，只经 API/server actions |
| packages/database | `src/server/db` | 仅 Prisma client + schema |
| packages/content | `src/server/content` | Content Object 域层 |
| packages/ai + model-router | `src/server/ai`（orchestrator/router/adapters） | z-ai-web-dev-sdk 仅允许出现在 adapter 内 |
| packages/media | `src/server/media` | FFmpeg/资产管线 |
| packages/auth / trust | `src/server/auth` / `src/server/trust` | 鉴权与溯源 |
| workers/generation | `src/server/jobs`（进程内 Worker） | 队列语义对齐 BullMQ |
| /tests | `tests/` + 各域 `__tests__` | Vitest |

关键适配决策：

1. **数据库**：Prisma + SQLite（环境无 PG）。纪律：schema 保持 PostgreSQL 兼容（不用 SQLite 专有特性），生产切换只改 provider。
2. **队列**：GenerationJob 表 + 进程内 Worker 循环 + 前端轮询 `GET /api/generations/:id`。接口按 `enqueue/process/retry/fail` 设计，生产替换为 BullMQ+Redis 时 Worker 内核不动。
3. **Provider**：仅一个 ZAI Adapter（LLM/图像/TTS/ASR），经 Model Router 暴露；业务层零供应商感知。
4. **视频合成**：Alpha 无真·视频生成模型接入，采用 **分镜图像 + TTS + FFmpeg 合成**（AI Creative Orchestra 编排式实现）；Router 的 `video.generate` 接口预留，未来替换为真视频模型时上层零改动。
5. **导航**：用户仅可见 `/` 路由 → 单页 shell + 客户端视图切换承载 Home/Imagine/Projects/Content/Profile。

## 方案 B（否决）：强制物理 monorepo（pnpm workspaces）

优点：结构与 Brief 字面一致。缺点：本环境无法运行/部署多包（单部署单元、预置脚本面向单应用）、初始化与 CI 复杂度显著上升、违反"不为未来提前建摩天大楼"。仅在未来获得真实多服务部署环境时重开此决策。

## 推荐与理由

选 A：**边界是逻辑纪律（Lint 强制），不是目录数量**。Brief §46 自己允许"可以调整，但必须保持边界清晰"。方案 A 以最低成本保留全部边界语义与迁移路径。

## 重开决策的触发条件

- 获得多服务/多端口部署环境；
- 接入需要独立扩缩容的 GPU worker；
- 团队规模增长导致单仓编译/权限冲突。

## 后果与风险

- 风险：模块边界靠纪律维持，若 lint 规则松弛会退化为大泥球 → 缓解：T0.3 将规则落入 CI。
- 生产差异点全部记录于 understanding-report §9 能力矩阵，迁移时按表核对。
