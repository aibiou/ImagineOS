# ImagineOS 架构理解报告（Architecture Understanding Report）

- 版本：v1.0
- 日期：2026-10-05
- 作者：AI CTO / Principal Architect（GLM-5.3）
- 状态：已定稿，作为 Phase 2～18 的工程基线
- 输入：Master Brief v1.0（97 条）+ Phase 0 仓库勘探结果
- 位置：/docs/architecture/understanding-report.md

---

## 0. 本报告如何产生

本报告基于两个输入：其一，Master Brief v1.0 的完整 97 条指令；其二，Phase 0 对当前工作区与运行环境的实际勘探。勘探结论是：**当前是一个空仓库**（无 package.json、无 prisma、无 src、无 CI、无文档、无测试），但运行环境具备 Node 24 / Bun / FFmpeg / z-ai-web-dev-sdk（后端 AI SDK）/ Prisma-SQLite / Next.js 16 单路由沙箱。

本报告不复述指令原文，只回答 Master Brief 第 66 条要求的十个问题，并给出可执行的工程判断。所有"判断"结论最终汇总为对 Phase 3 的直接输入。环境适配类决策单独记录于 `/docs/decisions/ADR-001`。

---

## 1. 我认为 ImagineOS 是什么

内容平台的历史，是一部攻击不同稀缺性的历史。YouTube 攻击的是分发稀缺性（让作品能被看见）；TikTok 攻击的是创作效率稀缺性（摄像头 + 模板把拍摄门槛降到零）；而 ImagineOS 攻击的是**能力稀缺性**——导演思维、摄影、表演、剪辑、配乐这些过去需要专业团队协作才能获得的表达能力。

这个定位决定了产品的重心不在播放器和 Feed，而在两件事上：**把人的表达意图编译成可执行的创作计划**（Intent → Concept → Story → Shot），以及**把创作状态持久化为可继续演化的对象**（Content Object）。前者是"意图编译器"，后者是"创作状态数据库"。

一个关键推论：视频只是这个编译器的第一个目标格式。Intent 层和 Creative Plan 层从第一天起就必须是**媒介无关**的（medium-agnostic），否则未来扩展到角色、世界、互动体验时将需要重写而不是扩展。

**判断**：ImagineOS 的本质 = 人类表达意图的编译器 + 创作状态的数据库。AI 是编译器的执行后端，不是产品本身。

---

## 2. Alpha 要验证什么

Alpha 验证的不是一个技术命题，而是一个**心理命题**：一个没有任何制作能力的普通人，在与 AI 协作完成一个作品后，是否接受它是"我的作品"而不是"AI 生成的东西"。

因此 Expression Success Rate（表达成功率）的测量对象是**归属感**，不是产出物质量。视频质量只是必要条件；用户的主观认可才是充分条件。这解释了 Master Brief 中几条 UX 原则的深层原因：

- **Interview 不能变成参数表**——一旦用户感觉在"填表"，归属感就死了（那一刻用户是操作员，不是作者）；
- **Revision 不能覆盖旧版本**——用户的创作历史是其作者身份的一部分；
- **缺信息时 AI 主动默认**——把认知负担从用户转移到系统。

主链上有两个"归属感关键时刻"：① Creative Direction 选择——用户第一次看到自己的意图被反映为一个具体方案（"它懂我"）；② 第一次自然语言修改——"再温暖一点"被听懂并执行（"它在和我合作"）。Alpha 的工程资源应优先保障这两个时刻的体验质量，而不是堆砌功能。

同时定义 Alpha 的失败判据：即视频成功生成，但用户在"不知道怎么改"或"改不动"处流失，即判定主链不成立。

---

## 3. 核心用户是谁

**主验证人群：表达富余 / 技能匮乏者**。有故事、回忆、情绪、知识、表达欲，但不会剪辑、不会摄影、不懂 Prompt。为这一人群的设计推论：对话优先于表单；默认值优先于配置项；"你自己决定"必须是一等公民输入；全程零专业术语（用户永远不应看到"cinematic_realism"这类词，除非翻译成"电影感"）。

