# ImagineOS Alpha — Development Task Tree

- 版本：v1.1（2026-10-05，M0 完成后更新状态标记）
- 结构：`Epic → Feature → Task → Acceptance Criteria → 实现要点 → 测试要点`（§67）
- 配套：`docs/architecture/architecture-understanding-report.md`（为什么这么做）
- 状态标记：`[ ]` 待做 · `[~]` 进行中 · `[x]` 完成 · `[!]` 阻塞
- 进度快照：**M0 Walking Skeleton 已完成**（E0/E1/E2 全绿：lint + typecheck + 30 tests + agent-browser 黄金路径自验通过）

---

## 0. 组织约定

**优先级定义**

- **P0**：主链必需（§67：Human Intent → Content Object → Generation → Revision → Publish → Remix），缺一 Alpha 不成立
- **P1**：主链的可靠性与可观测性支撑（重试/状态/成本记录）
- **P2**：体验增强（Explore 打磨、Profile、批量操作）

**DoD（每个 Task 完成的硬标准，§82）**：代码完成 + typecheck 通过 + lint 通过 + 测试通过 + build 通过 + 关键路径手测 + 错误路径测试 + 文档更新 + 无明显回归。**缺任何一条不得标记完成。**

**汇报（§83）**：每 Task 收尾输出：完成/修改/原因/验证/测试/风险/已知问题/下一步。

**技术基线（Phase 0 实测约束）**：Next.js（App Router）+ TypeScript strict + Prisma/SQLite（Postgres-ready 设计）+ z-ai SDK（LLM/图像/TTS）+ FFmpeg 7.1 + 无 Redis（DB 持久化 Job + 乐观锁 claim）。

---

## 1. 里程碑与依赖总览

```text
M0 Walking Skeleton      M1 First Video         M2 Creator Loop
┌─────────────────┐     ┌─────────────────┐    ┌─────────────────┐
│ E0 仓库地基      │     │ E3 Intent Engine │    │ E8 Creator UX    │
│ E1 数据库地基    │ ──► │ E4 Planner       │ ─► │ E9 Revise/Version│
│ E2 ContentObject │     │ E5 Router/Prov.  │    └────────┬────────┘
└─────────────────┘     │ E6 Gen Jobs      │             │
                        │ E7 Media Pipeline│             ▼
                        └────────┬────────┘   M3 Public Loop
                                 │            ┌─────────────────┐
                                 │            │ E10 Publish      │
                                 │            │ E11 Content Page │
                                 │            │ E12 Remix        │
                                 │            └────────┬────────┘
                                 ▼                     ▼
                        M4 Trust & Eval       M5 Alpha Validation
                        ┌─────────────────┐   ┌─────────────────┐
                        │ E13 Provenance   │   │ E15 端到端验收   │
                        │ E14 Evaluation   │   │ + 指标/成本面板  │
                        └─────────────────┘   └─────────────────┘
```

依赖铁律：**E2（Content Object）先于 E3–E12 的一切**——所有创作产物都需要它的持久化地基。

---

## 2. Epic E0 — Repository Foundation（M0，P0）

> 目标：让"改一行代码 → 自动验证质量"的循环从第一天就成立。

### F0.1 项目脚手架与模块边界
- **[x] T0.1.1** 初始化 Next.js + TypeScript strict 项目
  - AC：`npm run dev/build` 通过；`tsconfig` 开启 `strict`、`noUncheckedIndexedAccess`
  - 实现要点：按 ADR-0002（待批）的"单应用 + 内部边界"落位 `src/app` `src/core` `src/ai` `src/media` `src/infra` `workers/`
  - 测试：build 冒烟
- **[x] T0.1.2** 模块边界 lint 规则
  - AC：`src/app`（UI）禁止 import `src/ai` 内部实现，只许走 `src/core` 服务；`src/core` 禁止 import 任何 provider 具体实现
  - 测试：故意违规的样例文件触发 lint 失败（用 eslint 单测或 CI 中的负例检查）

### F0.2 质量工具链
- **[x] T0.2.1** ESLint + Prettier + typecheck + Vitest + 脚本聚合
  - AC：`npm run lint / typecheck / test / build` 四命令一键可用；`npm run check` 聚合全部
  - 测试：空跑全绿
