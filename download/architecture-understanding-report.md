# ImagineOS 架构理解报告（Architecture Understanding Report）

- 版本：v1.0
- 日期：2026-10-05
- 作者：GLM-5.3（AI CTO / Principal Software Architect 角色）
- 状态：已交付，待产品负责人评审
- 依据：Master Brief v1.0（97 节）+ Phase 0 Repository Discovery 实测结果
- 本文件位置：`docs/architecture/architecture-understanding-report.md`

---

## 0. 执行摘要

ImagineOS 的本质不是"AI 视频生成器"，而是一台**意图编译器**加一层**活内容资产**：它把人用自然语言表达的模糊意图，编译成可执行的创作结构（Intent → Concept → Story → Scene → Shot），交给可替换的 AI 管线执行，并把结果固化为可版本化、可修订、可分叉、可溯源的 **Content Object**。

Alpha 只验证一个命题——**Expression Success Rate**：普通人只靠说话，能否得到一个自己认可的作品。§63 的"自行车故事"链路就是整个 Alpha 的集成验收测试。

工程上，本环境实测为：**空仓库 + SQLite + FFmpeg 7.1 可用 + 无 Redis + z-ai SDK（LLM/图像/TTS）可用**。据此我建议 Alpha 的视频生成采用**组合式管线**（分镜图像 + 运镜 + TTS + 字幕 → FFmpeg 合成），外部视频模型作为后续 Adapter 接入——这恰好是对 Model Router 抽象的最强验证。开发顺序采用**垂直切片优先**：先用最窄链路走通"意图→作品→发布→Remix"全程，再逐环节深化质量。

---

## 1. 我认为 ImagineOS 是什么（Q1）

三层理解，从用户视角到资产视角：

**表层（用户看到的）**：你说"我想表达 X"，系统帮你把它变成作品。不是填参数，不是写 Prompt，是对话。

**中层（产品逻辑）**：用 **Creation Loop 取代 Consumption Loop**。传统平台的视频是创作的"尸体"——拍完剪完才发布，发布即终结；ImagineOS 的作品发布后仍然活着：可改、可续、可分叉、可共创。内容不是终点，是下一段创作的起点。

**深层（资产结构）**——这是最关键的一层，ImagineOS 拥有三层**自有资产**，模型层则是租来的：

| 资产层 | 内容 | 为什么是护城河 |
|--------|------|----------------|
| L1 意图资产 | Intent Engine + Creative Planner | 把模糊人类意图编译成结构化创作计划的能力，模型换了它还在 |
| L2 内容资产 | Content Object + Version + RemixGraph | 作品的"基因图谱"，Content Graph 是未来 Social/World 的地基 |
| L3 信任资产 | Provenance / Trust Layer | 作品的可信来源链，映射 C2PA 方向 |
| （租借层） | 各类模型 via Model Router | 半衰期 6–18 个月，纯商品 |

**一句话**：ImagineOS = 意图编译器 + AI 创作管线 + 活内容图谱，跑在可替换的模型基础设施上。谁都能调模型，但"意图→作品"的转化管线和内容图谱只能靠产品演化积累——这才是 §87 强调的自有资产清单的真实含义。

---

## 2. Alpha 要验证什么（Q2）

Alpha 唯一 KPI 是 **Expression Success Rate**：用户输入一个表达意图后，最终完成一个自己认可的作品。其余指标（Intent Completion Rate / First Creation Success / Revision Success / Publish Rate / Repeat Creation Rate / Remix Rate）都是诊断指标，用于定位主链哪一环漏水。

这句话里藏着**四个可证伪的产品假设**，Alpha 就是要逐一检验：

- **H1 意图假设**：普通人能用自然语言说清"想表达什么"，而无需学习 Prompt（Intent Interview 兜底：最多 5 问、一次一个、自然简短）。
- **H2 转化假设**：AI 提供的 2–4 个创作方向 + 生成的作品，能达到"用户认可"的水准（认可 = 用户点了"满意"或"发布"）。
- **H3 修改假设**：用户能用自然语言修订（"再温暖一点"→ Version 2）。**这是"认可"的关键机制**——一次性生成几乎从不让人满意，真正的满意度来自"按我的意思改"的能力。
- **H4 回环假设**：作品发布后，Remix 能让内容进入他人的创作循环（Alpha 只需验证通路存在，不验证网络效应）。