**次级人群：技能富余 / 时间匮乏的存量创作者**。他们要的是速度与创意杠杆。Alpha 不以他们为主要验证对象——因为现有工具已能给他们价值，他们无法证伪 ImagineOS 的核心命题。但他们决定了未来 Creator Preferences / My AI Creator 方向的想象空间。

工程含义：所有面向 Alpha 主链的 UI 文案、状态命名、交互形态，以主验证人群的心智为基准设计。

---

## 4. 核心主链是什么

Master Brief 第 63 条的"自行车故事"是金路径，解构如下：

| 步骤 | 负责方 | 工程含义 |
|---|---|---|
| "45 秒视频，记录我和父亲骑自行车" | 用户 | 自然语言进，无参数 |
| Intent | 系统 | NL → 结构化 Intent Object（含默认项标记） |
| Creative Direction ×2-4 | AI 提出 / 用户选 | 归属感时刻①；每个方向含名称/概念/情绪/视觉/时长 |
| Story → Scene → Shot | AI 生成 / 可逐步修改 | Creative Planner 产出结构化计划 |
| AI Generation | 系统 | 异步 Job，状态可观测，失败可重试 |
| Preview | 用户 | 含 AI 参与信息；满意/修改/重生成/发布 |
| "再温暖一点" | 用户 | 自然语言 → 修改层定位（Style/Story/Shot/Audio） |
| Version 2 | 系统 | 新版本，parent_version_id 链，V1 完整保留 |
| Publish | 用户 | 标题/封面/可见性/Remix 权限 + AI 标识 |
| Remix | 其他用户 | 复制可授权结构，血缘入图，原作不动 |

主链最易断裂的两处，从工程角度预判：① Interview 膨胀成问卷（解法：问题价值分级 + 最多 5 问 + 一次一问 + 永远允许跳过）；② Revision 破坏性覆盖（解法：版本链是数据层不变量，不是 UI 功能——任何写路径都禁止 in-place 覆盖语义）。

**判断**：这条链就是 Alpha 的全部。任何不在这条链上的功能，Alpha 一律不做。

---

## 5. Content Object 为什么重要

工具产出**文件**，平台产出**有连续性的对象**。传统平台里"作品 = 一个 MP4"；ImagineOS 里"作品 = 一棵可继续创造的状态树"，视频只是它某个版本的编译输出。

Content Object 是四种未来能力的唯一载体：

1. **版本安全**（Revision 不丢工作）——依赖 version 链；
2. **Remix / Continue**（内容图谱）——依赖 parent_content_id 血缘 + 可授权结构复制；
3. **Provenance / Trust**（来源可信）——依赖 creation_method、provider/model、edit history 的第一手记录；
4. **Social / World 的演化底座**——未来社交是围绕 Content Graph 的发现，世界是跨作品复用的 Character/World 实体。这些是**对既有数据的查询**，不是新系统。

不可逆性论证：如果 V1 只存 MP4 + 一个 metadata 大字段，六个月后 Remix = 逆向工程、版本 = 文件复制、社交 = 无边数据可查，补齐成本等于重构。反之，如果 V1 就落结构化 Content Object，上述功能都变成"对已有关系加一层查询"。这就是 Master Brief 第 11 条"Content Object 必须从第一版就设计正确"的工程含义。

**判断**：Content Object 先于复杂 UI 落地（Brief 第 70 条），因为它是数据层不变量，UI 随时可以换，数据不能重来。

---

## 6. 为什么需要 Model Router

三个理由，重要性递增：

1. **模型更迭是常态**。视频生成处于"寒武纪大爆发"期，今天的最佳模型六个月后大概率被替换。如果业务代码里出现 provider 名字，每次换模型都是全局重构。Router 把"用哪个模型"从代码问题降维成**策略问题**（按任务类型/质量/成本/延迟/可靠性选择）。
2. **可靠性独立于供应商**。Provider 瞬时故障不能变成用户的项目损失（Brief 第 30 条）。Router 层的 Retry + Fallback 让产品 SLA 与任何单一供应商解耦。
3. **资产边界**（最重要）。Brief 第 87 条指出 ImagineOS 的长期资产是 Intent Engine / Planner / Content Object / Revision / Evaluation——全部在 Router 之上。Router 是这条资产边界的物理实现：**边界之上是产品，边界之下是易变的基础设施**。绑死单一模型的公司只是在给别人做皮肤。

