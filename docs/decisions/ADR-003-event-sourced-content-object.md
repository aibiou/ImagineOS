# ADR-003：Content Object 采用事件溯源内核（Event-Sourced Content Object）

- 日期：2026-10-19
- 状态：已决策（方案 1 立项）→ **2026-10-19 降级为 Stage 2 方向**（产品负责人批准：Alpha 期不实施、不迁移。红线语义不受影响——本 ADR 从立项起就只是红线的数据层实现形态之一；Alpha 的版本链/Remix 血缘/Provenance 语义由主线基座既有「快照式版本链 + Provenance 事件日志」混合模型保障，不变量测试兜底。本 ADR 保留为 Stage 2 数据层演进方向：16 种事件目录、I1–I6 不变量、fold 实现策略为届时现成施工图，重新实施前以新 ADR 立项。注：本降级内生于「主线切换至 aibiou/ImagineOS」方案包——若主线切换被否决，则回滚本降级，恢复 ADR-003 为本会话 Epic 1 施工依据）
- 输入：Master Brief §25/§49（版本与 Remix）、§54（API 语义不能混乱）、DeepSeek Harness Trajectory 机制研究（只增不改事件流；resume / fork / search / replay 操作同一条事件流）、FigCraft 不可变文档原则（ADR-002 已部分吸收）、ADR-001（环境适配）、ADR-002（命令注册表）
- 关联 Epic：E1 数据库 / E2 Content Object / E8 修订版本 / E11 Remix / E12 Provenance / E13 评测

## 问题

Content Object 必须同时支撑五个能力：不可变版本链、Fork/Remix 血缘、Provenance（C2PA-mappable）、修订可回放、评测可回归。按常规建模，这会是四套独立机制——实体状态表、版本快照表、血缘关系表、溯源日志表——各自维护一份"真值"。由此产生三个不可修复的结构性风险：

1. **真值分裂**：状态与历史可能不一致（状态被更新而事件缺失，或反之），且一旦发生无法事后对账。
2. **血缘是补录的**：血缘表靠写路径"记得"维护，任何遗漏都造成血缘断链，而 Remix 恰恰是 Alpha 红线。
3. **回放不可能**：评测与调试需要"重放当时发生了什么"，四张表无法重建时序。

DeepSeek Harness 的 Trajectory 给出了结构证明：一条只增不改的事件流，可以让"恢复、分叉、搜索、回放"全部操作同一个数据结构。ImagineOS 需要的五个能力，本质是同一个机制的五种读法。

## 决策

1. **每个作品 = 一条只增不改的事件流。** Content Object 的任何变化（表达、回答、选方向、生成、修订、发布、被 Remix）都表现为追加一条带单调序号的事件。系统中不存在"修改"，只有"再追加"。
2. **当前状态 = 事件流的投影。** `fold(事件流)` 得到完整状态；投影结果可缓存（快照表），但真值只在事件流。缓存可随时丢弃重建。
3. **版本 = 事件流上的书签。** `VersionCheckpointed{label, seq}`。"恢复 v1" = 以 v1 书签为基点继续追加新事件，绝不改写 v1——修订永不覆盖由此成为结构性质而非纪律约定。
4. **Fork/Remix = 引用 + 分叉点。** `Remixed{forked_from{content_id, seq}}`。血缘内生于结构（事件里就有），血缘图只是投影，不需要事后维护血缘表。
5. **生成类事件必含 Provenance 字段。** provider / model / params / prompt 引用 / 成本 / 耗时 / actor——缺失即拒写。C2PA 映射 = 生成类事件按时间序序列化导出（Epic 12 只做字段对照，不做签名）。
6. **写路径唯一。** 一切写操作经命令层（ADR-002），命令的持久化语义 = `appendEvent`。Repository 只暴露 `appendEvent / readStream / fold` 三个原语，不暴露 update / delete。

## Alpha 事件目录（v0）

所有事件携带公共头：`id / content_id / seq / type / schema_version / actor_id / created_at`。

| # | 事件 | 关键载荷 | 服务任务 |
|---|------|----------|----------|
| 1 | ContentCreated | content_type, title | T2.1 |
| 2 | IntentCaptured | raw_expression, parsed_intent（每字段带 source: user_specified / ai_default） | T3.1/T3.2/T3.5 |
| 3 | InterviewAsked | question, rationale, index（≤5） | T3.3 |
| 4 | InterviewAnswered | answer, index, source | T3.3 |
| 5 | DirectionProposed | directions[2..4]（名称/概念/情绪/视觉/时长） | T4.1 |
| 6 | DirectionSelected | direction_id + 方向完整快照 | T4.1 |
| 7 | PlanCompiled | story/scene/shot 蓝图快照, plan_version | T4.2/T4.5 |
| 8 | PlanEdited | target_layer, patch, 最小扰动说明 | T4.3 |
| 9 | GenerationRequested | job_spec | T6.1 |
| 10 | GenerationCompleted | job_id, assets[], provenance{provider, model, params, cost, latency} | T6.3–T6.6 |
| 11 | GenerationFailed | job_id, typed_error, retryable | T6.7 |
| 12 | RevisionRequested | natural_language, parsed_target, diff, applied_events | T8.2/T8.3 |
| 13 | VersionCheckpointed | label, seq | T2.2/T8.4 |
| 14 | Published | visibility, remix_permission, snapshot_seq | T9.1/T9.2 |
| 15 | Remixed | forked_from{content_id, seq} | T11.1 |
| 16 | ProvenanceExported | format, payload_hash | T12.1 |

