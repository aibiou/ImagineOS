# 持续复现好作品：质量门 + 复现资产 + 全 Native 供给（设计方案）

> 状态：Accepted（产品负责人已授权推进「继续优化产品级」，本设计为先设计后动手的落地稿）
> 范围：编剧层/一致性层之上的「画面质感层」与「经验复利层」首期建设；取缔 Ken Burns 自动回落。
> 供给事实（不改动模型配置）：agnes-com 三通道（llm agnes-3.0-flash / image agnes-image-2.5-flash / video agnes-video-2.5-flash，视频免费档 RPM=1）+ ant-ling Ling-3.1-flash（免费优先）+ 内置 z-ai 兜底链。

## 0. 问题定义

四层能力模型审计结论：编剧层（story.ts，Zod 硬校验）与一致性层（shot-prompt.ts 纯函数注入）已经可复现；缺口在下两层：

| 层 | 现状 | 缺口 |
|---|---|---|
| 画面质感层 | 靠抽卡：单次生成直接入库，好坏全凭运气 | 无 in-loop 质量门，坏镜头一路带进成片 |
| 经验复利层 | 不存在：生成参数未全量落盘，好镜头无沉淀 | 无范例库、无跨镜参考，复现全靠重抽 |

供给约束带来的第二问题：native 视频失败时逐镜静默回落 Ken Burns 合成（`pipeline-executor.ts` catch → composition），用户看到的是「以为有 AI 视频、实则幻灯片」。产品负责人明令：**取缔 Ken Burns 回落**。

## 1. 总体设计

三个互相咬合的机制，共同回答「能不能持续复现好作品」：

```
镜头图像生成 ──→ ① 质量门（VLM 快审） ──合格──→ 落库 + ③ 范例沉淀
                     │ 不合格（预算内）              │
                     ↓ 变体重试（择优 = 有界 best-of-N）│
                （最多 2 次重抽）                    ↓
native 视频生成 ──→ ② 视频抽帧快审 ──→ ④ 节奏化提交（RPM=1 间隔保证）
                     │ 严格缺陷（水印/损坏）→ 1 次重试 → 仍败 → 诚实失败 + 断点续跑
                     （Ken Burns 回落路径：删除）
```

- ①② 解决「单镜合格率」（画面质感层）；
- ③④ 解决「复现与供给」（经验复利层 + 诚实供给）。

## 2. P0 质量门（in-loop VLM 快审）

### 2.1 新能力：vision.review

- `types.ts` 新增 capability `vision.review`：`VisionReviewPayload { system, user, images: Array<{ base64, mime }> }` → `VisionReviewResult { text, repro? }`。
- 新 provider `src/ai/providers/zai-vision.ts`：`zai.chat.completions.createVision`（多模态 content：image_url(data URI) + text），`thinking: disabled`。链上仅 zai-vision（自定义 provider 暂无视觉模型；架构位留好，未来 agnes 出 VLM 即插）。
- 路由器新增 `router.vision()`，与 text/image/tts/video 同一套重试/记账/冷却语义；每次调用自动落 Generation（type=vision.review）。

### 2.2 门逻辑（`src/core/quality/shot-gate.ts`，纯函数 + 编排）

- **评审输入**：待审图像 + 镜头上下文（场景锚点/人物视觉锚点/景别/lookBook，由 shot-prompt 同源纯函数组装）+ **参考帧**（同片最近一个已通过质检的镜头图——来自当前 Job 已审镜头或 ShotExemplar 库）。
- **评审输出（Zod 硬校验）**：`{ pass, scores: { character, scene, style, technical } (0-10), watermark: boolean, issues: string[], summary }`。解析失败 → 记「评审无效」并放行（质量门是增强件不是单点故障，可用性优先），但 Generation 留痕。
- **综合分**：character 0.30 + scene 0.25 + style 0.25 + technical 0.20；watermark=true 一票否决。
- **重试策略**：`!pass` 且重抽次数 < 2 → 以「问题清单 + 换构图/光影」构造变体 prompt 重抽；**择优保留**（各次尝试取综合分最高者入库，即有界 best-of-3）。
- **豁免通道**：`IMAGINEOS_IMAGE_GATE=0` 关闭门（评估对照用）；VLM 不可用自动降级为 skipped（诚实标注，不冒充通过）。
- **留痕**：每镜一条 Provenance 事件（model=quality-gate，payload={ shotIndex, attempts, finalScore, pass, issues }）；Job 进度载荷 shotAssets 每镜带 `gate: { score, pass, attempts }`——前端 REVIEW/进度缩略图上显示「质检 ✓ 8.4」徽章（诚实可见）。

