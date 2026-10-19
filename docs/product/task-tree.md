# ImagineOS Alpha 开发任务树（Development Task Tree）

- 版本：v1.0
- 日期：2026-10-05
- 依据：Master Brief 第 67 条 / understanding-report.md
- 位置：/docs/product/task-tree.md

---

## 使用说明

- 层级：**Epic → Feature → Task**，每个 Feature 携带**验收条件（AC）**与**测试策略**。
- 任务 ID 稳定（如 `T3.2`），后续 worklog、commit message、代码注释统一引用。
- 优先级：`P0` = 金路径关键路径；`P1` = 信任与可运营性；`P2` = 增强项。
- DoD（完成定义）对所有任务生效，见文末"全局纪律"。**P0 任务的 AC 全部通过前，禁止开启下一个 Epic 的 P0 任务。**
- 第一优先级链（Brief 第 67 条）：Intent → Content Object → Generation → Revision → Publish → Remix。
  工程顺序上 Content Object 先于 Intent（理由见 understanding-report §10）。
- **设计先行**（2026-10-19 产品负责人批准）：Epic 7~10 的界面实现以 /docs/design（UX 设计先行包 v1）为验收依据，体验性 AC 条款以其 05 红线清单为准；Epic 1/2 的数据层设计输入见 ADR-003（事件溯源 Content Object）。

---

## Epic 0 — Repository Foundation（对应 Phase 3）

**目标**：空仓库 → 可验证的工程基线。

| ID | Task | P | 要点 |
| - | - | - | - |
| T0.1 | 初始化 Next.js 16 + TS strict 工程 | P0 | 运行环境初始化脚本；`bun run lint` 通过 |
| T0.2 | 建立 `src/server` 模块骨架 | P0 | `content / intent / planner / router / jobs / media / trust` 七个模块目录 + 每模块 README（职责边界） |
| T0.3 | ESLint 层间依赖规则 | P0 | UI 不得 import server 内部；server 各模块只允许声明方向的 import；`if provider ==` 模式检测 |
| T0.4 | 环境变量校验 | P0 | zod schema 校验 env；启动时失败即报错 |
| T0.5 | 测试基线 | P0 | Vitest 就绪；`bun run test` 可运行；域层测试目录约定 |
| T0.6 | 文档树 + worklog 协议生效 | P0 | /docs 五目录 + worklog.md 模板落地 |
| T0.7 | 命令注册表核心 + guard（ADR-002） | P0 | `src/server/commands/`：defineCommand（zod schema+权限声明+handler+事务+guard）；route 层禁业务逻辑（lint 强制）；`bun run layers` 分层检查命令 |

**AC**：lint / typecheck / test / layers 四命令全绿；模块骨架存在且 README 声明职责；env 校验在缺变量时阻断启动；命令注册表被 walking skeleton 的健康检查命令真实走通（DB→命令→API→UI）。
**测试策略**：lint 规则自身用示例违规文件验证会报错。

---

## Epic 1 — Database Foundation（对应 Phase 4）

**目标**：核心 Schema + Repository 层。

| ID | Task | P | 要点 |
| - | - | - | - |
| T1.1 | Prisma Schema 核心实体 | P0 | User / Project / Content / ContentVersion / Intent / CreativePlan / Story / Scene / Shot / Character / World(预留) / Asset / Generation / GenerationJob / Permission / Provenance / Remix / Publication |
| T1.2 | 版本链与血缘建模 | P0 | `ContentVersion.parentVersionId` 自引用；`Content.parentContentId`（Remix 血缘）；`currentVersionId` |
| T1.3 | Provenance 字段设计 | P1 | provider/model/generationTime/sourceAssets/editHistory/humanContribution；字段名 C2PA-mappable |
| T1.4 | Migration + Seed | P0 | `bun run db:push` 幂等；seed 提供演示用户与示例内容 |
| T1.5 | Repository 层 | P0 | 每实体 typed 数据访问；services 层禁止裸 SQL |
| T1.6 | 成本字段 | P1 | GenerationJob 上 modelCost/storageCost/bandwidthCost |

**AC**：schema 推送成功且 seed 可重复执行；版本链读写单测通过（v1→v2→恢复）；remix 血缘查询返回正确祖先链；SQLite 下 schema 无 PostgreSQL 不可回退依赖。
**测试策略**：Repository 层集成测试（真实 SQLite 文件库）；版本不变量测试（任何写路径不产生覆盖语义）。

---

## Epic 2 — Content Object 域层（对应 Phase 5）

**目标**：作品 = 可继续创造的状态树（先于复杂 UI）。