- **[x] T0.2.2** CI 管线（GitHub Actions 或等价物；无 remote 时先落 `npm run check` 门禁脚本）
  - AC：任一 check 失败即整体失败
  - 测试：注入一个类型错误验证门禁拦截

### F0.3 环境与配置管理
- **[x] T0.3.1** 环境变量分层：`.env`（已有 DATABASE_URL）+ `.env.example` + `src/infra/config.ts`（Zod 校验启动期变量）
  - AC：缺关键变量时进程启动即报明确错误，而非运行中途崩
  - 测试：缺 DATABASE_URL 的启动负例

---

## 3. Epic E1 — Database Foundation（M0，P0）

> 目标：把 §47 实体全集落成 Postgres-ready 的 Prisma Schema，附六条数据不变量。

### F1.1 Schema
- **[x] T1.1.1** 核心表：User / Identity / Project / Content / ContentVersion / Intent
  - AC：六条不变量中 1/2/5/6 由表结构 + 仓储层强制（版本不可变、remix 血缘、intent 字段 source、current_version 指针）
- **[x] T1.1.2** 创作结构表：CreativePlan / Story / Scene / Shot（结构化 JSONB + 关键列索引）+ Character/World（Content 内 JSONB 预留）
  - AC：Story→Scene→Shot 层级可整树读写，也可单节点 PATCH
- **[x] T1.1.3** 执行层表：Asset / Generation / GenerationJob（含 retry_count/timeout/error）
- **[x] T1.1.4** 信任与传播表：Permission / Provenance（append-only）/ Remix / Publication / Like/Save / CreatorPreferences

### F1.2 迁移与种子
- **[x] T1.2.1** Prisma migrate 初始迁移 + seed（演示用户 + §63 自行车故事样例数据）
  - AC：`prisma migrate dev` + `prisma db seed` 幂等可重放
- **[x] T1.2.2** Postgres 兼容性审查
  - AC：schema 无 SQLite 专属类型逃逸（不用裸 SQL）；JSON 字段全部有 Zod schema 对应

### F1.3 仓储层与测试
- **[x] T1.3.1** Repository 层（每实体一个仓储，禁止 UI 直接触 Prisma）
  - AC：核心服务只 import 仓储；仓储函数 100% 有单测覆盖（含失败路径）
  - 测试：版本链、remix 血缘、provenance 追加的仓储级单测

---

## 4. Epic E2 — Content Object Core（M0，P0）★ 主链地基

> 目标：§70 要求的 Create / Read / Update / Version / Fork 原语，先于一切复杂 UI。

### F2.1 生命周期与状态机
- **[x] T2.1.1** 创作状态机（IDEA→…→PUBLISHED，附录 C）实现为纯函数转移表 + 持久化
  - AC：非法跳转抛领域错误；failed 可恢复重试不回起点
  - 测试：全跳转组合表驱动测试（合法/非法各一矩阵）

### F2.2 版本系统
- **[x] T2.2.1** `createVersion(contentId, patch, creation_method)`：新版本不可变，挂 parent_version_id
- **[x] T2.2.2** `listVersions / restoreVersion`：时间线 + 恢复（恢复也是创建新版本，指向被恢复者）
  - AC：v1→v2→v3→restore v1 得到 v4(parent=v1)；任何历史版本资产可寻址
  - 测试：版本链不变量测试 + 并发创建安全（SQLite 串行写）

### F2.3 Fork / Remix 原语（数据层）
- **[x] T2.3.1** `forkContent(sourceContentId, sourceVersionId, newOwnerId)`：深拷贝创作结构 + 血缘三件套（new_content_id/new_version_id/parent_content_id）+ 权限校验
  - AC：原作零改动（字段级 diff 断言）；Remix 权限关闭时 fork 被拒
  - 测试：血缘完整性 + 权限负例

---

## 5. Epic E3 — Intent Engine（M1，P0）★ 主链第一环

> 目标：自然语言 → 结构化、可验证、可追踪的 Intent Object（§14–§17）。

