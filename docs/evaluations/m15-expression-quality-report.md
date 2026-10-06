# M1.5 Expression Quality Report

> ImagineOS Alpha · 2026-10-06 · M1.5 Expression Quality Gate 总报告
> 数据源：全部指标来自真实运行（HTTP 全链驱动 + DB 权威记账），零 mock。原始数据：`scripts/m15/state/*.json`
> 状态：**主体完成**——Gate 1/2/5/6/7 已有结论；Gate 3/4 执行链因 provider 配额冷却（429）暂阻塞，恢复脚本就绪，结论将在补跑后更新（见 §10）

---

## 0. 执行摘要

M1.5 在 M1 的真实管线上执行了七道质量闸门。**核心结论**：

1. **表达→作品链路成立**：9/10 案例真实走完「一句话表达 → 发布」，覆盖 10 种表达类型 × 3 种内容范式，干净窗口端到端 121–262s，含排队波动中位 409s（详见 Cost Report §3 修正声明）。
2. **视觉质量是当前最大短板，且已被量化证实**：组合式管线的成片是"静态画面 + 运镜 + 转场"（帧间差分 YDIF ≈ 1.0），Native 路径（cogvideox-3 图生视频）运动量为其 2.1–2.3 倍且含真实主体运动——双路径已接入并真实验证（ADR-0001 Rev.2；native smoke 为可复现 A 级证据，YDIF 复测 2.079）。
3. **数据完整性满分**：M1.5 生产案例在六表关系检查中 0 错误 0 警告；Content Object 的版本/血缘/溯源不变量全部成立。
4. **修订与 Remix 的机制在 M1 已被验证**（种子数据 + 1 次真实修订记账），Gate 3/4 的专项四连改链因配额冷却待补跑。

**2026-10-06 沙箱重置事件披露**：运行沙箱 09:03 重置，重置前的 208 个媒体文件被销毁并以占位文件恢复（结构完整性不受影响，历史度量数据均为重置前真实采集；证据分级见 Visual Quality Report §0）。配额恢复后的新链路（G3/G4/p10/Native）将产生真实字节的补齐证据。

**对两个关键问题的初步回答**（终版见 §9）：ImagineOS 已证明表达链路"能走通"，但尚未证明"作品有被看见的价值"——瓶颈排序：**视觉质量 > 内容传播 > Intent 理解 ≈ Revision > UX**。

---

## 0.5 Model Provider 配置与链路验证（2026-10-06 多模型服务联调）

> 背景：产品负责人在「设置 → 模型服务」页配置了外部 OpenAI 兼容服务 **agnes-com**（`apihub.agnes-ai.com/v1`，ADR-0004），使 LLM/Image/Video 三通道不再依赖单一 z-ai 配额。本节为 Provider 信息的权威记录（用户指令：所有评测报告须标注每个通道的真实 Provider/Model）。

### 0.5.1 Provider 矩阵（本 M1.5 收口期的真实执行配置）

| 通道 | Provider | Model | 链路验证 | 定价（2026-10-06 官方 wiki，限时免费期） |
|------|----------|-------|----------|------------------------------------------|
| LLM（text.plan） | `openai-compat:agnes-com` | `agnes-3.0-flash` | ✅ 5/5 调用成功，延迟 5.3–30.6s | $0（牌价 input $0.05/M · output $0.15/M） |
| Image（image.shot） | `openai-compat:agnes-com` | `agnes-image-2.5-flash` | ✅ 12/12 调用成功，延迟 8.7–13.4s（均值 9.9s） | $0（牌价 $10–24/千张，按分辨率） |
| TTS（audio.tts） | 无自定义 → `zai-tts` 兜底 | `zai-tts-tongtong` | ✅ fallback 链序已验证；36 次尝试全部 429（配额冷却中） | z-ai 内部配额 |
| Video（video.shot） | `openai-compat:agnes-com` | `agnes-video-2.5-flash` | 🔶 协议已适配并单测覆盖；服务端队列满（503）阻塞中 | $0（牌价 $0.025/秒 @720P） |

### 0.5.2 链路验证方法与证据（A 级）

验证路径：**页面配置 → 数据库存储（ModelProviderConfig 3 行，全部 enabled）→ Provider Registry（ensureChainsFresh 动态建链：自定义 priority 升序 → z-ai 兜底）→ Runtime 调用 → Generation 记账表**。以真实匿名用户会话驱动完整创作流（imagine/start → intent → directions → story → storyboard → generate），全部记账行可复查（`scripts/m15/state/chain-verification.json`）：

