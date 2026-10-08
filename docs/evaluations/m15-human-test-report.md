# Human Test Report — M1.5 Gate 7（真人表达测试）

> 文档地位：Gate 7 执行报告 · **执行阶段已开启（2026-10-07 系统侧预演完成，真人数据待采集）**
> 状态：系统侧就绪经预演实证；凡未执行的字段一律标「未执行」，禁止预填虚构值（预演会话属机器侧验证，不计入六指标，见 §0.5 隔离机制）
> 对应计划：`docs/evaluations/human-test-plan.md`（16 人 / 30 分钟 / 六指标）· 观察员物料：`download/gate7-kit/gate7-observer-kit.md`（逐字稿卡/记录表/Pre-flight/Runbook）

---

## 0a. Model Provider 执行环境（真人测试期间生效配置）

> 权威记录：`m15-expression-quality-report.md` §0.5。真人测试执行时系统实际路由（Registry 动态链，自定义优先 → 内置兜底）：

| 通道 | 首选（自定义） | 兜底（内置） | 说明 |
|------|---------------|-------------|------|
| LLM | `openai-compat:agnes-com` · `agnes-3.0-flash` | `zai-chat` | 自定义失败自动降级 |
| Image | `openai-compat:agnes-com` · `agnes-image-2.5-flash` | `zai-image` | 降级已实测（agnes 6 连败 → zai-image 接管） |
| TTS | —（无自定义，产品负责人指定 TTS 走内置） | `zai-tts` · `zai-tts-tongtong` | z-ai 配额间歇 429 时 narration 重试吸收 |
| Video | `openai-compat:agnes-com` · `agnes-video-2.5-flash` | `zai-video` · `cogvideox-3` | 仅 native 模式路径；agnes 队列满时自动降级内置视频 |

---

## 0. 系统侧就绪声明（2026-10-06 验证）

| 就绪项 | 验证方式 | 状态 |
|--------|----------|------|
| Session ↔ Content 关联 | 匿名会话（imagineos_sid cookie）→ User → Content.ownerId；`ContentVersion.createdBy` 记录每一次修订的操作者 | ✅ 已验证（DB 抽查） |
| 修订关联用户 | ContentVersion.createdBy + creationMethod=revision + changelog 保存用户原话 | ✅ |
| 发布记录 | Publication 表 + Provenance `published` 事件（终版 20 条发布在库） | ✅ |
| Remix 记录 | Remix 血缘三件套 + remixerId + 双侧 Provenance 事件（8 条在库） | ✅ |
| Repeat Creation 记录 | 同一 ownerId 多作品计数（`export-human-test.mjs` 自动推导 repeatCreation） | ✅ |
| 结果可导出 | `node scripts/m15/export-human-test.mjs --since="<测试开始时刻>"` → `state/human-test-export.json`（六指标汇总 + 每被试明细） | ✅ 实测可运行 |
| 测试作品批量 integrity check | `node scripts/m15/integrity-check.mjs <idsFile>`（idsFile 由导出结果提取 contentId，换行分隔） | ✅ 作用域机制实测 |
| composition / native 配置区分 | Generation 记账：type=video.shot 存在且 succeeded → native 镜头；导出结果含 nativeConfig 字段（native / native-with-fallback / composition-fallback） | ✅ |

**执行注意**：Alpha 默认 composition 路径；如本轮测试需含 native 样本，测试时段内 dev server 以 `IMAGINEOS_FORCE_NATIVE=1` 运行（切换方式：`bash scripts/m15/restart-dev.sh native`），并在 §1 记录配置。

---

## 0.5 执行阶段开启与系统侧预演（2026-10-07，产品负责人指令：进入 Gate 7 执行阶段）

### 0.5.1 Pre-flight 清单实测结果（human-test-plan.md §10）

| 检查项 | 实测结果 | 状态 |
|--------|----------|------|
| 预览可达 | 本地 home 200 + 预览 URL 200（手机/桌面均可） | ✅ |
| Provider 三通道探测 | agnes LLM 真实对话 2.3s ✅ / agnes Image 真实生图 11.3s ✅ / z-ai TTS 真实合成 733ms ✅（运行时同路径连接测试端点验证） | ✅ 全绿 |
| 运动路径配置 | composition（dev server `IMAGINEOS_FORCE_NATIVE` 为空，进程环境实测） | ✅ 已决定 |
| 导出链路预演 | `export-human-test.mjs --since` 时间窗过滤实测正确（见 0.5.2） | ✅ |
| 种子/机器会话隔离 | isDemo 排除 + 时间窗双机制（34 历史非种子用户被 --since 正确排除） | ✅ |

### 0.5.2 系统侧预演记录（A 级证据，非 Gate 7 数据）

**定位声明**：预演为机器侧管道与环境就绪验证（全新匿名会话全链并发驱动，与测试日两位被试同时创作同形态）；六指标的人工编码字段（首反应/访谈确认/修订语境）不可由脚本产生，预演会话**不计入**任何 Gate 7 指标。