### F3.1 Intent Schema
- **T3.1.1** Zod schema：topic/purpose/emotion[]/audience/tone/format/duration/visual_style/narration/creator_on_camera/characters/references/constraints + 每字段 `source: 'user'|'ai_default'`
  - AC：§17 示例 JSON 校验通过；非法值给出字段级错误
  - 测试：正例/负例表驱动

### F3.2 抽取管线
- **T3.2.1** LLM Adapter（z-ai SDK）+ 结构化输出 + 校验修复重试（最多 2 轮）
  - AC：抽取失败不崩溃，降级为"缺字段 + 待访谈"状态
  - 测试：mock adapter 返回畸形 JSON 时的修复重试与降级
- **T3.2.2** 缺省决策引擎（§16）：字段不足 → AI 合理默认并标记 source，永不阻塞用户
  - AC："你自己决定"路径产出完整 Intent，全部缺省字段被标记
  - 测试：空输入 → 默认补全的快照测试

### F3.3 Intent Interview（§15）
- **T3.3.1** 访谈生成：最多 5 问、一次一个、自然简短；每问附带"跳过/你自己决定"出口
  - AC：问题数量 ≤5；已回答信息不再重复问；用户随时可强制结束
  - 测试：访谈状态机单测（含提前终止）

### F3.4 API 与追踪
- **T3.4.1** `POST /api/intents`（含 LLM 调用成本记账埋点）
  - AC：Intent 创建即入库、带 provenance 记录（输入原文、抽取时间、模型、成本）
  - 测试：API 集成测试 + 成本记录存在性断言

---

## 6. Epic E4 — Creative Planner（M1，P0）

> 目标：Intent → Concept → Story → Scene → Shot 的可分段修改创作计划（§18–§19）。

### F4.1 Creative Direction 生成
- **T4.1.1** 每次产出 2–4 个方向：名称/一句话概念/情绪/视觉方向/预计时长
  - AC：方向互异（主题/视角/风格至少一维不同）；可整体重新生成（换一批）
  - 测试：mock LLM 固定输出下的结构校验 + 重生成产生新批次
- **T4.1.2** 方向选择接口：选择后冻结为 Concept，进入 Story 阶段
  - 测试：未选方向时请求 Story 被状态机拒绝

### F4.2 Story / Storyboard
- **T4.2.1** Story 生成（结构化 JSONB：叙述弧、情绪曲线、旁白文案）
- **T4.2.2** Scene→Shot 分解：每 Shot 含画面描述/运镜/时长/旁白行/情绪
  - AC：Shot 总时长 ≈ Intent.duration（±15%），偏差时自动增删镜头并在 metadata 记录调整
  - 测试：时长预算函数单测（45s 意图 → 3–6 镜头）
- **T4.2.3** 分步修改 API：Story/Scene/Shot 各级 PATCH；修改产生新计划版本（草稿态，不新建 ContentVersion）
  - 测试：改一个 Shot 不影响兄弟节点

---

## 7. Epic E5 — Model Router & Providers（M1，P0）★ §87 资产

> 目标：统一 Provider 接口 + 路由 + 失败处理；业务层零模型名。

### F5.1 接口与注册表
- **T5.1.1** Provider 接口定义（按能力分类：`text.plan` / `image.shot` / `audio.tts` / `video.compose`）+ 路由注册表 + 选择策略（任务类型→候选链）
  - AC：业务侧只声明能力需求，如 `router.execute('image.shot', payload)`；全代码库 grep 不到业务文件中的具体模型名（lint 规则强制）
  - 测试：注册/选择/未注册能力的负例

### F5.2 Adapter 实现（第一阶段只接真正需要的，§73）
- **T5.2.1** LLM Adapter（z-ai chat：意图抽取/计划生成/修订定位共用）
- **T5.2.2** Image Adapter（z-ai image：分镜图生成，含尺寸/风格参数映射）
- **T5.2.3** TTS Adapter（z-ai tts：旁白配音）
  - AC：三 Adapter 均记录 latency/cost/token 或张数，写入 Generation 表
  - 测试：mock 传输层的 Adapter 单测 + 成本记账断言