### 2.3 视频抽帧快审（严格门 + 建议性评分）

- native 视频下载后、入库前：`ffmpeg -ss <中点> -frames:v 1` 抽中点帧（临时目录），连同首帧图送 VLM。
- **严格失败**（水印高置信/黑帧冻结/严重破损）→ 1 次重试（仍走节奏化提交）；再失败 → 按视频生成失败处理（诚实失败路径，绝不回落 Ken Burns）。
- **软性指标**（运动质量/动态感）只记录不拦截。
- 豁免：`IMAGINEOS_VIDEO_GATE=0`。

## 3. 取缔 Ken Burns：全 Native 供给设计（RPM=1 正面解法）

### 3.1 删除静默回落

`pipeline-executor.ts` 中 native 失败 → composition 的 try/catch 回落整段删除。失败语义改为：**镜头级异常上抛 → Job 可重试失败 → 断点续跑**。`IMAGINEOS_FORCE_COMPOSITION=1` 保留为运维逃生阀（显式全合成模式，不是自动回落）；hybrid 模式仅保留给配方显式 per-shot motion 的合法混合。

### 3.2 节奏化提交（pacing，根治 429）

根因：RPM=1 下相邻两次视频提交间隔可能 < 60s（前序视频 45s 完成即提交后序）→ 429 → 60s 冷却 × 3 次重试仍可能耗尽 → 回落。现行 `serializeVideoCall` 只保证互斥，不保证提交间隔。

设计：`createPacedVideoScheduler({ minGapMs })` —— 串行化之内再加**提交间隔下限**（默认 61s，`IMAGINEOS_VIDEO_SUBMIT_GAP_MS` 可调）：每次进入视频调用前等待 `nextAllowedSubmitAt`，调用即置 `nextAllowedSubmitAt = now + minGapMs`。提交节奏与 RPM 窗口对齐后，429 从「常态」变「意外」（router 内既有冷却重试继续兜底）。

代价核算（诚实）：5 镜 native ≈ 4×61s 间隔 + 末镜出片 ≈ 5-6 分钟——这是 RPM=1 的物理下限，进度叙事如实告知（「AI 视频供给限速，正在排队逐镜生成」）。

### 3.3 断点续跑（resume）

Job 失败重入队/用户点重试后，`executeStoryboardJob` 从自身 `outputJson`（reportProgress 持久化的 shotAssets）恢复：

- 该镜已有 `imageAssetId` 且 `gate.pass`：跳过图像与质检，直接复用（读回资产文件 base64 作视频首帧）；
- 该镜已有 `videoAssetId`：整镜跳过（图像+视频+TTS 均不重烧）；
- 仅图无视频（上次断在视频）：只补视频；
- 资产文件丢失（被清理）：该镜重生成（内容寻址 hash 去重防重复入库）。

效果：供给中断/瞬时失败的重试成本从「整片重烧」降为「只补缺口」。

## 4. P1 复现资产（Generation 全参数 + 范例库）

### 4.1 Generation repro 字段（seed 位的诚实设计）

agnes/zai 均不返回 seed——**落盘一切可复现参数，seed 位预留**：