| ID | Task | P | 要点 |
| - | - | - | - |
| T2.1 | Content 创建/读取/更新 | P0 | content_type / status / visibility / current_version_id |
| T2.2 | 版本链操作 | P0 | newVersion(parent) / listVersions / restoreVersion；旧版本只读 |
| T2.3 | Fork 语义 | P0 | 复制可授权结构 → 新 content_id + 新 version_id + parent_content_id；原作零修改 |
| T2.4 | 创作状态机 | P0 | IDEA→INTENT→PLANNING→STORY→STORYBOARD→GENERATING→REVIEW→RENDERING→READY→PUBLISHED；含 FAILED 与恢复转换 |
| T2.5 | 权限模型 | P1 | owner/visibility(private/unlisted/public)/remix_permission |

**AC**：创建→修改→V2→恢复 V1 全链测试通过；fork 后原作 hash 不变；状态机非法迁移被拒绝并记录。
**测试策略**：状态机全迁移矩阵测试；fork 不变性（字节级）测试；版本树并发写安全测试。

---

## Epic 3 — Intent Engine（对应 Phase 6）

**目标**：自然语言 → 结构化、可验证、可追踪的 Intent。

| ID | Task | P | 要点 |
| - | - | - | - |
| T3.1 | Intent Schema（zod） | P0 | topic/purpose/emotion/audience/format/duration/tone/visualStyle/characters/references/constraints；每字段带 `source: user_specified / ai_default` |
| T3.2 | NL→Intent 抽取（LLM） | P0 | 经 Model Router 调用；输出必须过 schema 校验，校验失败自动重试修正 |
| T3.3 | Intent Interview | P0 | 最多 5 问、一次一问、每问带 value rationale；信息已足则 0 问 |
| T3.4 | "你自己决定" 处理 | P0 | 触发合理默认 + 默认项标记；不阻塞流程 |
| T3.5 | Intent 持久化与版本化 | P0 | 存入 Content 结构；可 diff |
| T3.6 | 金案例集 v0 | P1 | ≥10 个真实意图进 Golden Set（后续扩到 100，见 Epic 13） |

**AC**："我想做一个 45 秒视频，记录我小时候和父亲一起骑自行车" → 合法 Intent Object，未指定字段全部标记 ai_default；"你自己决定"输入产生有效默认；Interview 产出的每个问题在人审下"值得问"。
**测试策略**：Golden Set 回归（抽取成功率、schema 合法率）；边界输入（一句话/长故事/含情绪词）测试。

---

## Epic 4 — Creative Planner（对应 Phase 7）

**目标**：Intent → 概念方向 → Story → Scene → Shot，步步可改。

| ID | Task | P | 要点 |
| - | - | - | - |
| T4.1 | Creative Direction 生成 | P0 | 2-4 个方向；每个含名称/一句话概念/情绪/视觉方向/预计时长；差异化约束 |
| T4.2 | Story/Scene/Shot 规划 | P0 | 结构化持久；Shot 含画面描述/时长/旁白/音效/参考 |
| T4.3 | 分步修改 | P0 | 修改任一层级 → 生成新 plan 版本（不覆盖） |
| T4.4 | Character 实体化 | P1 | 人物独立建模（角色名/外貌锚点/一致性引用），不内联 JSON |
| T4.5 | 计划→生成计划编译 | P0 | Shots → GenerationPlan（每 shot 的生成任务清单） |

**AC**：自行车案例全链产出 2-4 方向 + 完整 3 层结构；改 Scene 后 Story 不被重写（最小扰动）；生成计划可被 Epic 5/6 直接消费。
**测试策略**：结构完整性断言；修改最小扰动的 diff 测试；方向差异化抽样人审。

---

## Epic 5 — Model Router（对应 Phase 8）

**目标**：业务层与模型解耦；只接 ZAI 一个 Provider。

| ID | Task | P | 要点 |
| - | - | - | - |
| T5.1 | 任务类型与 Provider 接口 | P0 | `llm.chat / image.generate / audio.tts / audio.asr / video.generate(预留)`；统一 requestId/错误/成本/耗时返回结构 |
| T5.2 | ZAI Provider Adapter | P0 | 封装 z-ai-web-dev-sdk；业务层禁止直接 import SDK（Lint 强制） |
| T5.3 | 选择策略 | P1 | 按 task type 的静态路由表起步（Alpha 只有一个 provider，策略接口留好） |
| T5.4 | Retry + Fallback | P0 | 指数退避；超时；失败换 provider（当前为同 provider 重试）；job 不因瞬时故障丢失 |
| T5.5 | 调用观测记录 | P1 | 每次 router 调用落库：provider/model/latency/cost/status |