### F5.3 CompositeVideoProvider（ADR-0001 方案 B 的核心）
- **T5.3.1** 编排 `storyboard → 逐镜头图像 → Ken Burns/转场 → TTS+音乐 → 字幕 → FFmpeg MP4`
  - AC：输入 Shot 列表 + 资产，输出可播放 MP4 + 帧封面；每步失败可从中间产物续跑
  - 测试：2 镜头最小样例端到端 + 单步注入失败的重试

### F5.4 失败处理
- **T5.4.1** 重试策略（指数退避、上限 3）+ 同能力 fallback 链 + 超时熔断
  - 测试：模拟 provider 连续失败 → fallback 接管；全部失败 → Job failed 且用户工作无损

---

## 8. Epic E6 — Generation Jobs（M1，P0）

> 目标：§52–§53 的异步 Job 机制，绝不靠长 HTTP 请求维持生成。

### F6.1 队列与 Worker
- **T6.1.1** Job 持久化表 + 进程内 worker 循环（乐观锁 claim：`UPDATE … WHERE status='queued' AND version=?`）
  - AC：worker 崩溃重启后 queued/claimed 的 Job 被重新认领；同一 Job 不会被双跑（claim 原子性）
  - 测试：模拟 worker 崩溃恢复 + 并发 claim 竞争单测
- **T6.1.2** Job 生命周期：`queued→claimed→running→succeeded|failed|timeout` + retry_count + 幂等（重试不产生重复资产，靠 content hash 去重）
  - 测试：重试幂等性（资产表唯一约束）

### F6.2 前端感知
- **T6.2.1** 状态查询端点 + SSE（降级为轮询）推送 Job 状态与分镜级进度
  - AC：生成中 UI 每步可见（Planning→Generating→Rendering，UX 原则五）
  - 测试：SSE 消息序列集成测试

---

## 9. Epic E7 — Media Pipeline（M1，P0）

> 目标：§75 的 Upload/Preview/Thumbnail/Transcode/Merge/Audio/Final Render。

- **T7.1.1** Asset 服务：对象存储抽象（Alpha 用本地磁盘适配器，接口按 S3 语义设计）+ hash/mime/duration/width/height 提取
- **T7.1.2** FFmpeg 合成器：Ken Burns（zoompan）+ 转场（xfade）+ 音轨混合（旁白+背景音乐、自动闪避）+ 字幕烧制
  - AC：45s 样片合成成功；音频时长与视频对齐（±0.5s）；失败输出结构化错误
  - 测试：合成冒烟（小分辨率短样例，CI 可跑）+ 参数边界（1 镜头/超长文本截断）
- **T7.1.3** 缩略图/封面/预览转码（480p preview + 1080p final + poster 帧）
  - 测试：产物存在性 + 元数据正确性

---

## 9A. Epic E7X — Platform Surface（M1，P0）★ 产品负责人 M0 评审裁决

> 来源：docs/product/m0-review-m1-direction.md（2026-10-06 评审落档）。
> M1 的核心命题：**用户看到内容以后，会不会产生"我也想创造一个"的冲动**。
> 铁律：增量增强，不重构——不换 UI framework、不动路由结构、不推翻数据库/Content Object。

- **T7X.1** Explore 视觉化卡片：视觉内容必须是卡片第一视觉元素
  - 卡片结构：`Visual Content → Title → Creator → AI involvement → Remix`
  - AC：视频封面/播放、图像、动态内容均有真实展示区域；无纯文字主形态卡片；占位也有结构化视觉区
  - 测试：agent-browser 视觉断言（卡片含 poster/video 元素）
- **T7X.2** 产品语言字典（用户语言层）：`src/app/_language/` 唯一 UI 文案规范源
  - 映射：Content Object→作品 / V1→初稿·第2版 / Intent Engine→不可见 / Remix→「从这里开始我的版本」
  - AC：最终用户体验路径 grep 不到工程术语（Content Object / Intent Engine / Generation Chain / V0）；工程词只允许出现在内部元数据与开发文档
  - 测试：页面快照文案断言
- **T7X.3** 创作空间 /create/[id]（增量页面，不动首页 IA）
  - AC：从首页表达进入后完成 Intent→方向→故事→生成→预览全链；刷新可恢复状态