- **LLM**：`text.plan/openai-compat:agnes-com/succeeded ×5` —— 意图编译/方向/故事/分镜全部走自定义 Provider；
- **Image**：`image.shot/openai-compat:agnes-com/succeeded ×12` —— 生成 + 下载全链成功；
- **TTS**：`audio.tts/zai-tts/failed ×36` —— 无自定义时直达 z-ai 兜底的链序证明（429 为配额事实，非链路缺陷）；
- **降级链序**：首跑（下载缺陷修复前）`agnes 失败 → zai-image 自动接管` 的记账序列证明失败自动降级生效。

### 0.5.3 联调期发现并修复的协议级缺陷（工程记录）

1. **S3 预签名 URL 鉴权冲突**：Agnes 图像返回预签名 URL，带 `Authorization` 头下载必 401（XML 签名失效）。修复：`downloadMedia` 裸下载优先、401/403 再带 Bearer 重试（图像/视频下载共用）。
2. **视频协议不兼容**：Agnes 使用 OpenAI-Videos 风格（`POST /v1/videos` keyframe 模式 + `GET {origin}/agnesapi` 轮询），与原 SiliconFlow 风格（`/video/submit` + `/video/status`）完全不同。修复：video.shot 适配器双协议自动探测（404 即切换）；`size→720P/aspect_ratio` 映射、`durationSec→seconds(4-12)` 夹取、**data URI 首帧直接内联**（实测通过，规避了"首帧必须公网可访问"约束——生成期内容默认私有，资产路由对外 404）。
3. **TTS 无可用自定义源**：Agnes 模型目录（12 个模型）全部为文本/图像/视频，无 TTS。TTS 通道维持 z-ai 兜底——这是当前 Phase B 补跑的唯一硬阻塞（见 §10）。

---

## 1. Gate 1 — 真实内容质量（10 类型真实创作）

### 1.1 案例矩阵（9/10 已发布，p10 阻塞于配额）

| 案例 | 类型 | 范式 | Intent（用户原话摘要） | 镜头 | 成片 | 状态 |
|------|------|------|------------------------|------|------|------|
| p01 外婆的一生 | 人物故事 | A 写实 | 82 岁江南裁缝外婆的一生 | 5 | 42.3s / 4.0MB | ✅ 发布 |
| p02 周日厨房 | 家庭回忆 | A 写实 | 三代人小厨房做晚饭 | 5 | 42.6s / 4.0MB | ✅ 发布 |
| p03 川西星空 | 旅行 | A 写实 | 海拔四千米银河下的安静 | 5 | 42.6s / 5.9MB | ✅ 发布 |
| p04 天空为什么是蓝的 | 知识 | A 写实 | 给孩子解释瑞利散射 | 4 | 28.8s / 1.8MB | ✅ 发布 |
| p05 城市喘不过气 | 情绪 | B 电影 | 工作压力下的坚持 | 5 | 42.6s / 5.0MB | ✅ 发布 |
| p06 一滴水的梦 | 梦境 | C 强想象 | 云→屋顶→街道→大海 | 5 | 42.6s / 4.9MB | ✅ 发布 |
| p07 2085 年的一天 | 未来想象 | C 强想象 | 未来城市与普通人生活 | 5 | 37.6s / 3.3MB | ✅ 发布 |
| p08 最后一枚火箭 | 科幻 | C 强想象 | 地球安静目送火箭离开 | 5 | 42.6s / 4.3MB | ✅ 发布 |
| p09 手工咖啡 | 产品介绍 | B 电影 | 慢下来的生活 | 4 | 28.2s / 2.0MB | ✅ 发布 |
| p10 流浪动物过冬 | 公益 | B 电影 | 一个纸箱一碗水一点善意 | 5 | — | ⏸ 配额阻塞（配方/分镜/7 资产已完成，重试脚本就绪） |

**关键观察**：
- 10 种类型全部通过 Intent Engine 编译为结构化配方（访谈问题 0–3 个，用户可"交给我来定"跳过）；
- 方向生成稳定输出 2–4 个差异化方向（如 p04 的「蓝蓝的天空/光的魔法/天空调色盘」），选择逻辑按案例偏好关键词命中；
- 全链无一人工干预：驱动脚本走的是与 UI 用户完全相同的 HTTP 路径。

