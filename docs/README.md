# ImagineOS 文档地图

> AI 原生下一代视频平台 · Alpha 阶段
> 口号：**想到了，就让它发生。**

## 阅读顺序（新成员 / 新 Agent 必读）

1. `docs/product/product-north-star.md` — 项目宪法：使命、北极星、禁改清单
2. `docs/product/m0-review-m1-direction.md` — **产品负责人 M0 评审结论与 M1 方向（2026-10-06）**
3. `docs/architecture/architecture-understanding-report.md` — 架构理解报告（Phase 1 交付物）
4. `docs/product/development-task-tree.md` — 开发任务树（Phase 2 交付物，当前工作蓝本）
5. `docs/decisions/` — 决策日志（ADR），按编号倒序读最新
6. `docs/evaluations/` — 评测体系与 Golden Dataset
7. `docs/ideas/` — 想法登记簿

## 目录职责

| 目录 | 职责 | 维护规则 |
|------|------|----------|
| `docs/product/` | 产品北极星、任务树、Alpha 范围 | 重大变更须关联 ADR |
| `docs/architecture/` | 架构理解、系统设计、模块边界 | 每个里程碑结束时校对一次 |
| `docs/decisions/` | ADR 决策日志（日期/问题/决定/替代方案） | 只追加，不修改已定 ADR |
| `docs/evaluations/` | 评测维度、Golden Dataset、回归结果 | 每次换模型/Prompt 必须记录运行结果 |
| `docs/ideas/` | 想法管理（防止做着做着忘记最初目标） | 状态流转见 README |

## 冲突裁决规则

- Master Brief（项目总指令）与 ADR 冲突时：**以最新的明确 ADR 为准**（它代表产品负责人最新决定）。
- 任何触及 `product-north-star.md` 中"禁改清单"的变更，**必须升级给产品负责人**，不得由工程侧自行拍板。
- 工程内部决策（技术选型、目录结构等）记录为 ADR 后即可执行，但必须留下替代方案与理由。

## 当前阶段

**M0 Walking Skeleton 已完成并经产品负责人评审通过**（2026-10-06：方向正确，不推翻，M1 增量增强）。
当前：**M1 First Video**（E3 Intent Engine → E4 Planner → E5 Router/Providers → E6 Gen Jobs → E7 Media Pipeline → E7X Platform Surface），见任务树。