| 项 | 记录 |
|----|------|
| 预演时间窗 | 2026-10-07T00:37:09Z 起（窗口文件 state/gate7-rehearsal-window.json） |
| 会话形态 | 2 个全新匿名会话（无 cookie 恢复 = 独立 User）**并发**全链至发布——同时考验 SQLite 跨会话写锁（30s 事务超时修复的真实并发验证） |
| 被试人设 | R1（45+，家庭回忆，小卖部母亲六十岁生日）/ R2（20-30，情绪，凌晨下班路）——对应计划 §2 配额维度 |
| 结果 | **2/2 发布成功**：R1 105s / R2 154s（均在干净窗口范围；并发无写锁冲突） |
| 导出演练 | `--since=预演窗口起点` → 被试数 2，六指标自动推导正确（contentsCreated/published 均 1）；历史会话全部排除 |
| 完整性复核 | idsFile 作用域批量（state/gate7-rehearsal-ids.txt，2 件）→ M1.5 生产案例 15 件 **0 错 0 警**（含预演作品） |
| 隔离机制 | 预演用户创建于今日；真人测试导出用 `--since=<真人测试开始时刻>` 自动排除预演会话（时间窗隔离，导出实测验证） |

### 0.5.3 配额预算（10–16 人规模，含安全余量）

- 每被试全链 ≈ 8.6 次 LLM（agnes，免费）+ 10.9 张图（agnes，免费）+ 9.1 段 TTS（**内置 z-ai，唯一配额敏感通道**）；
- 按计划 §8 节奏 4–6 人/天 → TTS 日耗 ~15–55 段，低于历史风暴阈值（~130 段/天）；
- 风控：每天开场跑 Pre-flight 探测（observer kit §C）；测试中中止条件三案（连续 3 任务失败 / 预览不可达 >5min / 5xx）；失败重入机制（regenerate）已实战验证。

### 0.5.4 真人阶段交接（待产品负责人执行）

1. **招募**（计划 §2：目标 16 人/起步 10 人；≥70% 无剪辑经验；三年龄段；手机 ≥60%）；
2. **执行**（计划 §3 逐字稿 + observer kit 打印物料：逐字稿卡 A / 记录表 B / 每日 Pre-flight C）；
3. **收尾命令**（observer kit §D Runbook：导出 + idsFile 完整性复核）；
4. **回传**：记录表转录 + 导出 JSON → 填充本报告 §1–§7（人工字段与系统字段合并规则见计划 §5.1）；
5. **裁决**：报告 §6 决策矩阵 → M2 方向确定（M2 开发冻结至此时，Final Package §5）。

### 0.5.5 测试执行期线上缺陷与修复（2026-10-07 02:15，观察员上报）

**现象**：真实被试作品卡「AI 生成中」无限等待。上报样本 `cmuw6r7kl014pktgk91ipxxp9`（Creation ID 转写误差一位，`k10l4` 实为 `kl014`）。

**调查结论**（五点全链路追踪，scripts/m15/investigate-stuck-creation.mjs）：

1. creation 创建于 10-06 04:35（Remix 衍生作品，配方字节继承，无需 plan 生成）；
2. storyboard Job 已创建并于 10:38 执行——4 轮重试共 24 次 `image.shot` 调用全部 zai-image 429，10:39 耗尽重试标记 failed；
3. workflow 执行日志完整（Generation 记账 24 条）；provider 确认收到请求；
4. **根因**：`jobService.fail()` 永久失败后未传导 Content——`lastErrorJson` 字段自 M0 声明以来从未被写入（§51 的另一半从未实现），Content 永留 GENERATING、轮询 API 只返回活跃 Job（job=null）、前端无限「AI 生成中」；
5. **次因**：被试 20:53 二次自救时落入首页旧修订对话框（POST /versions 只建版本不触发生成），加剧孤儿态。全库同类孤儿共 3 条（另 2 条为 TTS 429 同因）。

**修复**（M2 冻结例外：线上缺陷处置，Final Package §5 允许）：

| # | 修复 | 位置 |
|---|------|------|
| 1 | Job 永久失败/租约超时 → 写入 `Content.lastErrorJson`（code+message）+ `generation_failed` 溯源事件 | core/jobs/job-service.ts |
| 2 | 孤儿看门狗：每 30s 扫描 GENERATING/RENDERING 无活跃 Job 且静默 >10min（env 可调）→ 标记超时；永不无限转圈 | job-service.sweepOrphanedGenerations + worker 循环 |
| 3 | 入队失败同步标记（enqueue_failed）并抛出——不再留下「推进了状态但没有 Job」的窗口 | core/content/generation-flow.ts |
| 4 | 创作页 API 暴露失败态：无活跃 Job 时回查最近终态失败 Job + lastError 字段 | api/contents/[id]/creation |
| 5 | 创作页失败卡（错误原因 + 重新生成/重新合成按钮）+ 失败态停止 2.5s 轮询；startRender 支持 RENDERING 无活跃 Job 重入（镜像 M1.5 regenerate 修复模式） | app/create/[id]/page.tsx + generation-flow |
| 6 | 首页修订对话框死路修复：改跳转创作空间（`?revise=` 承接用户输入，走完整定位→新版本→重生成链路），不再 POST /versions | app/page.tsx + create 页承接 |
| 7 | 探索播放对话框关闭按钮不可见修复（原 `absolute -top-11` 悬于视口外裁剪区，高卡片时被裁剪；移入视频区右上角） | app/page.tsx |