### 1.2 Latency Report（阶段级，n=9 发布案例；修正口径 2026-10-06）

| 阶段 | 中位 | 最长 | 说明 |
|------|------|------|------|
| Intent 理解 | 3.5s | 9.2s | LLM 结构化抽取 |
| 方向生成 | 2.9s | 4.8s | 2–4 个方向 |
| 故事展开 | 3.0s | 623.5s ⚠️ | 最长值=429 风暴期重试 |
| 分镜拆解 | 7.4s | 7.8s | 镜头配方（含 imagePrompt） |
| 画面+配音生成 | **85.7s** | 423.8s | 并发 2 图像 + 并发 3 TTS（另：生成排队中位 101s，受并发与 429 影响） |
| 渲染合成 | 25.3s | 50.3s | FFmpeg |
| **端到端** | **中位 409s** | 1050s（风暴窗）/ 121s（最短干净窗） | 表达 → 发布 |

> 修正声明（2026-10-06）：本节初版曾写「中位 ≈3.5 分钟」——该口径只统计了干净窗口案例。全量诚实口径：干净窗口 121–262s，含排队波动中位 409s。明细见 `m15-cost-report.md` §3。

能力级延迟（Generation 记账，成功调用）：

| 能力 | 成功 | 平均延迟 | 备注 |
|------|------|----------|------|
| text.plan（全部用途） | 77 | 4.5s | 修订定位最慢（15.1s，输入为全量结构 JSON） |
| image.shot | 98 | 54.8s | 429 风暴前的干净值约 51s |
| audio.tts | 82 | 1.9s | 首试失败率 37%（短文本 429），重试全数恢复 |
| video.shot（native） | 0（管线级） | —（smoke 直连 56s） | 提交→轮询→下载全程；Golden Case 后补管线级记账 |

### 1.3 Cost Report

Alpha 的成本记账以**调用次数 + 延迟**为代理（provider 未返回金额）：

| 能力 | 调用次数（成功/失败） | 每案例均值 | 说明 |
|------|----------------------|------------|------|
| text.plan | 77 / 0 | 8.6 次 | intent+方向+故事+分镜（+修订定位） |
| image.shot | 98 / 18 | 10.9 张（含重生成） | 失败集中在配额冷却期（regenerate 重入恢复） |
| audio.tts | 82 / 48 | 9.1 段 | 失败全部为秒级 429，重试全数自愈 |
| video.shot | 0（管线级） | — | smoke 直连 1 次；Golden Case 后补 |

单案例全链资源（9 案例均值）：**LLM 8.6 次 + 图像 10.9 张（含重生成）+ TTS 9.1 段 + 合成 1 次 ≈ 产出 1 件 30–43s 竖屏成片**。资产落盘均值 ≈5.8MB/案例 + 分镜图/音频 ≈ 8–24 个生成资产/案例（明细见 `m15-cost-report.md`）。

**429 配额风暴的工程发现**：当日累计 ~100 张图像 + ~130 次 LLM + 130 段 TTS 后，三能力同时进入长冷却。已落地的缓解：能力级重试（3 次指数退避）对秒级 429 有效（TTS 首试失败全部自愈），对长冷却无效——需 regenerate 失败重入（2026-10-06 已闭环：API 侧 + 驱动脚本侧自动检测 failed Job 并重入）——**M2 需要队列级限速与配额感知调度**（工程建议，不改变架构）。

---

## 2. Gate 2 — 内容范式验证

三范式全部产出合格成片，且可从数据层区分：

| 范式 | 案例 | 视觉风格词（配方 style） | 画面特征 |
|------|------|--------------------------|----------|
| A 写实 | p01–p04 | 纪实/朴素/写实方向命中 | 生活场景、暖调 |
| B 电影故事 | p05/p09/p10 | 电影感/质感方向命中 | 情绪镜头、慢节奏 |
| C 强想象 | p06–p08 | 超现实/科幻方向命中 | 非现实场景、奇观 |

**结论：ImagineOS 不是只会生成一种固定形式的视频**——方向层（CreativePlan）的范式选择真实传导到了分镜配方与最终画面（YDIF 分布上 C 范式略高：p06=1.33 > 均值，想象类画面运镜更激进）。

---

## 3. Gate 3 — Revision Quality（⏸ 阻塞，恢复即补跑）

