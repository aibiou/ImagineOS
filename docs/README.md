# ImagineOS 文档地图

> AI 时代的人类表达与视觉创作平台 · GitHub 主事实源
> 口号：**想到了，就让它发生。**

## 事实源声明（2026-10-06 起）

**GitHub 仓库中的产品文档 + 架构文档 + Decision Log + ADR + PRD 是 ImagineOS 的主要项目事实来源。聊天讨论只是辅助信息。** 文档间冲突时：以最新 ADR + 产品宪法共同裁决；触及禁改清单的必须升级给产品负责人。

## 阅读顺序（新成员 / 新 Agent 必读）

1. `docs/product/vision.md` — 愿景：是什么、不是什么、长期路线
2. `docs/product/product-constitution.md` — 产品宪法：第一性原理、七条 UX 原则、禁改清单
3. `docs/product/user-language-rules.md` — 用户语言规则（UI 文案唯一规范）
4. `docs/architecture/architecture.md` — 架构总览：分层、技术基线、主链
5. `docs/architecture/content-object.md` — 核心领域模型（11 层 + 六不变量）
6. `docs/product/alpha-prd.md` — Alpha PRD（唯一 KPI：Expression Success Rate）
7. `docs/product/product-blueprint.md` — 产品蓝图（六环循环 + 载体矩阵 + 里程碑状态）
8. `docs/product/m15-task-tree.md` — **当前里程碑：M1.5 Expression Quality Gate 任务树与执行计划**
9. `docs/decisions/` — 决策日志（ADR），按编号倒序读最新
10. `docs/evaluations/` — 评测体系、Human Test Plan、Golden Dataset
11. `docs/worklog/` — 里程碑摘要索引（详细日志在根 `worklog.md`）

## 目录职责

| 目录 | 职责 | 维护规则 |
|------|------|----------|
| `docs/product/` | 愿景、宪法、蓝图、PRD、语言规则、任务树 | 重大变更须关联 ADR |
| `docs/architecture/` | 总架构、Content Object、AI 模型层、信任层 | 每个里程碑结束时校对一次 |
| `docs/decisions/` | ADR 决策日志 | 只追加；已定 ADR 用 Rev 修订而非改写 |
| `docs/evaluations/` | 评测维度、质量报告、Human Test | 每次换模型/Prompt 必须记录运行结果 |
| `docs/ideas/` | 想法登记簿 | 状态流转见 README |
| `docs/worklog/` | 里程碑摘要 | 每里程碑由当值 agent 追加 |

## 历史文档（有效，作为过程记录）

- `docs/product/product-north-star.md` — 宪法源文件（内容已延续至 product-constitution.md）
- `docs/architecture/architecture-understanding-report.md` — Phase 1 架构理解报告（10 问/R1–R8/D1–D3 全文）
- `docs/product/development-task-tree.md` — Epic E0–E15 全量任务树（M0–M5）
- `docs/product/m0-review-m1-direction.md` — M0 评审结论与 M1 方向（产品负责人）

## 冲突裁决规则

- 聊天讨论与 GitHub 文档冲突时：**以 GitHub 文档为准**。
- Master Brief（项目总指令）与 ADR 冲突时：以最新明确 ADR 为准。
- 任何触及宪法"禁改清单"的变更必须升级给产品负责人，不得由工程侧自行拍板。
- 工程内部决策记录为 ADR 后即可执行，但必须留下替代方案与理由。

## 当前阶段（2026-10-06）

- M0 Walking Skeleton：✅ 完成（经评审：方向正确，不推翻）
- M1 First Video：✅ 完成（全链真实生成 + P0/P1 UI 验收通过）
- **M1.5 Expression Quality Gate：🔶 进行中**（七道闸门 + Native Video 双路径）
- M2：⏸ 等待 M1.5 Expression Quality Report 与产品方向确认，暂不自动进入
