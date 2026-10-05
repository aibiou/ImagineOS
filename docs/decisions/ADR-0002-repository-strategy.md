# ADR-0002：仓库形态 —— 单应用 + 严格内部边界（逻辑 Monorepo）

- 日期：2026-10-05
- 状态：**Accepted**（2026-10-05 产品负责人确认）
- 决策人：产品负责人（确认方）；GLM-5.3（建议方）

## 问题

Master Brief §46 推荐 `/apps /packages /workers` 的物理 monorepo；但 Phase 0 实测本环境为 Next.js 单应用脚手架 + 无 pnpm/turborepo。Alpha 采用什么仓库形态？

## 背景

§86 要求"为未来留接口，不为未来提前建摩天大楼"。Alpha 团队为单人 AI 开发节奏，物理 monorepo 的脚手架成本（workspace 协议、独立构建管线、跨包类型引用）在当前阶段收益为负。

## 方案 A：完整物理 monorepo

- 优点：与 Brief §46 字面一致；包边界物理隔离最强制
- 缺点：脚手架与构建链成本高；本环境脚手架为单应用，改造成本大且引入工作区协议风险

## 方案 B（采纳）：单 Next.js 应用 + 严格内部模块边界

目录结构（逻辑上等价 monorepo 的边界划分）：

```text
src/
  app/        # UI 层（页面 + API 路由）——只许调用 core 服务
  core/       # 领域层：Content Object / 状态机 / 版本 / 服务（§87 自有资产）
  ai/         # AI 层：Orchestrator / Model Router / Provider Adapter（M1 起）
  media/      # 媒体层：FFmpeg 合成管线（M1 起）
  infra/      # 基础设施：配置校验、存储抽象
  lib/        # 脚手架公共库（db client 等，视为 infra 延伸）
workers/      # 独立 worker 入口（M1 起，进程内循环起步）
```

边界由 **ESLint no-restricted-imports 强制**（见 eslint.config.mjs）：

1. `src/app` 禁止 import `@/lib/db`、`@prisma/*`（UI/API 不直触数据库，必须走 core 服务）
2. `src/core` 禁止 import `z-ai-web-dev-sdk`（领域层不绑定任何模型/SDK——§87）
3. `src/core` 禁止 import `@/media/*`（领域层不依赖媒体实现细节）

## 决定

采用方案 B。

## 影响

- 未来拆物理包（如 ai 层独立发布）是机械动作：目录已是按边界组织的
- 边界违规会被 lint 阻断，DoD 的"lint 通过"即包含架构守卫

## 替代方案（为何不选）

完整 monorepo：见方案 A 缺点；且 §46 明言"可以调整，但必须保持边界清晰"——B 保持了边界，仅物理形态不同。
