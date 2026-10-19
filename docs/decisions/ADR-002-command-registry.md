# ADR-002：吸收 FigCraft 模式——命令注册表内核与不可变版本记录

- 日期：2026-10-05
- 状态：已决策（AI CTO 权限内，未触碰 §84 红线；MCP 对外暴露部分仅登记为 IDEA）
- 输入：FigCraft（github.com/storytold/figcraft）架构研究 + Master Brief §54/§87/§86

## 问题

FigCraft 最有价值的不是功能，而是四条工程哲学。如何在不违反 §86（不为未来建摩天大楼）的前提下，把它们烧进 ImagineOS 的地基？

## 从 FigCraft 提炼的四条可迁移原则

1. **Agent-ready = 单一命令面**。"Every menu item, tool and drag is a command"——UI、CLI、JSON 通道、MCP 调用同一注册表。对 ImagineOS：Brief §54 的 API 语义不应是"路由里写业务逻辑"，而应是**薄传输层 + 命令注册表**。这直接服务 Stage 2（AI 创作团队驱动管线）、IDEA-002（My AI Creator）、IDEA-004（MCP 对外）——以及 Alpha 自己：Golden Dataset 回归必须打真命令而非 mock。
2. **Engine first，分层构建期检查**。"pure-data document model and a command engine, with a thin, swappable UI on top; layering checked at build time"。对 ImagineOS：ADR-001 的 ESLint 边界升级为**可独立执行的检查命令**（等价 `cargo xtask layers`）。
3. **不可变持久数据**。"document lives in an immutable ordered map, so undo snapshots are cheap"。对 ImagineOS：ContentVersion 是 append-only 不可变记录——版本/恢复/Remix/Provenance 全部因此变廉价且安全（与 Brief §25/§49 天然吻合）。
4. **Never-crash 纪律**。"commands run behind a guard so a bug fails one action, not your session"。对 ImagineOS：每个命令在 guard 内执行，产出类型化错误；一个动作失败绝不升级为会话/任务丢失（UX 原则三的内核化）。

另采纳（轻量）：AGENTS.md 仓库入口（FigCraft 有专门给 AI 贡献者的入口文档；我们本就是多智能体协作仓库）；模板内容由命令 API 生成（回归用例打真命令，与原则 1 一体）。

## 决策（Alpha 落地范围）

1. **命令注册表（内核核心）**：新增 `src/server/commands/`。
   - 命令 = `名称 + zod input schema + 权限声明 + handler`，handler 内完成一个数据库事务。
   - HTTP route handlers 成为薄绑定层（解析→调命令→序列化），**禁止在 route 内写业务逻辑**。
   - Alpha 消费方：HTTP API、内部编排器（Imagine 流程）、Vitest 集成测试、Phase 17 Golden 回归。
   - **刻意不做**（Future，防过度工程）：动态发现、插件系统、能力协商、MCP 传输——注册表保证这些未来只是"加一个薄适配器"。
2. **不可变版本记录**：ContentVersion 行 append-only；一切编辑产生新版本记录（Epic 1 schema 与 Epic 2 域层的硬性不变量，写路径测试断言）。
3. **分层检查命令化**：`bun run layers`（ESLint 边界规则独立入口），与 lint/test 并列为验收三命令。
4. **Guard 纪律**：命令统一经 `guard()` 执行；route/worker 顶层捕获并转为类型化错误；ESLint 禁止命令层裸 throw。
5. **AGENTS.md**：仓库根新增，定义 AI 工程智能体的工作协议（指向 worklog/charter/task-tree/DoD）。

## 与 §86（不要过度工程）的边界论证

注册表的最小实现 = 一个 `defineCommand` 工具函数 + 类型 + 注册表 Map（≈100 行）。而它同时消解四个已知未来需求（HTTP/编排/测试/MCP 复用）。不做注册表则 Phase 17 回归只能打 HTTP 或造 mock，Stage 2 需要二次抽离——属于"事后抽离成本最高"类别。结论：这是"为未来留接口"的教科书案例，非摩天大楼。

## 方案 B（否决）：路由内直写业务逻辑，Phase 17 再抽服务层

短期最快，但产生两份真值（路由逻辑 vs 测试逻辑），回归结论不可信；且与 Brief §54 "语义不能混乱"冲突。

## 后果

- Epic 0 新增 T0.7（命令注册表核心 + guard）；Epic 1/2 的写路径测试增加"不可变性"断言；task-tree 同步更新。
- 所有后续 Epic 的任务定义默认以命令为单元（T2.x、T3.x…既是域能力也是注册表命令）。