- **T7X.4** 视觉语言微调：向电影感/内容感/人的温度演化（不加新发光效果）

---

## 10. Epic E8 — Creator UX（M2，P0）

> 目标：§76 的 Home→Imagine→Intent→Direction→Story→Generation 全流程界面。

### F8.1 Home
- **T8.1.1** 首页双入口：Explore 内容区 + Imagine 核心入口，主 CTA 文案即"你想表达什么？"
  - AC：不登录可见 Explore；点 Imagine 即开始（延迟注册）
- **T8.1.2** 输入区：Text 先行；Voice/Image/Video/File 入口 UI 预留位（点击提示"即将支持"）
  - 测试：Playwright 冒烟（首页→输入→进入创作）

### F8.2 Imagine 创作流
- **T8.2.1** Intent Interview 对话流（一问一答 + 进度指示"第 2/5 个问题" + 随时"你自己决定"）
- **T8.2.2** Creative Direction 卡片选择（2–4 张 + 重新生成按钮）
- **T8.2.3** Story/Storyboard 审阅页（结构树 + 每 Shot 旁白/画面描述可编辑）
- **T8.2.4** 生成等待页（分镜级进度 + 状态机阶段可视化）
  - AC：全程用户永远知道自己在哪一步（步骤条 + 阶段文案，UX 原则五）
  - 测试：关键路径 Playwright 旅程 + 中断恢复（刷新后回到正确状态）

### F8.3 Projects 与 Profile
- **T8.3.1** Projects 列表：Drafts/Creating/Finished/Published 四态，封面/标题/状态/更新时间
- **T8.3.2** Profile 最小集：头像/昵称/作品/收藏/基础创作数据 + CreatorPreferences 设置页
  - 测试：列表过滤与空态

---

## 11. Epic E9 — Preview / Revision / Version（M2，P0）★ H3 假设的主战场

### F9.1 Preview
- **T9.1.1** 预览页：视频播放 + 标题 + 时长 + AI 参与信息；四个动作：满意/修改/重新生成/发布
  - AC：满意 → READY 态；重新生成 → 新 Generation Job（同 Version 草稿）；修改 → 进入修订流

### F9.2 自然语言修订（§24）
- **T9.2.1** 修订定位器：LLM 分类用户反馈 → 目标层级（Character/Scene/Shot/Audio/Style/Story）+ 具体节点 + 变更语义
  - AC：输出结构化 RevisionPlan（改什么/为什么/影响哪些 Shot）并在 UI 展示"我将修改 X"确认点（风险 R3 缓解）
  - 测试：Golden 修订语料表驱动（"第二个镜头太快"→ shot[1].duration ↓；"衣服改黑色"→ character.wardrobe；"结尾别悲伤"→ story.ending_emotion）
- **T9.2.2** 修订执行：定位 → 计划变更 → 受影响 Generation 重建 → **新 ContentVersion**（永不覆盖）
  - AC：修订前后两版本并存可切换对比
  - 测试：修订前后资产 diff 断言 + 旧版本完整可回放

### F9.3 版本时间线
- **T9.3.1** 版本列表 UI：查看/继续编辑/恢复（恢复=创建指向旧版的新版本）
  - 测试：恢复语义与 E2 仓储层一致

---

## 12. Epic E10 — Publish（M3，P0）

- **T10.1.1** 发布流：标题/简介/封面（默认取 poster 帧，可换）/Visibility（Private/Unlisted/Public）/Remix Permission
  - AC：发布即写 Publication + 状态 → PUBLISHED；未填字段给默认值（UX 原则六）
  - 测试：三种可见性的可见性矩阵测试（本人/他人/匿名）
- **T10.2.1** 下线/重新发布（软删除，保留 Provenance）
  - 测试：下线后 Remix 链路行为（子作品不受影响，血缘仍在）

---

## 13. Epic E11 — Content Page & Explore（M3，P0/P2）