**Alpha 明确不验证**：推荐算法、社交关系链、商业模式、World 引擎、创作者收益。这些属于后续 Stage。

---

## 3. 核心用户是谁（Q3）

**U1 表达者（Alpha 主要服务对象）**：有故事、有情绪、有知识、有表达欲，但不会剪辑、不会摄影、不会 Prompt。他们的成败标准是"**这是不是我想说的**"，不是画质参数。他们对"填一堆 AI 参数"极度过敏——一旦界面像参数表，他们就会流失。UX 默认路径必须为 U1 设计：对话式、AI 兜底默认值、一问一答访谈。

**U2 创作者（Alpha 次要服务对象）**：来自抖音/B站/YouTube 等平台，要更快创作、更多创意、更强视觉。他们会说专业语言（"16:9、电影感、推镜头"），系统要能听懂，但**不要求**用户会说。专业控制为 U2 预留，按 UX 原则七"逐步开放"。

设计含义：Alpha 的所有默认流程按 U1 的心智设计；U2 的需求通过"AI 听得懂专业语言"来顺带满足，而不是通过暴露高级参数面板。

---

## 4. 核心主链是什么（Q4）

§63 的链路即主链，逐环节的失败模式与兜底机制如下——**主链的可靠性设计比任何单环节的质量更重要**：

```text
"我想做一个45秒的视频，记录我小时候和父亲一起骑自行车。"
   │ 失败风险：说不清 → Intent Interview（≤5问）→ 仍不清 → AI 合理默认并标记
   ▼
Intent（结构化、可验证、字段级记录"用户指定 vs AI 默认"）
   │ 失败风险：方向不对 → 2–4 个 Creative Direction 供选 + 可重新生成
   ▼
Creative Direction → 用户选择
   │
   ▼
Story → Scene → Shot（每一步可查看、可修改）
   │ 失败风险：模型抖动 → 异步 Job + 重试 + Provider fallback，工作永不丢
   ▼
AI Generation（异步，状态可观测）
   ▼
Preview（视频/标题/时长/AI 参与信息 + 满意/修改/重新生成/发布）
   │ "再温暖一点" → 修订目标定位（Story? Shot? Style? Audio?）→ 新 Version，不覆盖
   ▼
Version 2 → 用户满意
   │ 失败风险：丢字段/丢历史 → parent_version_id 链 + 可恢复
   ▼
Publish（标题/简介/封面/Visibility/Remix Permission + AI 标识）
   ▼
其他用户 Remix → 新 Content + 新 Version + parent 关系，原作不动
```

**深意**：主链上每个"用户节点"都是自然语言交互（表达意图、选方向、说修改、决定发布），每个"AI 节点"都产出可持久化的结构（Intent、Plan、Version、Provenance）。**用户贡献语言与判断，系统贡献结构与产物**——这就是"我在表达"而非"我在填参数"的工程本质。

---

## 5. Content Object 为什么重要（Q5）

**传统平台的 MP4 是棺材**：创作过程死了才发布；发布后不可改、不可分叉、不可续，版权与血缘也无从追溯。

**Content Object 是作品的三维生命体**：

- **向过去看（Provenance）**：谁创作、用了什么模型、什么素材、多少人工参与、编辑历史——来源可信不是未来补丁，是第一版字段。
- **向现在看（Version/Revision）**：作品活着。自然语言修订创建新版本，旧版本保留可恢复，AI 失败不丢工作。
- **向未来看（Remix/Continue → Content Graph）**：作品成为别人创作的种子。`Original → Remix A → Remix A1 / Remix B / Continue C` 的树生长成图，这是 Social 层的地基——**创作上的师承关系（Remix 血缘）比点赞关系更结构化**。

**四条工程含义**：

1. **保存配方，不只保存菜**：intent/plan/shots 是配方，assets/generations 是产物。模型升级后可以对同一配方重新生成新版本——作品因此获得"模型无关的再生能力"。
2. **领域模型中不出现模型名**：provider/model 只存在于 Provenance 与 GenerationJob 记录，Content 结构本身模型无关。
3. **Remix 是结构复制 + 血缘记录，不是文件拷贝**：新作者拿到可编辑的完整创作结构，原作不可变。数据库从第一版就要有 `parent_content_id / parent_version_id`。
4. **状态机驱动生命周期**：`IDEA → INTENT → PLANNING → … → PUBLISHED` 的每次跳转都是可审计事件。