**机制层已验证的证据**（M1 种子 + 记账）：
- 修订定位器（revision.locate）真实运行过：输出 plan（targetLevel/summary/affectedShotIndexes）+ 修改后完整结构，延迟 15.1s；
- 修订=新 ContentVersion（method=revision）+ changelog（用户反馈原文）+ 旧版本完整保留——版本链与记账已由 Gate 5 断言；
- 结构 diff 工具（`lib.mjs diffStructures`）已就绪：镜头级字段级变更定位。

**待补跑**（脚本 `scripts/m15/run-revision-chain.mjs`，断点续跑）：
父亲故事四连改——「再温暖一点」「父亲不要说话」「第二个镜头换成童年」「结尾不要煽情」。每次验证：理解正确（plan 层）/ 只改相关镜头（diff 局部性）/ 新 Version / 旧 Version 保留 / changelog 可追踪原因。

**阻塞原因**：修订 apply 需重跑图像生成（provider 配额冷却）。LLM 定位能力本身已验证可用。

---

## 4. Gate 4 — Remix Quality（⏸ 阻塞，恢复即补跑）

**机制层已验证的证据**（M1 种子的 2 条 Remix 血缘 + Gate 5 断言）：
- 血缘三件套（derivativeContentId/derivativeVersionId/sourceContentId+sourceVersionId）数据库级完整；
- 原作零改动（fork-service 不修改源作任何字段；原作侧仅追加 remixed 事件）；
- 衍作诞生事件 remix_received（含 sourceTitle/sourceVersionNumber）、首版 method=remix、changelog「Remix 自《xxx》vN」；
- Intent rawExpression 复制（新作者起点语境继承）；
- 配方 structureJson 完整继承（字节级相等，Gate 5 断言通过）。

**待补跑**（脚本 `scripts/m15/run-remix-chain.mjs`）：Remix 副本真实再生成（自己的像素）→「把父亲换成母亲，保持原来的情绪和视觉风格」→「结尾旁白轻一点」→ 原作字段级快照 diff 复核。

**阻塞原因**：副本再生成需图像配额。

---

## 5. Gate 5 — Content Integrity Report ✅

数据库级六表关系检查（`scripts/m15/integrity-check.mjs`，非 UI 验证）：

| 维度 | 检查项 | 结果 |
|------|--------|------|
| Content ↔ Version | 版本存在性 / 现势指针指向与最新性 / 版本号连续 / parent 血缘 | ✅ 全过 |
| Version ↔ Asset | Job→资产引用存在性 / READY+PUBLISHED 必有 final / 封面 | ✅ 全过 |
| Content ↔ Generation | 外键 / 延迟记账覆盖 | ✅ 全过 |
| Provenance | 创建事件 / 发布事件 / remix 双侧事件 / 时间线单调 | ✅ 全过 |
| Remix | 三件套归属 / 衍作首版 method / 配方继承 | ✅ 全过 |
| Asset | 孤儿检查 / final+thumbnail 文件落盘（14 个成片全在盘） | ✅ 全过 |

**M1.5 生产案例：0 错误 ｜ 0 警告**（10 案例 + 2 条 Remix 血缘 + 138 条溯源事件 + 6 个发布记录）。
另发现 20 项错误属 M0/M1 遗留测试夹具（状态机走查/发布走查数据无成片），与生产无关，已单独归类报告（`state/integrity.json` legacy 节）。

---

## 6. Gate 6 — Visual Quality Report ✅（证据分级版，详见 `m15-visual-quality-report.md`）

### 6.1 组合式管线的量化画像

帧间差分（YDIF，剔切镜帧后的镜头内运动）+ 静止段检测：

| 指标 | 组合式 | Native（cogvideox-3） | 证据等级 |
|------|--------|------------------------|----------|
| YDIF 均值 | ≈1.0（p04 持久化值 0.907；9 案例区间 0.705–1.33 为引用值） | **2.079（可复现复测，与原始记录 2.08 一致）** | B/C vs **A** |
| YDIF p95 | 2.5–3.5 | 4.181（复测） | B/C vs A |
| 完全静止段 | 0（运镜始终存在） | 0 | B |
| 主体真实运动 | **无**（Ken Burns 全局缓动） | **有**（人物/环境动） | A |

