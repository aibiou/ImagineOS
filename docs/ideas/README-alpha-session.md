# /docs/ideas — 想法管理（Brief §88）

每个新想法一个条目，使用以下模板。防止项目做着做着忘记最初目标。

```markdown
## IDEA-<序号>: <标题>
- Idea: 一句话
- Problem: 解决什么
- Why It Matters: 为什么重要
- Product Layer: Expression / Creation / Content / Social / World / Economy
- Status: Candidate | Validated | Planned | Building | Shipped | Rejected | Future
- Decision: 当前处置
- Reason Not Now: 为什么现在不做
```

---

## IDEA-001: For You to Create

- Idea: Explore 不只推荐"看什么"，还推荐"你可能创造什么"（基于意图相似度而非观看历史）。
- Problem: 推荐系统把人当消费者，而非潜在的创作者。
- Why It Matters: 落实"从 Consumption Loop 到 Creation Loop"的产品分水岭。
- Product Layer: Social（依赖 Content 层的 Intent 数据积累）
- Status: Future
- Decision: Alpha 不做。数据基础（结构化 Intent 持久化）已在 Alpha 落地。
- Reason Not Now: 无足够内容与意图数据；推荐先服务基础 Explore。

## IDEA-002: My AI Creator（创作者偏好人格）

- Idea: AI 逐渐学习用户的审美、表达习惯、常用角色，形成个性化创作伙伴。
- Problem: 每次创作从零开始，AI 不认识用户。
- Why It Matters: 长期黏性与"创作能力资产"的个体化。
- Product Layer: Creation
- Status: Future
- Decision: Alpha 仅保留 Creator Preferences 基础字段 + Intent 的 user_specified 标记作为数据种子。
- Reason Not Now: 需要足够创作历史数据才有效果，Alpha 无此积累。

## IDEA-003: 真人数字分身出镜

- Idea: 用户本人以数字分身方式出现在自己的作品里。
- Problem: 回忆类内容里"我"的在场感。
- Why It Matters: 表达真实感。
- Product Layer: Creation（Character 层）
- Status: Candidate
- Decision: **升级给产品负责人**——涉真人数字分身政策（charter §10 红区），工程侧仅在 Character 实体预留 reference_assets 字段，不实现。
- Reason Not Now: 政策风险未决。

## IDEA-004: MCP 传输层（对外暴露命令注册表）

- Idea: 在命令注册表（ADR-002）之上加 MCP 传输适配器，让外部 AI Agent 可直接驱动 ImagineOS 创作管线。
- Problem: Stage 2 的"AI 创作团队"与外部 Agent 生态需要一个标准化接入面。
- Why It Matters: 借鉴 FigCraft "同一引擎跑 UI/CLI/MCP"；让 ImagineOS 成为 agent-ready 平台而非封闭应用。
- Product Layer: Creation → Social（跨层）
- Status: Future
- Decision: Alpha 不做。ADR-002 已保证注册表是唯一命令面，MCP 未来 = 一个薄适配器。
- Reason Not Now: Alpha 无外部 Agent 消费方；先让 HTTP/编排/回归三条内部路径证明注册表设计正确。

## IDEA-005: 风格预设插件化（WASM 沙箱）

- Idea: 借鉴 FigCraft 的 WASM 插件系统（计量解释器 + 内存上限 + 权限清单），把视觉风格包做成可扩展插件。
- Problem: 风格目录不可能由官方穷举。
- Why It Matters: 生态扩展性（属于 Stage 3+）。
- Product Layer: Creation
- Status: Future
- Decision: Alpha 风格用数据驱动预设（JSON 风格卡），不引入插件运行时。
- Reference Update (2026-10-19): DeepSeek Harness 的 Cordis 插件内核（MIT，"一切皆插件"）是比 WASM 更贴近 JS 生态的参考系；若未来立项插件系统，优先评估 Cordis 模式而非自研 WASM 沙箱。
- Reason Not Now: §86 禁止提前建摩天大楼；Alpha 的风格扩展性由"风格=数据"保证，已经够用。