**战略含义**：Content Object 是 §87 自有资产清单的核心。换模型它活着，做 Social 它是地基，做 World 它是容器。Alpha 第一版把它设计对了，后面的 Stage 全是"实体升级"而不是"推倒重来"。

---

## 6. 为什么需要 Model Router（Q6）

**根本原因：模型是商品，且商品化速度在加快**。视频模型约半年一代，价格/质量/速度持续洗牌。任何 `if provider == "xxx"` 的业务代码，都是在按模型发布频率复利积累技术债。

四条工程理由：

1. **选择（Selection）**：剧本、分镜、图像、TTS、视频、分析——不同任务天然需要不同模型；同任务还要按质量/速度/成本/上下文/人物一致性/供应商状态路由（§29）。
2. **隔离（Isolation）**：各供应商的参数差异、速率限制、计费方式、内容政策差异，全部封装在 Provider Adapter 内。业务层只见统一接口。
3. **韧性（Resilience）**：重试 + 降级 + fallback 链。供应商瞬时故障 ≠ 用户丢项目（§30，对应 UX 原则三）。
4. **可观测（Observability）**：按 provider/model 记录成本、成功率、延迟——这是回答"哪个模型失败最多/最贵/最慢"（§58）的数据基础，也是成本系统（§62）的记账源头。

调用链纪律：`Application → AI Orchestrator → Model Router → Provider Adapter → Model`。模型名允许出现的位置：Provenance、日志、成本表、评测报告。禁止出现的位置：领域模型、业务分支逻辑。

**Alpha 的现实策略（关键）**：本环境没有外部视频 API 凭据，但有 LLM/图像/TTS SDK 和 FFmpeg 7.1。因此第一个"视频 Provider"是**内部组合式管线**：`分镜 → 逐镜头图像生成 → Ken Burns 运镜 + 转场 → TTS 旁白 + 音乐 → 字幕 → FFmpeg 合成 MP4`。它便宜、可控、可回归测试，且**足以验证全部产品假设**（意图理解、方向选择、自然语言修订、版本、发布、Remix——这些和像素怎么来的无关）。未来接入真正的视频模型，只是注册一个新 Adapter，业务层零改动。详见 ADR-0001（待确认）。

---

## 7. 哪些东西 Alpha 不做、留什么（Q7）

原则：**为未来留接口，不为未来提前建摩天大楼**（§86）。逐项"不做 → 留"：

| Alpha 不做 | 留下的接口 |
|-----------|-----------|
| Imagine World / World Engine | Content Object 的 `World`、`Character` 结构字段（先 JSONB，暂不实体化） |
| 完整 Imagine Studio | Creative Orchestra 的角色产物结构（Writer/Director/Cinematographer/… 的输出字段进 Plan/Story/Shot） |
| 完整社交系统（关注/粉丝/评论） | `Permissions` + `RemixGraph` + like/save 最小集 |
| 直播 / 商城 / 广告 | 不建表不写码 |
| 完整创作者收益体系 | Provenance 记录 human contribution + Remix 血缘（未来分账的账本基础） |
| 复杂 3D / 游戏系统 | 无（连接口都不留） |
| "My AI Creator" 完整记忆 | `CreatorPreferences` 表（语言/默认比例/默认风格/默认偏好） |
| Explore 智能推荐（For You to Create） | 基础列表 + 数据埋点位；"推荐你可能创造什么"登记为 Future 想法 |
| 语音/图片/视频素材输入的完整理解 | Imagine 入口 UI 预留多模态输入位，Alpha 先打通 Text |

判断标准：每张表、每个字段问一句"删掉它，未来 Social/World 要不要推倒重来？"——要，就留；不要，就不建。

---

## 8. 未来如何自然扩展到 Social / World（Q8）

三条扩展路径，全部表现为**既有字段的实体化/显性化**，而非重构：