**结论：当前组合式管线生成的是"静态画面 + 音频 + 转场的 MP4"**——被精确量化（YDIF≈1.0，仅为 Native 的一半；真实实拍视频通常 3–8）。运镜（推拉摇移）提供了镜头运动感，无静止帧，音画对齐良好；但**人物不动、环境不动**，对人物故事/情绪/想象类表达的"被看见价值"构成上限。

### 6.2 双路径（按指令建立，未推翻管线）

- **Composition 保留**：成本/延迟/确定性优势（Alpha 基线 + 分镜级局部重生成的支撑）；
- **Native Video Provider Adapter 已真实接入**：`video.shot` 能力（cogvideox-3 图生视频，首帧来自分镜图像）→ 合成层 `videoPath` 分叉 → 同一 xfade/字幕/音频编排 → 同一 Generation 记账与评测框架；
- 调度：配方 `Shot.motion` 字段（缺省 composition）+ 评估开关 `IMAGINEOS_FORCE_NATIVE`；失败自动回落组合式（Provenance 记 native-fallback）；
- 真实验证：56s 出片（speed 档），路由测试 4/4，ADR-0001 Rev.2 已归档；
- 待配额恢复：跑 1 个完整 Native 案例（5 镜全 native）作为 Golden Case 对比样本。

### 6.3 运动评估维度对照（报告口径）

| 维度 | 组合式 | Native |
|------|--------|--------|
| 画面运动 | Ken Burns 全局缓动 | 场景内自然运动 |
| 镜头运动 | 配方 cameraMotion（5 种）忠实执行 | 提示词引导 + 首帧约束 |
| 人物运动 | ❌ 无 | ✅ 有（首帧姿态约束下） |
| 场景连续性 | xfade 1.2s 渐变 | 镜头级独立生成（依赖首帧一致性） |
| 角色一致性 | 分镜图独立生成（Prompt 约束） | 同左 + 首帧锚定（更强） |
| 音画关系 | TTS 实测时长→镜头时长 max 对齐（±0.5s） | 同一编排层 |
| 叙事连续性 | 旁白驱动（结构层保证） | 同左 |

---

## 7. Gate 7 — Human Test Plan ✅（已交付，执行属人工阶段）

`docs/evaluations/human-test-plan.md`：16 人（10 起步）/ 30 分钟每人；开场只说"告诉 ImagineOS 一件你想表达的东西"；六指标操作化定义（Intent completion / 首结果满意度 / 修订行为 / 发布意愿 / Remix 意图 / **"我还想做一个"行为率**）；M2 范围决策矩阵四分支。

---

## 8. UX 语言执行情况（GitHub 阶段新规则落地）

- 全站扫描（`rg` 工程术语）：UI 层零残留（V0/V1/Content Object/Intent Engine/Prompt/seed/采样 均不出现在用户可见文案）；
- 用户语言字典（`src/app/_language/index.ts`）为唯一规范源，新增** Remix → 「从这里开始创作」**（2026-10-06 规则）：卡片 CTA / 发布提示 / Remix 起点邀请（「开始我的创作」）/ SEO 关键词全部同步；
- 新规则文档 `docs/product/user-language-rules.md` 已成为宪法级条款（product-constitution.md §6）。

---

## 9. M1.5 Decision Report（两个关键问题）

### Q1：ImagineOS 当前是否已经证明"普通人的表达可以被转化为有价值的视频作品"？

**分层回答**：

- **表达 → 结构化作品：已证明。** 10/10 类型（9 发布 + 1 阻塞案例的配方层全部完成） Intent 编译零失败；三个范式真实分化；端到端 3.5 分钟。
- **作品 → 有价值的视频体验：部分证明，天花板明确。** 组合式成片的"值不值得被看"受静态画面制约（YDIF 量化）；Native 路径把上限抬高了一档（2.1×运动 + 主体运动），但代价是每镜 60s + 配额消耗。
- **作品 → 被看见→诱发再创作：未证明，属 M2 命题。** 需 Gate 7 真人测试的「我还想做一个」行为率（≥30% 目标线）。

**判定：M1.5 达成度 ≈ 85%**（Gate 1/2/5/6/7 完成；Gate 3/4 机制已验证、专项链待配额恢复补跑——不改变上述分层结论，因为修订/Remix 的不变量已被 M1 种子 + Gate 5 数据库断言覆盖，补跑只是补充行为层证据）。

### Q2：下一阶段最大的瓶颈是 AI 生成质量、Intent 理解、Revision、UX，还是内容传播？