## 不变量（Epic 1/2 写路径测试的断言目标）

| ID | 不变量 | 测试形态 |
|----|--------|----------|
| I1 | 事件只增不改：不存在 UPDATE/DELETE 事件的代码路径 | Repository 不暴露该原语 + 注入式测试（模拟调用必须被拒） |
| I2 | 状态只能由 fold 得出 | 快照带 last_seq；删除快照后重放，状态必须一致 |
| I3 | 书签只前进：不回退、不删改 | restore v1 后，v2 区间事件仍完整可读 |
| I4 | 血缘内生：任何副本可回溯到源的任意书签 | A→A1→A2 多层链查询返回正确祖先序列 |
| I5 | 生成类事件必含完整 Provenance | 构造缺字段事件 → 拒写且错误类型化 |
| I6 | 修订永不覆盖：修订后旧书签内容字节级不变 | hash 对比断言（与 ADR-002 不可变版本记录同源） |

## 实现策略（SQLite 务实路径）

- 核心表 `content_events(id, content_id, seq, type, schema_version, payload_json, actor_id, created_at)`；`(content_id, seq)` 唯一约束；seq 在 Repository 事务内单调分配。
- 投影：进程内 fold + `content_snapshots` 乐观缓存（携带 last_seq）。Alpha 的缓存失效策略取最简的"启动重放"——单对象事件量级为百级，开销可忽略。**不引入事件溯源框架/中间件**（§86）。
- Prisma 不表达 append-only 语义 → 由 Repository API 面 + 写路径测试双闸强制；实现期评估 SQLite 触发器级禁改（列为 T1.5 评估项，非承诺）。
- 事件 schema 演进：事件带 schema_version；Alpha 期 strict 读策略（遇到未知事件类型报错而非静默跳过），升版走 ADR。

## 与 §86（禁止摩天大楼）的边界论证

本决策不是引入框架，而是**一张表 + 一个 fold 函数（约 150 行）的表结构纪律**。它替代的是"版本快照表 + 血缘关系表 + 溯源日志表 + 回放机制"四件套，净复杂度下降而非上升。同时它一次性满足 Epic 8（版本对比 = 事件 diff）、Epic 11（血缘 = 投影）、Epic 12（Provenance = 序列化导出）、Epic 13（评测 = 轨迹回放）四条**已知**需求——属于 ADR-002 论证过的"事后抽离成本最高"类别。

**否决方案 B（四套独立机制，需要回放时再补）**：短期最快，但真值分裂一旦发生不可修复，Golden 回归结论不可信，与 §54"语义不能混乱"直接冲突。

## 后果

- **Epic 1**：T1.1/T1.2 中的 `ContentVersion` 实体表降级为视图级概念（书签投影）；核心新增 `content_events` 表；T1.2 血缘建模变为 `forked_from` 引用；T1.5 Repository 只暴露三原语。实体表（User/Asset/GenerationJob 等）不受影响——它们是流程支撑数据，不是"作品状态本身"。
- **Epic 2**：T2.2 版本链操作 = 书签 + 投影；T2.3 Fork = 引用 + 分叉事件；状态机（T2.4）迁移本身也是事件（状态 = 最后一个状态类事件的投影）。
- **Epic 8**：T8.4 版本对比视图 = 两书签之间事件 diff；版本时间线 UI 直接渲染事件原文（"你说了：再温暖一点"）——归属感的物证可视化。
- **Epic 12**：Provenance 聚合 = 生成类事件按序导出；C2PA 对照表对齐事件 payload 字段名。
- **Epic 13**：Golden Dataset 每例 = 一条可回放事件流；无头回归 = 重放 + 断言投影（呼应 dsh Minimal 模式的评测思想，T13.2 落地）。
- **IDEA-004（MCP，Future）**：外部 Agent 经 MCP 的每个操作同样落事件流——AI 驱动与 UI 驱动同源、同构、同可溯（dsh Trajectory 同构）。

## 何为成功（验收问题，Epic 1/2 测试中逐一回答）

1. 只凭事件流（删掉所有缓存/快照表）能否重建任意版本的完整状态？
2. Remix 之后，原作事件流是否零新增（被只读引用除外）？
3. "再温暖一点"产生 v2 后，v1 是否字节级可回放？
4. 每个生成类事件能否导出 C2PA-mappable JSON？
5. 不变量测试 I1–I6 是否全绿？