1. **Content Graph → Social**：Alpha 的 RemixGraph 本身就是图结构——Remix 是边、作品是节点。Social 层上线时，"作品的图"已经在数据里长了几个月；人的图（关注/粉丝）只是给"人的节点"补边。而且 Remix 血缘天然构成"创作师承网络"，这比点赞网络更有价值的社交资产。
2. **Character/World 字段 → World**：Alpha 里角色是每次作品的私有描述（JSONB）；当同一 `character_id` 出现在多个作品、被多人 Remix 时，把它**提升为一等实体**（跨作品共享、持续存在）——"世界"就出现了。这是数据推广（promotion），不是重写。
3. **Provenance + Permissions → Economy**：human/machine 贡献记录 + Remix 血缘 + 授权语义，就是未来收益分配的账本。

这正是 §23"数据库和接口必须从第一版为这一方向留空间"的工程含义：**留的是关系和外键，不是功能。**

---

## 9. 当前仓库状态与问题（Q9，基于 Phase 0 实测）

实测结果（2026-10-05）：

| 项目 | 状态 | 结论 |
|------|------|------|
| 代码 | **空仓库**：仅 `download/README.md`，无 package.json / src / 依赖 | 从零建立 Repository Foundation（§68） |
| Git | 已初始化，1 个 Initial commit，无 remote，工作区干净 | 版本控制可用；CI/remote 后补 |
| 文档 | 无 /docs | 本轮已建立完整 /docs 地基 |
| 数据库 | `DATABASE_URL=file:...custom.db` → **SQLite**；无 Postgres 服务 | 模型设计须兼容未来迁移 PostgreSQL |
| Redis | 无 redis-cli / 服务 | **BullMQ 不可用** → Job 队列需 DB 持久化 + 乐观锁 claim 的自建方案 |
| FFmpeg | **7.1.5 可用** | 组合式视频管线（ADR-0001 方案 B）环境就绪 |
| Node/包管理 | Node v24.21.0 / npm 11.19.0；无 pnpm | 用 npm workspaces（如需 monorepo） |
| AI 能力 | z-ai SDK：LLM / 图像生成 / TTS / VLM | Intent Engine、Planner、组合式 Provider 的模型来源就绪 |

**核心问题清单（按严重度）**：

1. **一切从零开始**——没有仓库结构、没有 schema、没有任何服务。这是机会也是风险：好处是没有历史包袱，可以一次把边界划对；风险是容易在脚手架阶段就破坏未来架构（比如把业务逻辑写进 UI 组件、把模型名写死在业务层）。
2. **SQLite 的三处约束**：(a) 并发写串行 → Job 队列不能用 `SELECT … FOR UPDATE SKIP LOCKED`，须用**乐观锁版本字段 claim**；(b) 无原生 JSONB/数组 → 用 JSON 文本 + 应用层 Zod 校验；(c) 迁移到 Postgres 时 SQL 方言差异 → 统一走 Prisma 迁移，禁止裸 SQL 散落。
3. **无 Redis/独立 Worker 基础设施** → Alpha 用**进程内 worker 循环 + DB 持久化 Job 表**（崩溃恢复靠 Job 状态机，不靠内存队列）。接口按 BullMQ 语义设计，未来可平移。
4. **单人 AI 开发节奏** → 必须用 DoD（§82）+ 任务树 + worklog 纪律对抗"读一半就实现、没测试就说完成"的漂移。

---

## 10. 建议的开发顺序（Q10）

**两个排序原则**：

- **垂直切片优先**：Alpha 的风险在"链路是否成立"（产品假设），不在"单环节质量"（模型能力——它会随模型迭代自然变好）。集成风险 > 组件质量风险。所以先用最窄链路端到端走通，再逐环节深化。
- **领域层先于 UI**（§70）：Content Object 先于复杂界面。UI 是壳，壳可以换，核不能换。

**里程碑规划**（每个里程碑都有可演示物；与 §96 Phase 3–18 的映射见任务树 §18）：