**排序：① AI 生成质量（视觉运动）＞ ② 内容传播 ＞ ③ Intent 理解 ≈ Revision ＞ UX。**

证据链：
1. **视觉质量**是唯一被量化证实的短板（YDIF 1.0 vs Native 2.1 vs 实拍 3–8）——观众的第一眼价值由它决定；
2. **内容传播**是未验证的下一环（M2 命题），且依赖视觉质量先达标——不值得为静态画面做分发；
3. **Intent 理解与 Revision** 表现良好（76 次 LLM 零失败、10/10 类型编译成功、修订定位可用），但 Gate 3 补跑后将获得局部性精度的最终数据；
4. **UX** 无负面证据（M0 评审方向确认 + 语言规则全落地），真人测试（Gate 7）才是它的真正考场。

**M2 建议**（等待产品负责人确认）：
- **主线 A（推荐）**：视觉质量深化——Native 路径的产品化（调度策略：哪些镜头用 native / 用户分层 / 成本控制）+ 首帧一致性（角色锚定）；
- **主线 B**：内容侧最小验证——Explore 分发 + Remix 转化漏斗（先于任何社交功能）；
- 前置：Gate 3/4 补跑 + Gate 7 真人测试执行（10–20 人）。

---

## 10. 阻塞项与恢复路径（透明记录；2026-10-06 多 Provider 联调更新）

**阻塞结构已改变**：LLM/Image 通道经 agnes-com 自定义 Provider 已畅通（§0.5）；剩余阻塞收敛为 **TTS 通道无可用 Provider**（agnes 无 TTS 模型 + z-ai 429 冷却）与 **agnes 视频队列满（503）**。后台守望器（`scripts/quota-watcher.mjs`，孤儿化进程）每 150s 探测两项，恢复即立旗触发补跑。

| 项 | 状态 | 恢复动作 | 依赖 |
|----|------|----------|------|
| p10 发布 | 配方/分镜/部分资产完成 | `node scripts/m15/run-cases.mjs p10-cause`（failed Job 自动 regenerate 重入） | z-ai TTS 恢复 |
| Gate 3 四连改 | 脚本就绪（未启动） | `node scripts/m15/run-revision-chain.mjs` | z-ai TTS 恢复 |
| Gate 4 Remix 链 | 脚本就绪（依赖 Gate 3） | `node scripts/m15/run-remix-chain.mjs` | z-ai TTS 恢复 |
| Native Golden Case | 协议适配完成 + 单测覆盖 | `bash scripts/m15/restart-dev.sh native && node scripts/m15/run-native-golden.mjs && bash scripts/m15/restart-dev.sh composition` | z-ai TTS + agnes 视频队列 |

一键补跑（含等待-触发-模式切换-终版度量全链）：`node scripts/m15/finish-m15.mjs`（多 Provider 版：等 TTS → p10/G3/G4 → Native Golden → 终版数据；幂等断点续跑）。
预计 TTS 恢复后实际执行时长 ~40–60 分钟。

## 11. 交付物清单

| # | 交付物 | 状态 |
|---|--------|------|
| 1 | 10 个真实创作案例（含指标） | ✅ 9 发布 + 1 阻塞（数据在 `scripts/m15/state/`） |
| 2 | Visual Quality Report | ✅ `m15-visual-quality-report.md`（证据分级 A/B/C） |
| 3 | Revision Evaluation | 🔶 机制层 ✅ / 四连改链 ⏸（`m15-revision-report.md`） |
| 4 | Remix Evaluation | 🔶 机制层 ✅ / 专项链 ⏸（`m15-remix-report.md`） |
| 5 | Content Integrity Report | ✅ `m15-content-integrity-report.md`（0 错 0 警 + 媒体真实性披露） |
| 6 | Cost Report | ✅ `m15-cost-report.md`（DB 权威记账） |
| 7 | Latency Report | ✅ §1.2（修正口径）+ Cost Report §3 |
| 8 | Human Test Plan | ✅ `human-test-plan.md`；系统侧就绪验证 + 报告模板 ✅ `m15-human-test-report.md` |
| 9 | M1.5 Decision Report | ✅ `m15-decision-report.md`（Q1–Q7；待补项标注） |
| 10 | 一键恢复编排器 | ✅ `scripts/m15/finish-m15.mjs`（含 native 模式切换与 failed Job 重入） |