**验证**（全部真实执行）：单测 +9（失败传导/重试重置/看门狗/恢复端到端，全套 73/73）；E2E 失败态 API 8/8（scripts/m15/e2e-failure-surface.mjs）；UI 浏览器验证 9/9（失败卡渲染/原因可见/重试按钮/无限转圈消失/轮询停止/重生成回路 + 关闭按钮视口内/小视口可见/可关闭，scripts/m15/ui-verify-gate7-fix.sh）；看门狗自动修复 3 条存量孤儿（0 剩余）；实时传导实测（调试 Job 失败 → lastErrorJson 立即写入）。

**对 Gate 7 的影响**：3 条被试卡死作品已自动标记失败并可在创作页重试；观察员如遇同类「生成没有完成」卡片，按逐字稿卡「卡住 ≥5min 预案」处理（先点重新生成，连续失败则记录中止）。本缺陷不计入 Expression Success 率的系统性偏差——被试的卡死经历属于真实用户体验数据，如实编码。

### 0.5.6 重试成功作品的产物形态追问（2026-10-07 03:00，观察员上报）

**现象**：§0.5.5 上报作品重试后生成成功，但被试确认产物为「composition 动态图片」而非 AI 视频模型产物，质疑为什么没走 native 管线（证据：`job.type = video.storyboard`）。

**真实路径判定（三态 A/B/C，scripts/m15/investigate-native-routing.mjs，只读取证）**：

- 判定结果：**C——默认直接 composition**。既不是「native 成功」（A），也不是「native 失败后回落」（B）：native 分支从未被进入。
- 证据链（DB + 进程环境）：
  1. `video.storyboard` 是所有生成的唯一 Job 类型（native/composition 的分岔不在 Job 层，而在 worker 内部逐镜调度 `motionModeFor()`）；该证据本身不构成 composition 的证明，但下列证据构成；
  2. dev server 进程环境 `IMAGINEOS_FORCE_NATIVE` 为空（Gate 7 Pre-flight §10 的既定决定：Alpha 默认 composition 路径）；
  3. 该作品配方 v2 的 5 个镜头 `motion` 字段全部 undefined——`StoryboardSchema`（LLM 分镜输出）不含 motion 字段，`plan-service` 也不写入，该字段在全系统无任何写入点；
  4. Provenance 0 条 `video.shot`/`native-fallback` 事件，Generation 记账 0 条 video 调用（全库 28 条 video.shot 记账全部来自 Native Golden 评估内容，10-06 晚 FORCE_NATIVE=1 时段）；
  5. 资产物证：5 张 PNG 图 + 5 段 WAV 旁白 + 1 个 FFmpeg 合成 MP4——零 AI 视频模型产物。
- 第 5 问如实回答：**native video 通道可用但默认关闭属实**——video.shot Provider 链就绪（agnes-video-2.5-flash enabled + zai-video 兜底，`hasVideoShotProvider()=true`），但仅有的两个开启途径（`IMAGINEOS_FORCE_NATIVE=1` 环境变量 / 配方 `motion='native'` 字段）前者未开启、后者为无写入点的死字段。**评估标准未做任何修改**。
- 可观测性缺口如实记录：composition 路径不产生路由决策日志（仅 native 失败回落时打 warn + Provenance）——「零事件」与「未尝试」需要靠资产物证区分。

**修复（防误解的产品诚实性要求，M2 冻结例外：测试执行期用户可见性缺陷）**：

| # | 修复 | 位置 |
|---|------|------|
| 1 | 生成模式三态计算（composition/native/hybrid + nativeShots/totalShots），口径=最近成功 storyboard Job 的 shotAssets | core/jobs/job-service.ts（computeGenerationMode + 单作/批量查询） |
| 2 | 探索/我的创作列表 API 携带 generationMode | api/contents/route.ts |
| 3 | 创作空间聚合 API 携带 generationMode | api/contents/[id]/creation |
| 4 | 用户可见徽章「生成模式：AI 图像 + 运镜合成 / AI 视频生成 / AI 视频 x/N 镜 · 其余图像合成」+ 悬停说明（防误解文案） | _language（generationModeLabel + GENERATION_MODE_DESC）+ 首页卡片/播放对话框 + 创作页 REVIEW/成片区 |
| 5 | 夹具作品（无生成记录）返回 null——不猜模式，不显示徽章 | 同上（computeGenerationMode 脏容错） |

**验证**（全部真实执行）：单测 +6（三态口径/脏容错/批量优先当前版本/用户语言，全套 79/79）；API 实测（explore 列表 24 项：21 带模式 + 3 夹具 NULL）；UI 浏览器实测（探索卡片徽章 composition+hybrid / 播放对话框徽章+悬停说明 / 创作页成片区徽章两态 / 375px 小视口不溢出）。

