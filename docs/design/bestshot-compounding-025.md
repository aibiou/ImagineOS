# 设计文档：经验复利层（bestshot-compounding-025）

> 状态：Approved（延续产品负责人 2026-10-09「持续复现好作品」指令与「设计好再动手」纪律；本文件为 024 设计 §10「下一轮候选」的落地设计）
> 范围：BestShot 范例库（正向复利）+ 缺陷记忆（负向复利）+ 限速冷却递增（患性调度效率）。
> 不做：剧集化 Series Bible（独立 Epic）、供给付费升级（产品决策）、seed 锁定（供给侧 API 不支持）。

## 0. 一句话

024 闭环了「生成 → 评测 → 修正 → 记忆」，但记忆是**只写不读**的——账本攒下了每个镜头的分数与缺陷，却没有一条路径把这些经验喂回下一代生成。025 补上读回通道：**好镜头的提示词成为范例，反复出现的缺陷成为负面约束，系统从此对自己做过的好作品形成复利。**

## 1. 事实基础（024 已落地的数据地基，非推测）

- Provenance `quality.gate` 事件已真实落盘（024 E2E：5 镜全评审，3 镜捕捉硬缺陷，通过镜 9 分）——每条含 `shotIndex/attempts/pass/advisory/score/issues`，且挂在 `contentId+versionId` 上。
- 版本配方（`ContentVersion.structureJson`）密封了每个镜头的 `imagePrompt` 与全片 `lookBook`——**高分镜头的「好提示词」已有权威存档**，范例库不需要新表，纯查询视图即可。
- 024 设计 §10 实测：agnes 免费档每轮仍烧「挂起 41s 才 429」×3 的死亡螺旋，~18% 轮时间浪费；冷却窗口固定 60s 不区分「偶发拥挤」与「连续硬墙」。

## 2. 能力栈视角（024 §2 的续表）

| 层 | 024 状态 | 025 升级 | 复现性贡献 |
|---|---|---|---|
| L5 记忆层 | 指纹账本（只写） | **读回**：BestShot few-shot + 缺陷记忆注入 | 第 N 部作品站在前 N-1 部的高分经验上 |
| L3 供给层 | 患性调度（固定 60s 冷却） | **冷却递增 + 死亡螺旋熔断** | 同预算内有效尝试次数↑，native 覆盖率↑ |

## 3. 机制一：BestShot 范例库（正向复利）

### 3.1 检索（`src/core/generation/best-shot.ts`，纯函数 + 查询服务）

- 数据源：Provenance（`eventType='ai_generated', model='quality-gate'`，最近 400 条）→ 解析为 `ShotReviewRecord`（防御性解析，脏行跳过）。
- 入选口径：`pass=true && !advisory && score≥8`；同 `versionId+shotIndex` 多次评审（regenerate 会重复评审）取最高分；按分数降序、时间降序排序，取前 3。
- 补全配方：对入选记录加载 `versionRepo.findById → parseStructure`，取全局第 `shotIndex` 镜的 `imagePrompt/visualDescription/shotSize` + 该片 `lookBook`（各截断防膨胀）。结构缺失/解析失败 → 跳过该条（范例缺席不影响主链路）。
- 零 schema 变更：Provenance payload + 版本配方两处既有数据即全部事实源。

### 3.2 注入（编剧层 few-shot——LLM 才吃 few-shot，扩散模型不吃）

- `generateStoryboard(..., opts?: { bestShots?, defectMemory? })`：在 user prompt 末尾追加 `bestShotFragment(examples)`——「工作室高分范例」明确标注**学写法质感、不照抄内容**。
- 调用点：`executeStoryboardPlanJob` 生成前 `loadCompoundingContext(db)` 一次，opts 透传。
- 落点选择理由：分镜 LLM 是唯一能被 few-shot 影响的环节（024 设计 §5 原话「分镜 prompt 组装时注入同风格 few-shot 参考」）；图像模型只吃最终 prompt 文本，无参考图通道。

## 4. 机制二：缺陷记忆（负向复利）

- 聚合：全部失败评审（`pass=false && !advisory`）的 issues 按频次统计，**出现 ≥2 次才算「复发性缺陷」**（一次性缺陷交给 024 的逐镜规避提示即可），取前 6 条。
- 双注入点：
  1. **编剧层**（`defectMemoryFragment`，中文）：进 storyboard user prompt——LLM 写 imagePrompt 时主动规避（如「招牌文字」类缺陷 → 不写含文字的招牌元素）。
  2. **执行层**（`learnedAvoidanceFragment`，英文）：`executeStoryboardJob` 逐镜图像 prompt 末尾追加——扩散模型直接吃到负面约束（与 024 的重试规避提示同款翻译映射，抽取为共享 `avoidanceClausesFor`）。只注入可翻译的缺陷类别，无映射的诚实跳过。
- 可用性铁律（延续 024）：`loadCompoundingContext` 任何失败 → 空上下文（`{examples:[], defectMemory:[]}`），**复利绝不阻断主链路**。

## 5. 机制三：限速冷却递增 + 死亡螺旋熔断（registry）

- **连续限速计数**（strikes，成功即清零）驱动两件事：
  1. 冷却窗口递增：`escalatedCooldownMs(base, strikes) = min(base×2^(strikes-1), 4×base)`（60s→120s→240s 封顶）——冷却map影响候选排序，硬墙通道在链尾坐更久；
  2. **末位候选熔断**：video.shot 末位候选首次限速仍等一个冷却窗（zai 在途任务 62–75s 实证有效）；**strikes≥2 的惯犯在冷却期内直接跳过本次调用**（不再烧「挂起 41s 才 429」），患性循环 70s 节奏接管重试。