**AC**：业务代码 `rg "z-ai-web-dev-sdk"` 仅命中 adapter 文件；模拟 provider 失败 → 自动重试 → 仍失败 → job 标记 FAILED 且内容状态无损；router 层单测全覆盖。
**测试策略**：adapter 单测（mock SDK）；故障注入测试；禁止依赖的 lint 规则测试。

---

## Epic 6 — Generation Jobs + Media Pipeline（对应 Phase 9/10）

**目标**：异步、可观测、失败安全的生成与渲染。

| ID | Task | P | 要点 |
| - | - | - | - |
| T6.1 | GenerationJob 模型与状态机 | P0 | PREPARING→PLANNING→GENERATING→RENDERING→FINISHING→READY / FAILED；retry_count/timeout |
| T6.2 | 进程内 Worker + 轮询 API | P0 | DB-backed 队列；`GET /api/generations/:id` 轮询；接口对齐未来 BullMQ |
| T6.3 | 分镜图像生成编排 | P0 | 每 Shot 一图（含角色一致性参考传递） |
| T6.4 | TTS 旁白管线 | P0 | 旁白文案→语音→时长探测（ffprobe） |
| T6.5 | FFmpeg 合成渲染 | P0 | 图序列 + 旁白 + 音乐 → MP4：Ken Burns/叠化/时间轴对齐/转场；封面帧提取 |
| T6.6 | Asset 管线 | P0 | 统一入库（hash/mime/duration/尺寸/storage_location）；类型 ORIGINAL/GENERATED/Derived/PREVIEW/THUMBNAIL/FINAL |
| T6.7 | 失败恢复与重试端点 | P0 | `POST /api/generations/:id/retry`；断点续跑（已完成 shot 不重生成） |

**AC**：提交生成后关闭页面再回来，进度仍在（持久化）；注入 shot 级失败 → 重试只补失败部分；最终 MP4 时长与计划偏差 <10%；全流程无长阻塞 HTTP 请求。
**测试策略**：job 状态机矩阵测试；幂等重试测试；FFmpeg 渲染产物 ffprobe 校验（时长/流/音轨存在）。

---

## Epic 7 — Creator UX（对应 Phase 11）

**目标**：金路径可点击走通，零 Prompt 词汇。

| ID | Task | P | 要点 |
| - | - | - | - |
| T7.1 | 单页应用 Shell + 视图切换 | P0 | Home / Imagine / Projects / Content / Profile 客户端切换（单 `/` 路由约束） |
| T7.2 | Home：Explore + Imagine 双入口 | P0 | 核心问句"你想表达什么？"；Text 输入起步（Voice/Image 输入 UI 预留） |
| T7.3 | Imagine 流程编排 | P0 | input→interview→direction 选择→计划确认→generating→preview；Zustand 状态机映射 §55 前端状态 |
| T7.4 | 步骤可见性 | P0 | 任何时刻用户知道"我在哪一步、AI 在干什么、接下来是什么" |
| T7.5 | Projects 视图 | P1 | Drafts/Creating/Finished/Published 分组；封面/标题/状态/更新时间 |
| T7.6 | 生成等待体验 | P1 | 里程碑反馈（分镜完成 N/M、渲染中…）；轮询 + 乐观 UI |

**AC**：新用户 5 分钟内从一句话走到 Preview（不读任何文档）；全程无技术术语暴露；刷新页面流程状态不丢（服务端恢复）。
**测试策略**：Agent Browser 端到端金路径手测；状态恢复测试（中途刷新）；文案术语审查清单。

---

## Epic 8 — Preview / Revision / Version（对应 Phase 12）

**目标**：第二个归属感时刻——"再温暖一点"被听懂。

| ID | Task | P | 要点 |
| - | - | - | - |
| T8.1 | Preview 页 | P0 | 视频/标题/时长/AI 参与信息；操作：满意/修改/重新生成/发布 |
| T8.2 | 修订解析器 | P0 | NL 修改指令 → 定位（Character/Scene/Shot/Audio/Style/Story）+ 修改动作；经 Router LLM |
| T8.3 | 修订执行 → New Version | P0 | 最小扰动传播（改 Shot 不重写 Story）；产出 V2，V1 完整保留可查看/恢复 |
| T8.4 | 版本对比视图 | P1 | 版本列表 + 恢复 |
| T8.5 | 重新生成（整段/局部） | P1 | 局部重生成只影响目标 shot |

**AC**："再温暖一点"产生 V2 且 V1 可回看；"第二个镜头太快"只改变 shot 2 时长；修订后血缘与 provenance 更新正确。
**测试策略**：修订定位准确性 Golden 用例（≥20 例）；版本不变量回归；局部修改最小扰动断言。