**对 Gate 7 的影响**：被试将看到每个作品的生成模式徽章——「AI 图像 + 运镜合成」与「AI 视频生成」的区分对首反应编码是重要上下文（被试不应把合成形态误读为 AI 视频模型能力）。观察员无需主动解释；被试问「这是 AI 视频吗」时按徽章口径回答。§1 运动路径配置行仍如实记录测试时段的 FORCE_NATIVE 状态。

### 0.5.7 Video Pipeline Audit 与路由决策日志（2026-10-07 05:00，产品负责人指令）

§0.5.6 之后产品负责人要求正式 Video Pipeline Audit（只读不改，`download/video-pipeline-audit-report.md`）。审计结论与 §0.5.6 一致且更完整：三态判定 **C**；归因 = **产品设计如此（ADR-0001 Rev.2「调度策略 M2 再定」）+ 配置默认如此**（FORCE_NATIVE 空 + motion 死字段），非 fallback 非代码错误；`job.type=video.storyboard` 是所有生成的唯一类型，不构成形态证据。新增事实：native 通道历史成功率 1/28（3.6%），且探测时点（10-07 05:00）agnes-video 队列仍满（503 video_queue_full）——**Gate 7 维持 composition 默认是正确决定，native 样本采集需等队列窗口**。

**审计后落地（M2 冻结例外：测试执行期可观测性缺陷，与 §0.5.5/§0.5.6 同类）**：

| # | 内容 | 位置 |
|---|------|------|
| 1 | 路由决策事件：storyboard Job 执行开头写 Provenance `mode.decision`（mode/forceNative/motionShots/totalShots/videoProviderAvailable，意图口径） | core/content/storyboard-mode.ts（纯函数）+ workers/pipeline-executor.ts |
| 2 | 观察员探针：probe-channels-now.mjs 新增 agnes-video 队列探测（提交+轮询，不下载成品） | scripts/m15/probe-channels-now.mjs |
| 3 | 仓库根 README：双路径架构、当前默认 composition、切换方式、死字段警示 | README.md（新建） |
| 4 | ADR-0001 附录：实施现状备注（FORCE_NATIVE 仅评估脚本注入 / motion 零写入点 / M2 正规入口） | docs/decisions/ADR-0001 |

**验证**：单测 +6 → 85/85 全绿；typecheck ✓ lint ✓；全链真实生成实测（verify-mode-decision.mjs，116s 至 READY）11/11 断言通过——事件字段正确、意图口径与产物口径一致（6 镜零回落）、全链无回归；验证数据已清理（content+匿名 user 级联删除，零残留）。

**对 Gate 7 的影响**：§5 nativeConfig 行此后可直接读 Provenance `mode.decision` 事件（不再需要零记账反推）；composition 产物每件都有决策记录，观察员核查成本降为零。评估标准仍零修改。

---

## 1. 测试执行概况（人工填写）

- 执行时段：______（含时区）
- 应到 / 实到：____ / ____ 人（目标 16，起步线 10）
- 设备分布（手机/桌面）：____ / ____
- 运动路径配置：composition 全程 ／ native 全程 ／ 混合（说明）：______
- 观察员：______
- Provider 配额状态（测试时段）：______（如遇 429 长冷却需如实记录并暂停测试，不得带病出数据）

## 2. 主指标汇总（自动 + 人工编码各占一半）

### 2.1 系统侧自动指标（来自 human-test-export.json）

| 指标 | 数值 | 目标线 | 达标 |
|------|------|--------|------|
| Intent completion（系统侧代理：开场表达→完成首件作品创建） | 未执行 | — | — |
| 发布率（published/participants） | 未执行 | — | — |
| 修订参与率（revisedParticipants/participants） | 未执行 | — | — |
| Remix 参与率（remixedParticipants/participants） | 未执行 | — | — |
| 「我还想做一个」行为率（repeatCreationParticipants/participants） | 未执行 | ≥30% | — |

> 导出命令复现：`node scripts/m15/export-human-test.mjs --since="<§1 执行时段起点>"`

### 2.2 人工编码指标（观察员记录表转录）

| 指标 | 正 / 中 / 负 | 备注 |
|------|--------------|------|
| First result satisfaction（初稿首反应编码分布） | 未执行 | — |
| Intent completion（访谈确认「方向里有我想要的」） | 未执行 | — |
| 修订后满意度变化 | 未执行 | — |
| 未发布者理由分布 | 未执行 | — |

**主指标（一票汇总）**：Expression Success = Intent completion ∧ First result satisfaction ≥ 中 ∧ (Published ∨ 明确表达满意)

- 数值：未执行（目标 ≥50%）

## 3. 每被试明细（人工转录 + 系统导出合并）

（每行一人；系统侧字段由 export 自动生成，人工字段由记录表转录）

| # | 编号 | 表达原文（开场） | 到达方向耗时 | 首反应 | 修订轮数/类别 | 发布 | Remix | 还想做一个 | Expression Success |
|---|------|------------------|--------------|--------|----------------|------|-------|------------|--------------------|
| 1 | 未执行 | | | | | | | | |
| … | | | | | | | | | |

## 4. 质性发现（收尾访谈要点，人工填写）