| 里程碑 | 内容 | 可演示物 | 覆盖 Phase |
|--------|------|----------|-----------|
| **M0 Walking Skeleton** | 仓库地基 + 数据库地基 + Content Object 核心（CRUD/Version/Fork 原语） | API 层演示：创建作品→v1→修订→v2→恢复v1→fork | 3,4,5 |
| **M1 First Video** | Intent Engine + Creative Planner + Model Router + Generation Jobs + 媒体管线 | 输入一句话意图 → 得到一个真实 MP4（组合式生成） | 6,7,8,9,10 |
| **M2 Creator Loop** | Creator UX 全流程 + Preview/Revision/Version | 完整走通 §63 前半段：表达→选择→生成→"再温暖一点"→V2 | 11,12 |
| **M3 Public Loop** | Publish + Content Page + Remix + Explore | §63 后半段：发布→他人 Remix→新作品 | 13,14,15 |
| **M4 Trust & Eval** | Provenance/AI 标识 + 评测体系 + 100 Golden Cases | 带 AI 标识的作品页 + 回归测试跑通 | 16,17 |
| **M5 Alpha Validation** | 端到端验收 + 可观测性 + 成本核算 | §63 全链自动化旅程测试绿灯 + 指标面板 | 18 |

**P0 顺序（§67 指定）**：Human Intent → Content Object → Generation → Revision → Publish → Remix。注意 Content Object 的持久化地基（E1/E2）必须先于 Intent Engine 落地——否则意图产物无处安放。

---

## 11. 关键技术风险清单

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| R1 | 意图抽取质量不稳（LLM 输出偏离 Schema） | 主链第一环断裂 | Zod 强校验 + 修复式重试 + Golden 意图集回归 |
| R2 | 生成耗时长（多镜头图像 + TTS + 合成），用户等待焦虑 | 流失 | Job 状态实时可见（UX 原则五）+ 分镜逐个出图渐进预览 |
| R3 | 自然语言修订的目标定位错误（"再温暖一点"改错对象） | H3 假设失败 | 修订定位作为独立可测模块（Revision Eval）+ 修改前展示"我将修改 X"确认点 |
| R4 | SQLite 并发写锁竞争（多 Job 并发） | 生成卡死 | 单 worker 串行消费 + 乐观锁 claim + 写操作短事务 |
| R5 | FFmpeg 长进程阻塞 API 请求 | 服务无响应 | 生成全部走异步 Job，API 只做入队与查询 |
| R6 | 生成成本不可见 | 无法核算单作品成本 | 每次 AI 调用记录 token/图像/秒数成本（§62） |
| R7 | 内容安全（用户输入→生成内容） | 合规风险 | 输入过滤 + 生成后抽检 + Provenance 留审计痕 |
| R8 | 素材版权（用户上传参考图） | 法律风险 | Alpha 仅存 Source Assets 引用 + 权限字段，不做素材库 |

---

## 12. 待产品负责人确认的决策点（§85 格式）

**D1 — Alpha 视频生成 Provider 策略**（详见 `docs/decisions/ADR-0001`）
- 问题：Alpha 的视频从哪里来？
- 方案 A：直接接外部视频模型 API（需凭据/预算/网络，质量高但不可控）
- 方案 B（推荐）：组合式管线优先——图像 + 运镜 + TTS + 字幕 → FFmpeg；外部视频模型作为后续 Adapter
- 理由：环境实测 FFmpeg 就绪、无外部凭据；B 成本低、可回归测试、足以验证全部产品假设，且是对 Model Router 抽象的最强验证

**D2 — 仓库形态**
- 问题：采用 Brief §46 的完整 monorepo（/apps /packages /workers）还是"单应用 + 严格内部边界"？
- 方案 A：完整 monorepo（结构最正统，但脚手架成本高）
- 方案 B（推荐）：单 Next.js 应用 + `src/core /src/ai /src/media /src/infra` 内部模块边界 + 独立 workers 入口——逻辑上等价 monorepo，物理上最简
- 理由：§86 不过度工程；边界靠 lint 规则强制，未来拆包是机械动作

**D3 — Alpha 认证方案**
- 问题：Alpha 是否需要完整注册登录体系？
- 方案 A：完整 auth（邮箱/手机号）
- 方案 B（推荐）：最小会话认证（设备级匿名身份 + 昵称，头像可选），表结构按完整 User 预留
- 理由：Alpha 验证的是创作链不是账号体系；但 User/Identity 实体从第一版按 §47 建

---

## 附录 A：Alpha 目标架构（模块图）