工程纪律：业务层出现 `if provider == xxx` 视为架构违规（Lint 层面可检测）；所有外部模型调用只允许出现在 `ProviderAdapter` 实现内部。

---

## 7. 哪些东西 Alpha 不做（以及绝不能省的）

**不做**（Brief 第 11/92 条）：World、完整 Studio 专业控制、完整社交图谱、直播、商城、广告、创作者收益体系、3D/游戏。判断标准统一为："它是否在金路径上？"

**不做但必须留接口**：World 实体（表结构预留）、Character 跨作品复用（实体独立建模）、社交关系（Interaction 表预留 like/save 之外的字段空间）。"为未来留接口，不为未来提前建摩天大楼"的可执行含义：**预留的是数据关系，不是功能代码**。

**绝不能省**（因为无法廉价补课）：

| 不可省项 | 原因 |
|---|---|
| Content/Version 数据结构 | 事后补 = 重构 |
| Remix 血缘（parent_content_id） | 内容图谱的种子边 |
| Provenance 记录 | C2PA 趋势 + 事后无法还原生成历史 |
| Model Router 抽象 | 事后抽离成本最高 |
| Intent 结构化持久 | 它是平台的第一方数据资产 |
| user_specified vs ai_default 标记 | 未来 Creator Preferences / 个性化依赖它 |

---

## 8. 未来如何自然扩展到 Social / World

演化路径是数据驱动的自然涌现，不是新系统开发：

- **Remix 边积累 → Content Graph** → 图上的发现与推荐 = Imagine Social 的雏形。Alpha 的 remix 记录就是第一批边。
- **Character 在多个作品中复用 → Identity Graph** → 角色的持续存在 = 未来"角色经济"的前置。Alpha 的 Character 独立实体建模（不内联在 Scene JSON 里）是关键预留。
- **多个作品共享世界观 → World** → World 实体从内容关系中提取。
- **最后才是 Economy**——顺序 Expression → Creation → Content → Social → World → Economy 不可倒置，因为没有表达基础的生态没有可交易之物。

Alpha 的具体预留点（将落入 Schema）：`parent_content_id`（Remix 血缘）、独立 `Character` 表、`Permission` 表（含 remix_permission）、`Provenance` 表（C2PA-mappable 字段命名）。

Explore 的远期形态也由此推出：推荐不止"看什么"（消费），还有"**你可能创造什么**"（For You to Create）——后者的数据形态是意图相似度，不是观看历史，因此 Intent 的结构化持久化同样服务于它。

---

## 9. 当前仓库有哪些问题

Phase 0 勘探结论（2026-10-05）：

**仓库状态：空仓库。** 仅存在 `download/README.md` 占位文件。无代码、无依赖、无文档、无测试、无 CI、无 worklog。按照 Brief 第 64 条："如果是空仓库：建立合理基础结构"——即从零构建，反而没有历史包袱。

**环境能力矩阵**（约束工程设计的硬事实）：

| 能力 | 状态 | 影响 |
|---|---|---|
| Node 24 / Bun | 可用 | 运行时基线 |
| FFmpeg / FFprobe | **可用** | 媒体管线（转码/合成/缩略图/混音）可完整落地 |
| PostgreSQL / Redis | **不可用** | 数据库用 Prisma+SQLite；队列用 DB-backed Job 表 + 进程内 Worker（接口按 BullMQ 语义设计） |
| z-ai-web-dev-sdk | 可用（仅后端） | 首个且唯一 Provider：LLM（意图/剧本/修订）、图像生成（分镜帧/封面）、TTS/ASR（旁白/语音输入） |
| 对外端口 | 仅 3000（Caddy 网关） | 长任务用轮询（GET /generations/:id），与 Brief 第 53 条一致；不引入额外端口 |
| 用户可见路由 | 仅 `/` | 产品多视图（Home/Imagine/Projects/Content/Profile）以单页 shell 内的客户端视图切换实现 |