---

## Epic 9 — Publish（对应 Phase 13）

| ID | Task | P | 要点 |
| - | - | - | - |
| T9.1 | 发布元数据 | P0 | 标题/简介/封面（帧提取或生成）/ visibility / remix_permission |
| T9.2 | 可见性执行 | P0 | private/unlisted/public 三级在读取路径强制 |
| T9.3 | AI 标识 | P0 | 公开内容显示 AI Generated / AI Assisted |

**AC**：private 内容对非 owner 请求 404；公开页含 AI 标识与参与信息。
**测试策略**：权限矩阵测试（owner/访客 × 三级可见性）。

---

## Epic 10 — Content Page（对应 Phase 14）

| ID | Task | P | 要点 |
| - | - | - | - |
| T10.1 | 观看页 | P0 | 视频/作者/标题/描述/AI 标识 |
| T10.2 | Like / Save | P1 | Interaction 表（预留关系字段） |
| T10.3 | Remix 按钮 | P0 | 入口调用 Epic 11 |

**AC**：观看页完整展示 + AI 标识；Remix 入口可见性随 remix_permission 变化。

---

## Epic 11 — Remix（对应 Phase 15）

| ID | Task | P | 要点 |
| - | - | - | - |
| T11.1 | Remix 服务 | P0 | 复制可授权结构 → 新 content/version + parent_content_id；remix 者成为新 owner |
| T11.2 | 血缘展示 | P1 | 内容页显示"基于 XX 的创作" |
| T11.3 | Remix 图查询 | P1 | 给定内容 → 后代树 |

**AC**：Remix 后原作（含版本/资产）零变更（字节级断言）；新作者可自由修订其副本；血缘链查询正确。
**测试策略**：remix 不变性测试；多层 remix 链（A→A1→A1'）测试；权限继承测试。

---

## Epic 12 — Trust / Provenance（对应 Phase 16）

| ID | Task | P | 要点 |
| - | - | - | - |
| T12.1 | Provenance 聚合 | P1 | 单内容的 provider/model/generation time/source assets/edit history 聚合视图 |
| T12.2 | AI 参与度分级 | P1 | AI Generated vs AI Assisted 规则化（human_contribution 字段驱动） |
| T12.3 | C2PA 映射评估 | P2 | 字段命名对照表（记录，不实现签名） |

**AC**：任一公开内容可导出完整 provenance JSON；分级标识与实际参与记录一致。

---

## Epic 13 — Evaluation（对应 Phase 17）

| ID | Task | P | 要点 |
| - | - | - | - |
| T13.1 | Golden Dataset 100 例 | P1 | 生活/人物/故事/知识/情绪/想象/商业/纪录 八类覆盖 |
| T13.2 | 回归 Harness | P1 | Intent 抽取 / 修订定位 / 结构完整性 三类自动评测；换 prompt/模型可对比；以 ADR-003 事件流为轨迹源，支持金路径无头回放评测 |
| T13.3 | 指标看板数据 | P2 | 成功率/成本/延迟/流失步骤统计落库 |

**AC**：一条命令跑全量回归并输出对比报告；换 Router prompt 后前后对比可复现。

---

## Epic 14 — Alpha 验证（对应 Phase 18）

| ID | Task | P | 要点 |
| - | - | - | - |
| T14.1 | 核心指标埋点 | P1 | Expression Success Rate / Intent Completion / First Creation Success / Publish Rate / Remix Rate |
| T14.2 | 金路径验收演练 | P0 | 自行车故事全链（含修订 + 发布 + remix）端到端通过 |
| T14.3 | Alpha 验证报告 | P1 | 指标 + 质性观察 → 下阶段建议 |

**AC**：金路径验收演练通过 = Alpha 主链成立的工程判据。

---

## 全局纪律（对所有 Task 生效）

1. **DoD**（Brief §82）：代码 + typecheck + lint + 测试 + build 级验证 + 关键路径手测 + 错误路径测试 + 文档更新 + 无回归，九项全过才算 DONE。
2. **汇报格式**（Brief §83）：完成/修改/原因/验证/测试/风险/已知问题/下一步。
3. **升级决策**（Brief §85）：涉核心使命/商业模式/核心模型大改/隐私与数字分身政策/破坏性迁移 → 输出 问题/影响/方案 A/方案 B/推荐+理由，等待产品负责人决定。
4. **不得擅改红线**（Brief §84）：Content Object 模型、Router 原则、Creation Loop、Remix 方向、Provenance 原则、Alpha 主链。
5. 每完成一个 Epic，向 worklog.md 追加记录，并同步更新本文件状态列。