```text
┌────────────────────────────────────────────────────────┐
│ Frontend (Next.js App Router)                          │
│  Home / Imagine / Projects / Content / Profile         │
│  创作状态机前端镜像（§55 状态）                          │
└───────────────────────┬────────────────────────────────┘
                        │ REST-ish API Routes (/src/app/api)
┌───────────────────────▼────────────────────────────────┐
│ Application Services (/src/core)                       │
│  IntentService │ PlannerService │ ContentService       │
│  VersionService │ RevisionService │ RemixService       │
│  PublishService │ ProjectService                       │
│  —— 领域模型不 import 任何具体模型名 ——                 │
└──────┬─────────────────────────────────┬───────────────┘
       │                                 │
┌──────▼──────────────┐   ┌──────────────▼───────────────┐
│ AI Orchestrator     │   │ Media Pipeline (/src/media)  │
│ (/src/ai)           │   │  ffmpeg 合成/缩略图/转码      │
│  Model Router       │   └──────────────┬───────────────┘
│  ├ LLM Adapter      │                  │
│  ├ Image Adapter    │   ┌──────────────▼───────────────┐
│  ├ TTS Adapter      │   │ Workers (/workers)           │
│  └ CompositeVideo   │   │  generation/render job loop  │
│    Provider(ADR-1B) │   │  乐观锁 claim + 重试/超时     │
└──────┬──────────────┘   └──────────────┬───────────────┘
       │                                 │
┌──────▼─────────────────────────────────▼───────────────┐
│ Infra (/src/infra): Prisma(SQLite→PG-ready) │ 对象存储  │
│ Job 持久化表 │ 成本记账 │ 日志                        │
└────────────────────────────────────────────────────────┘
```

## 附录 B：核心数据模型草图与不变量

实体（§47 全集，Alpha 落地打 ★，预留打 ○）：

```text
User★ Identity★ Project★ Content★ ContentVersion★ Intent★
CreativePlan★ Story★(结构化JSONB) Scene★ Shot★
Character○ World○（Content 内 JSONB 预留）
Asset★ Generation★ GenerationJob★ Permission★
Provenance★ Remix★ Publication★ Like/Save★(最小)
CreatorPreferences★ EvalCase○ GoldenRun○
```

**六条不变量（数据层强制）**：

1. `ContentVersion` 一经创建**不可变**（修订=新建版本，带 `parent_version_id`）
2. Remix 永远创建**新 Content** + 新 Version + `parent_content_id`，原作零改动
3. `Provenance` 只追加（append-only），不更新不删除
4. 领域表字段中**不出现** provider/model 名（只出现在 Provenance/Generation 记录）
5. Intent 字段级携带 `source: user|ai_default`（§16 的记录要求）
6. `Content.current_version_id` 是唯一"现势指针"，历史版本永远可寻址

## 附录 C：创作状态机 + 生成任务生命周期

```text
创作状态机：IDEA → INTENT → PLANNING → STORY → STORYBOARD
            → GENERATING → REVIEW → RENDERING → READY → PUBLISHED
            （任意态 → failed 可恢复重试，不回滚到起点）

GenerationJob：queued → claimed → running → (succeeded | failed | timeout)
  字段：id/content_id/version_id/type/provider/model/status/
        input/output/error/retry_count/created_at/started_at/completed_at
  规则：重试上限内自动 retry；同 type 支持 fallback provider；
        长任务绝不挂在 HTTP 请求上（§52）
```

## 附录 D：Alpha API 语义面（§54）

```text
POST /api/projects            GET /api/projects/:id
POST /api/intents             PATCH /api/intents/:id
POST /api/creative-plans      POST /api/creative-plans/:id/regenerate
POST /api/stories             PATCH /api/stories/:id
PATCH /api/shots/:id
POST /api/generations         GET /api/generations/:id
POST /api/generations/:id/retry
POST /api/contents            GET /api/contents/:id
POST /api/contents/:id/versions
POST /api/contents/:id/revise     ← 自然语言修订入口
POST /api/contents/:id/remix
POST /api/contents/:id/publish
GET  /api/explore
```

语义纪律：资源名用名词、动作用 POST 子路径表达（revise/remix/publish/retry），不做动词式 REST 混乱。

## 附录 E：环境能力实测（2026-10-05）

Node v24.21.0 / npm 11.19.0（无 pnpm）· FFmpeg 7.1.5 ✓ · SQLite（file DB）· 无 Redis · 无 Postgres 服务 · Git 已初始化（无 remote）· z-ai SDK（LLM/图像/TTS/VLM）可用 · 仓库空（仅 download/README.md）