未执行。重点记录：
- 被试自己的语言如何描述「这是什么」（产品认知）
- 最卡住的时刻与原话
- 对「旧版本随时可以找回」的理解程度
- 对「从这里开始创作」的理解（是否理解为「抄袭」vs「接力」）

## 5. 测试作品完整性复核（系统侧，测试结束后执行）

- 导出作品清单：______ 件
- `node scripts/m15/integrity-check.mjs <idsFile>` 结果：未执行（预期 0 错误 0 警告；如有告警逐条列出并归因）
- native 样本（若有）：nativeConfig 分布 ______

## 6. M2 范围决策矩阵应用（人工执行后填写）

| 结果模式 | 命中 |
|----------|------|
| Expression Success ≥50% 且「还想做一个」≥30% → M2 可进入内容传播侧 | 未判定 |
| Expression Success ≥50% 但「还想做一个」<30% → 瓶颈在内容传播侧，聚焦 Explore 分发与作品呈现 | 未判定 |
| Expression Success <50%，修订行为少 → 瓶颈在生成质量/Intent，聚焦 Native Video 与访谈优化 | 未判定 |
| 满意度高但发布意愿低 → 私域价值成立，优先私域分享链路 | 未判定 |

## 7. 结论（人工执行后填写）

未执行。

### 0.5.8 双免费额度限速感知调度（2026-10-07 05:30，产品负责人指令）

**背景**：产品负责人在模型配置中新增 agnes-cn（api.agnes-ai.cn）与既有 agnes-com 并行，指示按官方免费额度限速规则（tokenplan.md：文本 RPM 10 / 图片 1K RPM 10 / 视频 RPM 1 + 每日秒数；429 = 等 1 分钟）动态利用两家额度防止限速。此前调度为「agnes-com 恒先、失败才降级」——单站点打满即 429 风暴（§0.5.5 P0 根因之一）。

**落地**（registry.ts 三层策略，详见 architecture/ai-model-layer.md §8）：

| # | 策略 | 效果 |
|---|------|------|
| 1 | 同优先级轮转（agnes-cn/com 均为 priority 10 → 轮转组） | 每次调用起始位交替，两家额度各担一半流量，等效 RPM 翻倍 |
| 2 | 限速冷却（429/queue_full → 60s 排链尾，IMAGINEOS_RATE_COOLDOWN_MS 可调） | 限速者让位不拉黑，恢复即归队 |
| 3 | 非末位候选快速让位（跳过退避重试）；末位保留 3 次退避 | 双站点互为灾备；单链（zai-tts）仍等待恢复 |

**验证**（全部真实执行）：单测 +12 → 97/97；typecheck ✓ lint ✓；全链 E2E 13/13（150s 至 READY），**Generation 记账双通道分布：LLM agnes-cn:4 / agnes-com:3，图片 agnes-cn:3 / agnes-com:2**——轮转在真实生产路径生效，零限速失败；期间 2 次 zai-tts 瞬时失败由末位退避重试救回（策略第 3 层的例外分支实测命中）。探测脚本升级为逐行探测（默认 LLM+TTS 近零消耗；--full 追加 Image/Video，注明额度成本；--video 仅 Video 最小额度模式）。

**agnes-cn 视频链路实测补充**（2026-10-07 06:44）：①提交端点真实可达——双站点队列均满返回 503（agnes-com 英文 `video queue is full` / agnes-cn 中文「视频队列已满」，独立部署各自本地化；R1 队列满事实延续，两站点探测时点均无窗口）；②轮询路径 `api.agnes-ai.cn/agnesapi` 由文档推导转为实测坐实——零额度探测（GET 假 video_id，`scripts/m15/probe-video-poll-path.mjs`）返回 JSON 协议体「任务不存在」，与 com 站 `task not found` 同构；③中文限速消息兼容性确认——错误消息传播链携带响应体，`isRateLimited` 对 `video_queue_full` 与「队列满」双重命中，agnes-cn 冷却让位行为与 com 站一致。native 样本采集（全镜 Golden Case 重跑）仍待任一站点队列窗口。

**官方文档双站复核**（2026-10-07 07:00，产品负责人指定 agnes-video-25-flash 双站页面，另拉 tokenplan 佐证限速）：双站文档同构仅币种差异（¥0/$0 每秒，限时免费）；免费档视频实际 RPM 1（允许发起 2）；**限制池按密钥类型共享、同类型多密钥不叠加**，但 agnes-cn/com 为两套独立部署独立额度池——双 provider 轮转属官方口径下合规的额度利用，非绕限；轮询官方建议 1–2s（我们 3s 保守不超速）、keyframe 轮询必须带 model_name（代码恒带）。**遗留风险入档**：first_frame 官方口径为公开 URL、生产传 data URI——已过校验层（503 非 400），推理层是否接受待队列窗口验证（本地无公网托管能力，data URI 为当前唯一形态）。**观测缺口修复**：Generation 失败记账此前丢弃 error 字段（历史 15 条 agnes video.shot 失败全无原因可查），现失败原因写入 outputJson——历史失败延迟双峰（~20.5s 队列满退避耗尽 / ~200ms 瞬时错，与 RPM 1 下 429 形态吻合）反向坐实限速感知调度的必要性。