- 不作弊式拉黑：冷却过期后照常尝试（探活节奏 ≈ 240s/次），成功即清零恢复声誉。
- 效果口径：zai 配额死窗口内，每轮患性循环从「烧 ~243s 于 agnes 挂起」降为「秒级上抛 + 70s 节奏」，480s 预算内有效尝试 zai 次数从 ~2 轮升至 ~6 轮。

## 6. 可观测性（账本互证，延续三层证据范式）

- 注入发生时落 Provenance `compounding.applied` 事件（`stage: 'storyboard.fewshot' | 'image.avoidance'`，含 exampleCount/memoryCount/fragment 长度）——「声称注入了经验」与「实际注入」账本互证。
- E2E 断言口径：storyboard.plan Job 的 `text.plan` Generation 行 `inputJson.prompt` 含「工作室高分范例」字样（promptSummaryOf 截断 4000 字内可见）——复利闭环的直接证据。

## 7. 测试与验收

- 单测（`tests/bestshot-compounding-025.test.ts`，零触网）：解析防御性 / 入选口径与去重 / 片段组装含分数与截断 / 缺陷频次≥2 过滤 / 可翻译映射 / loadCompoundingContext DB 联查（含脏行与缺版本容错）/ generateStoryboard 注入存在性（fake provider 捕获 user prompt）/ 冷却递增纯函数 / 熔断守卫（cooldown env 调小，provider 调用计数断言）/ 成功清零。
- 门禁：vitest 全绿（024 后 211 → 目标 220+）/ tsc 0 错误 / eslint 0 错误。
- 真实管线 E2E：新作品的 storyboard.plan Job 实际吃到 024 遗留的真实高分评审数据（库里已有 quality.gate 事件）→ Generation 账本含范例字样；图像生成阶段 learnedAvoidance 注入。供给若仍处 429 死窗，以「复利闭环已证 + 供给诚实收口」结案（024 同款纪律）。

## 8. 风险与边界（诚实清单）

- **跨作品经验共享**：Alpha 单工作室口径下，范例是「提示词写法」层面的craft参考，不含用户故事文本本身；多租户正式期需按 workspace 隔离范例池（已知边界，非本轮）。
- 范例画像单一风险：早期范例集中在少数作品（种子数据/实测内容），选择器按分数排序天然如此；后续可加风格分桶，本轮不做（防范围失控）。
- 缺陷记忆的翻译映射目前覆盖 5 类（文字水印/畸形/人物/场景/风格），映射外缺陷只在编剧层提示，执行层诚实跳过。
- VLM 评分本身有方差：score≥8 门槛 + pass 双条件 + 惯犯缺陷需 ≥2 次，三重防抖；单条低分误判不会污染范例库。

## 9. E2E 实测纪要（2026-10-09，真实供给全程，断点续跑）

- **供给实况（比 024 更冷）**：zai 全家（VLM/video/TTS）当日配额死（429 秒拒，独立探测复核）；agnes LLM/image 可用、视频免费档硬墙不变；ant-ling 大 prompt 90s×3 超时后 agnes-3.0-flash 接住。
- **写通道实证**：内容 A（旧书店故事，4 镜）真实生成 → 16 条 quality.gate 事件落库——今日全部 advisory（VLM 缺席的正确缺席，非乱给分：advisoryHonest 断言）。
- **负对照实证**：内容 B（空库状态）分镜 prompt 零注入、零 compounding 事件——复利缺席不虚构（向后兼容 + 诚实空行为）。
- **读通道实证（诚实降级）**：真实 VLM 配额死 → 用 A 的真实 imagePrompt/lookBook + 显式 `e2eFixture` 标注分数铺库，内容 C（馄饨摊故事）走生产 storyboard.plan 链路：text.plan 账本 prompt 2720 字含「工作室高分范例」（A 的真实提示词原文命中）+「历史高频缺陷规避清单」；Provenance `compounding.applied` 事件 `{exampleCount:2, exampleScores:[9,8], memoryCount:1, memoryIssues:["画面出现文字或水印×2"]}`。报告如实披露：分数是夹具、提示词与链路是真实产物。
- **死亡螺旋熔断实证**：A 的生成 Job 因 TTS 429 重试 4 次执行（每次 ~20 轮患性循环，共 ~80 轮）——agnes 仅 10 次真实调用（624s 挂起）/zai 9 次（0.8s），即**每执行 ≤3 次**；旧行为每轮 3 次挂起调用（~60 次/执行）。轮间由患性 70s 节奏接管，预算内有效尝试 zai 次数大幅上升。
- **意外发现（真实缺陷，登记下轮候选）**：可重试失败在供给死窗口下整 Job 重跑——每次重试重新烧图像 + VLM 配额（资产 hash 去重只省存储不省调用）。供给韧性需「重试只补缺口」的续跑语义扩展到可重试路径（当前 video.resume 只覆盖终态失败路径）。
- **E2E 环境口径**：`IMAGINEOS_VIDEO_SHOT_BUDGET_MS=300000` 显式调小控总时长（患性语义由 227 条单测锁定，E2E 聚焦复利与熔断的真实供给形态——诚实记录）。
- 断言 5/5：seedWrite / advisoryHonest / compoundRead / ledgerEvent / breaker 全过；清场后平台回到用户 7 件 IDEA 内容，库零残留。