- **T11.1.1** Content Page（§77）：观看/作者/标题/描述/**AI 标识**（AI Generated | AI Assisted）/Like/Save/Remix 主 CTA
  - AC：未登录只读 + 引导登录；Remix 点击即走 E12 流程
- **T11.2.1** Explore 基础流（P2）：最新/精选列表，埋点位记录曝光（为 For You to Create 留数据）
  - 测试：Playwright 内容页旅程

---

## 14. Epic E12 — Remix（M3，P0）★ Content Graph 起点

- **T12.1.1** Remix 服务：调 `forkContent`（E2 原语）+ 新作者进入自己的创作循环（从 REVIEW 态开始，可继续修订）
  - AC（§35 全条）：复制可授权结构；new_content_id/new_version_id/parent_content_id 三件套；原作不动；新作者拥有自己的版本
  - 测试：端到端——用户 B Remix 用户 A 作品 → B 修订 → B 发布 → A 的作品页面出现"衍生作品"
- **T12.1.2** 血缘展示（P1）：作品页"基于某某的作品"最小展示
  - 测试：两层 Remix 血缘查询正确

---

## 15. Epic E13 — Trust / Provenance（M4，P1→P0 for badges）

- **T13.1.1** AI 标识徽章：公开内容强制显示 AI Generated / AI Assisted（判定规则：全 AI 产物=Generated；含用户素材=Assisted）
  - 测试：两类作品的徽章断言
- **T13.2.1** Provenance 完整记录：provider/model/generation_time/source_assets/edit_history/human_contribution，结构对 C2PA 字段可映射（§34）
  - 测试：一次创作→修订→发布后的 Provenance 链完整性快照

---

## 16. Epic E14 — Evaluation（M4，P1）

- **T14.1.1** 评测框架：跑 Golden Case → 打分 → 存 GoldenRun 报告
- **T14.1.2** 100 条 Golden 意图集（§60，按 §40 分类覆盖：生活/人物/知识/情绪/想象/商业/纪录），含预期 Intent 字段断言 + 修订语料
- **T14.2.1** 维度接入（§59 子集）：Intent Eval / Story Eval / Instruction Following / Revision Eval / Latency / Cost
  - AC：换模型/Prompt/Orchestrator 时一条命令回归，报告含成功率与成本对比
  - 测试：框架自测（确定性 mock 模型全绿）

---

## 17. Epic E15 — Alpha Validation（M5，P0 收口）

- **T15.1.1** §63 全链自动化旅程测试（自行车故事→修订"再温暖一点"→发布→Remix）作为最高优先 CI 旅程
- **T15.2.1** 可观测面板（§58）：模型失败率/成本/耗时分布/步骤流失漏斗/生成成功率
- **T15.3.1** 成本核算（§62）：单成功作品平均成本（模型+媒体+存储+带宽）
  - AC：`Expression Success Rate` 及诊断指标可从数据直接计算
  - 测试：全链旅程绿灯 + 指标 SQL 抽查正确性

---

## 18. 与 Master Brief §96 Phase 映射

| Phase（§96） | Epic | 里程碑 |
|---|---|---|
| 3 Repository Foundation | E0 | M0 |
| 4 Database Foundation | E1 | M0 |
| 5 Content Object | E2 | M0 |
| 6 Intent Engine | E3 | M1 |
| 7 Creative Planner | E4 | M1 |
| 8 Model Router | E5 | M1 |
| 9 Generation Jobs | E6 | M1 |
| 10 Media Pipeline | E7 | M1 |
| 11 Creator UX | E8 | M2 |
| 12 Preview/Revision/Version | E9 | M2 |
| 13 Publish | E10 | M3 |
| 14 Content Page | E11 | M3 |
| 15 Remix | E12 | M3 |
| 16 Trust/Provenance | E13 | M4 |
| 17 Evaluation | E14 | M4 |
| 18 Alpha Validation | E15 | M5 |

---

## 19. 立即下一步（待负责人确认 D1/D2/D3 后执行）

1. ADR-0001（生成策略）、ADR-0002（仓库形态）、ADR-0003（认证方案）获得确认
2. 启动 **E0 / T0.1.1**：脚手架 + 边界落位（首个 DoD 达标任务）
3. 按 M0 → M1 顺序推进，每个 Task 收尾按 §83 汇报并追加 worklog