**对 Gate 7 的影响**：测试日双被试并发创作（§0.5.5 事故形态）下，图片/LLM 流量由两家免费额度分摊 + 429 自动冷却让位——「三通道任一长冷却」的中止条件触发概率显著下降；Provider 配额状态行（§1）建议记录双站点各自的探测结果。评估标准零修改（M2 冻结例外：测试执行期可靠性加固，与 §0.5.5 同族——其根因即 provider 限速）。

### 0.5.9 data URI 双站验证闭合 + 产品功能硬化（2026-10-07 12:11–13:00，产品负责人指令转向）

**R1 核心遗留闭合：first_frame data URI 推理层接受度——双站验证通过**。2026-10-07 12:11:27 agnes-cn 视频队列窗口打开（此前 2026-10-06 20:14 agnes-com 已全链成功 278s / 1.12MB / 704x1280 / data URI 首帧），守望器 v2 提交成功后进程被外部 SIGKILL，`scripts/m15/salvage-cn-task.mjs` 直接轮询收割在途任务（零额外额度消耗）：**0.78MB / 704x1280 / data URI 首帧 cn 站推理层验证通过**。双站旗文件 `scripts/m15/state/flags/agnes-video-ok--agnes-cn` 与 `--agnes-com` 均已立起——「官方口径公开 URL vs 生产 data URI」的形态风险正式闭合：**Flash 校验层与推理层均接受 data URI**（本地无公网托管能力下，当前唯一形态可用）。

**产品负责人指令转向**（2026-10-07 12:38）：「你把产品功能做好，至于作品用户自己体验」——native 全镜采样重跑（supervise-g6-native，12:19–12:38 已完成其 storyboard job 后）**正式终止，不再重启**；双站每日免费秒数额度让位 Gate 7 真人测试；**作品质量（native 形态表现力）评估归用户侧体验，系统侧不再预生成样本自评**。dev server 已切回 composition（Gate 7 默认）。

**产品功能硬化（M2 冻结例外：线上缺陷，三项均有同日实证）**：

1. **前置条件错误 fail-fast**：实证——08:31 门禁跑批期间，worker 真实执行测试遗留 job，「配方中没有镜头（先完成分镜）」这一确定性错误被无差别重试 3 轮、1 秒内耗尽（`GenerationJob` 3 条 failed retry=3/3 同秒落账）。修复——新增 `NonRetryableJobError`（job-service 导出）；pipeline-executor 全部结构性前置条件（作品不存在/配方缺失/配方无镜头/payload 坏 JSON/未知 Job 类型/版本结构损坏）改抛该类型；worker catch 识别后 `retryable: false` 一次终态 + `Content.lastErrorJson` 直接落用户可见指引（「先完成分镜」）。运行时状态依赖失败（如 render 的「找不到已完成的分镜生成记录」）保持可重试（温和侧：退避后 storyboard 完成即可自愈）。
2. **重试退避（防重试风暴）**：实证——同上 1 秒 3 轮形态；429/503 场景下立即重试还会加重限流（§0.5.8 冷却调度的反面）。修复——`fail()` 回队时按 retryCount 递增退避（15s/30s/45s，`RETRY_BACKOFF_BASE_MS`），经 `leaseExpiresAt` 表达「最早可认领时间」（SQLite 队列无独立调度字段，复用租约语义）；`claimNext()` 过滤退避窗口。退避中的 queued Job 仍是 `activeJobForContent` 意义上的活跃 Job（进度轮询不闪断）。
3. **vitest 测试库隔离**：实证——①生产 `custom.db` 的 `GenerationJob` 中存在 error=「x」的记录（tests/generation-failure.test.ts:92 直接写入）；②测试遗留的 queued Job 被 dev server worker 认领真实执行（同日 08:31 批次）。修复——`vitest.config.ts` 注入 `DATABASE_URL=file:db/test.db` + `tests/global-setup.ts` 每轮删库重建；跑批前后对照验证：**custom.db jobs/generations/contents 计数 91/727/215 零变化**，测试数据 12 jobs / 39 contents 全部落 test.db。此后门禁跑批与被试数据彻底隔离，且生产 worker 永不再执行测试 Job（额度零误耗）。

**门禁与部署**：tsc ✓ / eslint ✓ / vitest **101/101**（97 基线 + 4 新增 `tests/job-retry-policy.test.ts`）；dev server 已以新代码重启（composition 模式，worker tick 正常）。**对 Gate 7 的影响**：被试遇到配方竞态时立即看到可操作指引（而非 3 轮无声重试后的延迟失败）；429/队列满场景的重试风暴消失（与 §0.5.8 冷却调度叠加，双站点让位更平滑）；门禁跑批不再触碰被试数据。评估标准零修改。

### 0.5.10 产品默认 native-first（2026-10-07 13:00，产品负责人指令：「我就想要AI视频，不是AI图片播放」）

**指令理解与裁决**：产品负责人明确产品预期 = AI 视频模型逐镜生成的真实运动画面，而非「AI 图 + Ken Burns 运镜」的组合式合成——此为 ADR-0001 Rev.2 留待 M2 的调度策略裁决，由本指令提前作出（**Rev.3**，详见 ADR）：**产品默认 = native**。

