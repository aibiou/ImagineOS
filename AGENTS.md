# AGENTS.md — ImagineOS AI 工程智能体工作协议

任何 AI 智能体（或人类贡献者）在本仓库工作前，按顺序读取：

1. `docs/product/charter.md` — 产品宪章与红线（§84 不得擅改清单）
2. `docs/architecture/understanding-report.md` — 架构理解与判断
3. `docs/decisions/ADR-001-*.md`、`ADR-002-*.md` — 环境适配与命令注册表决策
4. `docs/product/task-tree.md` — 当前任务与验收条件（找你的 Task ID）
5. `worklog.md` — 之前智能体做过什么（**先读后写**）

## 硬性工程规则

- **验收三命令**：`bun run lint` / `bun run typecheck` / `bun run test` 全绿；架构边界另跑 `bun run layers`（等价 FigCraft `cargo xtask layers`）。
- **一切能力 = 命令**（ADR-002）：业务逻辑只存在于 `src/server/commands/**`；API route 是薄绑定；UI 只经 HTTP 访问服务端。三者边界由 ESLint 强制，夹具自测在 `tests/boundaries.test.ts`。
- **Provider SDK 隔离**：`z-ai-web-dev-sdk` 只允许出现在 `src/server/ai/adapters/**`；业务层出现 provider 名字即架构违规。
- **版本不可变**：ContentVersion 是 append-only 记录；任何"修改"都是新版本，禁止 in-place 覆盖语义。
- **永不裸崩**：命令在 guard 内执行，错误必须类型化（`AppError`）；一个动作失败不升级为会话丢失。
- **测试打真命令**：集成测试调用 `executeCommand`，禁止 mock 业务逻辑；Golden 回归（Phase 17）同样走命令面。
- **环境**：Next.js 16 单页 shell（用户仅可见 `/`）；Prisma+SQLite（保持 PG 兼容纪律）；无 Redis（DB-backed 队列）；禁 `bun run build`。
- **汇报格式**（Master Brief §83）：完成/修改/原因/验证/测试/风险/已知问题/下一步——逐项输出，禁止只报 "Done"。
- **升级给人**（§85）：涉红线决策 → 输出 问题/影响/方案 A/方案 B/推荐+理由，停止等待。

## 完成定义（DoD，§82）

代码完成 + typecheck + lint + test + 关键路径手测（agent-browser）+ 错误路径测试 + 文档/worklog 更新 + 无回归。