**与 Brief 推荐仓库结构的差距及处置**：推荐结构是 apps/packages/workers 多包 monorepo；本环境部署单元是单个 Next.js 应用。处置方案见 ADR-001：以 `src/server/*` 模块边界 1:1 映射 packages 语义，用 ESLint import 规则强制层间依赖方向，保留未来向 pnpm monorepo 平移的完整路径。这是"调整但不破坏边界"（Brief 第 46 条允许的调整）。

---

## 10. 建议的开发顺序

总原则：**由内向外**（domain core → 应用服务 → UI）。理由：金路径的价值密度集中在领域逻辑；没有 UI 的领域层可以用 Golden Dataset 直接验证；没有领域的 UI 只是演示壳。UI 最后做，但 UX 原则（步骤可见性、零参数表、版本不覆盖）从第一天就是设计输入。

依赖顺序（即 Phase 3～15 的排序依据）：

```
Repository Foundation ──► Database Foundation ──► Content Object（域层）
                                                       │
                          Intent Engine ◄──────────────┤
                               │                       │
                          Creative Planner              │
                               │                       │
                          Model Router ◄───────────────┤
                               │                       │
                          Generation Jobs + Media Pipeline
                               │
                          Creator UX（Home/Imagine 流程）
                               │
                          Preview / Revision / Version
                               │
                          Publish ──► Content Page ──► Remix ──► Trust ──► Evaluation ──► Alpha 验证
```

两个排序说明：① Content Object 在 Intent Engine 之前（Brief 第 70 条），因为 Intent 最终持久化为 Content 结构，先有容器后有内容；② Evaluation 贯穿全程但独立成 Phase 17——每个域层完成时同步积累 Golden Cases，Phase 17 做体系化回归。

---

## 11. 本环境关键工程决策（详见 ADR-001）

1. **仓库形态**：单 Next.js 应用 + `src/server` 模块化边界（映射 packages），非 monorepo；
2. **数据库**：Prisma + SQLite（schema 保持 PostgreSQL 兼容，禁止 SQLite 方言依赖）；
3. **队列**：DB-backed GenerationJob 表 + 进程内 Worker 循环，接口对齐未来 Redis/BullMQ；
4. **首个 Provider**：ZAI Adapter（LLM/图像/TTS/ASR），业务层零感知；
5. **Alpha 视频合成路径**：分镜图像生成 + TTS 旁白 + FFmpeg 合成渲染（推轨/叠化/配音时间轴），Router 的 video provider 接口保持可直接替换为真视频模型——这本身符合"AI Creative Orchestra"（多角色协作）而非单模型生成的产品哲学；
6. **多视图导航**：单 `/` 路由 shell + 客户端视图切换。

## 12. 风险登记册（Top 5）

| 风险 | 等级 | 缓解 |
| - | - | - |
| 生成耗时伤害归属感 | 高 | 状态可视化 + 里程碑反馈 + 失败自动重试 |
| Interview 演化成参数表 | 高 | 问题价值模型 + 硬上限 5 问 + Golden Set 回归 |
| 版本/血缘被后期破坏 | 高 | 数据层不变量 + 写路径测试 |
| 生成成本失控 | 中 | 每个 Job 记录成本字段，累计单作品成本 |
| 沙箱与生产环境差异 | 中 | ADR-001 记录全部差异点 + 兼容性纪律 |

## 13. 进入 Phase 3 的直接指令

Phase 0～2 完成（本文档 + Task Tree + ADR-001）。Phase 3 Repository Foundation 按 `/docs/product/task-tree.md` Epic 0 执行：初始化 Next.js 16 工程基线、建立 src/server 模块骨架、ESLint 边界规则、环境变量校验、文档树与 worklog 协议。完成标准见 Task Tree 中 Epic 0 的验收条件。