**实施（`src/core/content/storyboard-mode.ts` 为单一事实源）**：
- `motionModeFor` 缺省翻转 `composition` → `native`；决策优先级 = `IMAGINEOS_FORCE_NATIVE`（评估开关）> `IMAGINEOS_FORCE_COMPOSITION`（**新增运维逃生阀**：视频 provider 全挂时强制合成路径保可用性）> 配方 `motion` 显式值 > 产品默认 native；
- `workers/pipeline-executor.ts` 本地 motionModeFor 副本删除，改引中心模块；逐镜回落兜底（native 失败 → 该镜 composition + native-fallback 溯源事件）与诚实标签（computeGenerationMode：native/hybrid/composition 用户可见）保持不变；
- `restart-dev.sh` 三模式化：`product`（默认，无开关）/ `native` / `composition`；dev server 已以 **product 模式**运行（native-first 生效）。

**翻转的前置依据**：双站点 data URI 首帧推理层验证通过（§0.5.9，agnes-com 278s 全链 + agnes-cn 抢救收割 0.78MB）；限速感知调度（§0.5.8 双 provider 轮转 + 冷却让位）在位；0.5.9 的重试退避 + fail-fast 保证队列满场景不产生重试风暴。

**对 Gate 7 的影响（如实告知被试与记录）**：生成时长预期从 ~15s/镜升至 ~60–250s/镜（队列窗口依赖），全片 5–10 分钟属正常；队列满/额度耗尽时部分镜回落 composition（hybrid）或全回落（composition），产物标签如实显示——回落是兜底行为非缺陷，被试若对形态不满如实记录（这正是 Alpha 要验证的表达链路事实）。每日免费秒数消耗显著上升，双站点额度让位真人测试（§0.5.9 指令延续）。评估标准零修改。

**门禁**：tsc ✓ / eslint ✓ / vitest **104/104**（+3：motionModeFor 单测 3 例 + storyboardModeDecision 重写 6 例）。测试库隔离下跑批，custom.db 零污染。

### 0.5.11 生成进度渐进可见——「黑盒」修复（2026-10-07 13:30，产品负责人截图反馈）

**现象（产品负责人截图实证）**：创作页生成阶段显示「正在绘制镜头画面（2/5）」+ 进度条 ~40%，但下方 5 个镜头格子全部是**黑色占位块**——已完成 2 个镜头的画面用户完全看不到，整个生成过程是黑盒。native-first 翻转（§0.5.10）后该缺口被放大：native 镜头 60–250s/镜，用户要盯黑盒 5–20 分钟。

**根因（链路三处全是「完成前不可见」）**：①worker `reportProgress` 只报 `{stage,current,total,label}`，已完成镜头的资产 ID 不在进度载荷；②creation API 的 `assets.shots` 仅在 storyboard Job **成功后**由 `latestSucceededJob` 填充；③前端 `GeneratingStage` 组件本身已具备渐进渲染能力（`imageByIndex` 有 url 即渲染），但生成中拿不到数据。

**修复（前后端零破坏性，前端组件零改动即生效）**：
1. **pipeline-executor**：镜头图片保存后**立即**入进度载荷（`shotAssets` 快照，图片秒级到达）；native 视频完成后再上报补齐 `videoAssetId`（视频 60–250s 后到）；进度计数 `current` 口径 = 该镜全部完成（图+视频），进度条不虚高；label 按模式本地化（composition「正在绘制镜头画面」/ native-hybrid「正在生成 AI 视频镜头」）；
2. **creation API**：storyboard 活跃 Job 的进度载荷含 `shotAssets` 时，透出为 `assets.shots`（imageUrl 经 assetService 解析）——覆盖旧轮次历史资产（regenerate 场景显示本轮渐进而非上一轮旧图）；
3. **前端**：镜头图 fade-in 动画（0.35s），渐进长出的可感知仪式感；重试期间已见图片不消失（`fail()` 回队保留 outputJson，轮询不闪断）。

**测试**：`tests/progress-visibility.test.ts` 四用例锁定语义——快照持久化 / narration 阶段浅合并不丢已上报资产 / 可重试回队保留 outputJson / complete 全量覆盖终态。门禁：tsc ✓ / eslint ✓ / vitest **108/108**（104 基线 + 4）。

**对 Gate 7 的影响**：被试在生成阶段持续看到镜头画面逐格长出（图片先到、AI 视频后补齐），等待焦虑显著下降；UX 原则五（每步可见）在 native 长生成时段首次完整成立。评估标准零修改。

### 0.5.12 平台底座补全——作品删除（2026-10-08 01:40，产品负责人方向纠偏）

**背景（产品负责人原话）**：「你不能闷头一直在后台生成作品，平台底座功能都没搭建好，你搞那么多花里胡哨的作品干什么？」——方向纠偏为**底座优先**：平台该给用户提供「能创作、能保存、能管理、能分享」的完整闭环，作品由用户自己体验产出，我方零生成（§0.5.10 后已终止采样）。本轮环境重置后生产库为全新空库，平台以零历史作品状态交付。