- `ImageShotResult`/`VideoShotResult` 增加可选 `repro?: Record<string, unknown>`（agnes 视频：video_id + seconds/aspect_ratio 提交参数；zai 视频：task id；未来任何返回 seed 的 provider 填同一位）；
- router 记账时 `outputJson` 写入 `repro`；`inputSummary` 增加 `promptHash`（全量 prompt 的 sha256 前 16 位）与视频 `firstFrameHash`——复现匹配从「截断文本比对」升级为「哈希精确匹配」。

### 4.2 ShotExemplar 范例库（新表）

```
ShotExemplar { contentId, assetId, shotIndex, promptHash, promptJson(完整 imagePrompt + 锚点快照), scoreJson(质检评分), createdAt }
```

- **入库**：终选综合分 ≥ 8.0 的镜头自动沉淀（幂等：同 content+shotIndex 取最高分覆盖）；
- **消费**：质量门的参考帧（同片内跨镜一致性比对——「与参考帧里的人物/影调是否一致」）；未来跨项目风格 few-shot 的数据地基；
- **复现路径**：promptHash + promptJson 让「这条好镜头是怎么写出来的」完整可回放（配合 repro 字段重放生成请求）。

## 5. 验收标准（预注册，不因结果好而放宽）

1. **单测**：门纯函数（评分/择优/变体 prompt/解析容错）、节奏器（间隔保证/失败传播）、resume（跳过已完成/只补视频/资产丢失重生）、范例库（阈值/幂等/参考帧查询）——新增 ≥ 20 例，全量回归全绿，tsc/eslint 零错。
2. **账本断言**：E2E 全 native 成片，Provenance 出现 mode.decision(native) 且**零** video.shot.fallback 事件；每镜 quality-gate 事件在案；Generation 含 promptHash/repro。
3. **合格率度量**：`scripts/m15/gate-metrics.mjs` 输出单镜一次通过率 / 重抽分布 / 平均综合分——作为后续迭代的基线数字。
4. **诚实性**：质量门跳过必标注 skipped（不冒充通过）；RPM 排队等待在进度文案中如实呈现。

## 6. 实施清单

| # | 文件 | 动作 |
|---|---|---|
| 1 | `src/ai/router/types.ts` | + vision.review 能力与 Payload/Result/Provider 类型；结果类型 + repro |
| 2 | `src/ai/providers/zai-vision.ts` | 新建（createVision 封装） |
| 3 | `src/ai/router/registry.ts` | vision 链 + router.vision() + promptSummaryOf 扩展（promptHash/firstFrameHash） |
| 4 | `src/ai/providers/openai-compat.ts` / `zai-video.ts` | 结果携带 repro（video_id / task id） |
| 5 | `src/core/quality/shot-gate.ts` | 新建：评审 prompt 组装 / Zod verdict / 评分 / 择优 / 变体 prompt（纯函数核心） |
| 6 | `src/core/quality/exemplar-service.ts` | 新建：ShotExemplar 读写 + 参考帧解析 |
| 7 | `prisma/schema.prisma` | + ShotExemplar 表（content 级联删除） |
| 8 | `workers/pipeline-executor.ts` | 图像门集成 / 节奏化视频调度 / 删 Ken Burns 回落 / resume / 视频抽帧门 / 进度载荷 gate 字段 |
| 9 | `src/media/ffmpeg.ts`（或同目录新文件） | + extractMidFrame |
| 10 | `src/app/api/.../creation/route.ts` + `create/[id]/page.tsx` | shots 载荷带 gate 摘要；缩略图/预览质检徽章 |
| 11 | `tests/` | shot-quality-gate / video-pacing / storyboard-resume / exemplar 四组新测试 |
| 12 | `scripts/m15/gate-metrics.mjs` | 合格率度量脚本 |

## 7. 边界与后续（本轮不做）

- 跨项目风格 few-shot（ShotExemplar 数据积累后的第二步）；图像 seed 重放（等 provider 暴露）；Best-of-N 全量化（本轮门内择优已是有界 best-of-3）；agnes-cn 双站视频轮转（等用户配置后再谈 gap 减半）。