**盘点（底座现状）**：已有——作品库首页（我的创作/探索双区）、创作全链（意图→故事→分镜→生成→版本→渲染）、重生成/修订/Remix API、模型 provider 设置页。硬缺口（代码级实证）——①**全站无 DELETE**：作品无法删除，不想要的作品只能堆积；②**发布无落地页**：publish API 存在但无公开访问页面；③无重命名等管理操作；④播放体验基于创作页复用，独立播放页缺失。

**本轮交付（缺口①，删除全链）**：
1. **API**：`DELETE /api/contents/:id`——`contentService.deleteContent`（Owner 硬删除）。DB 级联清全部关联（schema `onDelete: Cascade`：版本/配方/故事/分镜/资产行/任务/交互/溯源/发布/Remix 血缘）；在途 Job 由 worker「作品不存在」fail-fast 兜底（§0.5.9），不烧重试；
2. **文件回收**：`assetService.removeIfOrphaned`——存储为内容寻址全局去重（`(hash, kind)` 幂等），删作品级联 Asset 行后按存储 key 引用计数清理，仍被其他作品引用的文件不动；单文件清理失败不阻断删除；
3. **权限语义**：他人私有作品在可见性闸并归 `not_found`（防枚举探测）；公开作品非 Owner 删除 → `permission_denied`（403）；
4. **前端**：「我的创作」卡片新增删除入口（垃圾桶图标，红系 hover 反馈）→ 二次确认对话框（明示不可逆后果：画面/配音/版本历史/任务记录一并清理，公开作品同步下架）→ 乐观列表更新 + toast。

**测试**：`tests/content-delete.test.ts` 六用例——级联清空 / 文件随删回收 / 全局去重对偶面（引用中文件保留）/ 非 Owner 403 / 私有防探测 404 / 不存在 404。门禁：tsc ✓ / eslint ✓ / vitest **114/114**（108 基线 + 6）。HTTP 冒烟：DELETE 路由 404 语义正确，首页新 UI 编译 200。

**后续底座队列**（零模型 token，纯产品工程）：②发布分享落地页（`/w/:id` 公开播放页 + 分享链接）→ ③作品重命名 → ④独立播放体验。评估标准零修改；本轮为产品功能新增，依据产品负责人 2026-10-08 方向纠偏指令（底座优先于一切生成侧工作）。

### 0.5.13 发布分享落地页 /w/:id + 端到端全链实证（2026-10-08 02:20，产品负责人授权 E2E）

**背景（产品负责人指令）**：「你可以生成作品，但那只是为了端到端验证开发的功能是否真实可用」——据此执行一次 E2E 验证性生成（平台日常零采样不变）。

**缺口实证**：publish API 与 Publication 模型俱在，但发布后没有任何公开落地页——作品发出去没有链接可看、可转发。分享是底座「能创作、能保存、能管理、能分享」的关键一环。

**交付**：
1. **`src/core/content/share-view.ts`**：分享页读模型 `getShareView`——访问语义与可见性闸同源（public/unlisted 任何访客；private 仅作者；陌生人碰未发布一律 not_found 防御性二道闸；作者预览态 isPreview）；
2. **`/w/:id` 服务端组件页**：9:16 播放器（poster 兜底/占位态）+ 作品信息 + AI 参与与生成模式诚实标签 + Remix 血缘 + unlisted 徽章 + generateMetadata（SEO）；无效链接**真实 404 状态码**（not-found.tsx 平台风格）；
3. **入口接线**：创作页已发布态「复制分享链接」；首页探索播放弹窗「去作品分享页看看」；分享页 ShareActions（Remix + 复制链接，匿名访客自动建会话）。

**E2E 实证（scripts/m15/e2e-share-driver.mjs，真实用户公共 API 全链）**：表达→意图→方向（3 选 1）→故事→分镜（5 镜）→AI 生成→渲染成片（37.6 秒 / 3.5MB mp4）→发布→**匿名访客分享页 200**（播放器/标题/Remix 入口齐全）→资产伺服 200（video/mp4）→探索列表收录→删除→分享页善后 404。✅ 全链通过，验证后平台零残留（contents=0/assets=0/文件=0）。同场附带实证：①黑盒修复真实生效（生成中进度载荷逐镜携带 shotAssets：2 分钟时点 3/5 图已到）；②native 逐镜回落兜底生效（agnes 视频队列满，5 镜全部回落合成，诚实标签为 composition——R1 延续的预期行为）；③删除链二验（遗留作品经 API 删除成功）。

**新发现并修复——测试存储隔离缺口**：E2E 收尾巡检发现生产 `storage/assets/` 残留 27 字节 PNG，取证=02:00:44 vitest 跑批时段产物：DB 隔离了（test.db）但 `diskStorage` 根目录未隔离，测试写真实文件漏进生产存储。修复：vitest env `IMAGINEOS_STORAGE_DIR=storage-test` + global-setup 每轮清空；复跑 120/120 实证生产目录 0 文件。

**门禁**：tsc ✓ / eslint ✓ / vitest **120/120**（+6 share-visibility）。**遗留**：作品重命名（底座③）、独立播放页（底座④）。
