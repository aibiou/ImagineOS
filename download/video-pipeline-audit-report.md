# ImagineOS Video Pipeline Audit（只读审计，2026-10-07）

> 审计对象：用户创作 `cmuw6r7kl014pktgk91ipxxp9` 产物为 composition 而非 native AI video 的完整路径归因。
> 审计纪律：零代码改动、零数据写入；全部证据来自源码阅读 + `scripts/m15/audit-video-pipeline.mjs`（只读 DB 取证）+ 运行中进程环境实测。
> 证据等级：源码行号 / DB 行级记录 / 进程环境 / 文档原文，四类均可复现。

---

## 当前架构

### 1. 双路径设计（ADR-0001，M1.5 Gate 6 修订版）

```
                      ┌─────────────────────────────────────────────────────┐
                      │  Job: video.storyboard（生成阶段唯一 Job 类型）        │
                      │                                                     │
  逐镜头 loop ──────▶ │  ① router.image  → 首帧图像（必走）                  │
                      │  ② motionModeFor(shot) === 'native'                  │
                      │     && hasVideoShotProvider() ？                     │
                      │       ├─ 是 → router.video（图生视频）                │
                      │       │    ├─ 成功 → videoAssetId 入 shotAssets      │
                      │       │    └─ 失败 → Ken Burns 回落                  │
                      │       │           + Provenance native-fallback       │
                      │       └─ 否 → 仅图像（组合式镜头）                    │
                      │  ③ router.tts → 旁白（有 narrationLine 才走）        │
                      └─────────────────────────────────────────────────────┘
                      ┌─────────────────────────────────────────────────────┐
                      │  Job: video.render（合成阶段）                        │
                      │  FFmpeg composeVideo：                                │
                      │    videoAssetId 镜头 → 原生视频段直接入合成           │
                      │    其余镜头 → 图像 + Ken Burns + xfade 转场          │
                      └─────────────────────────────────────────────────────┘
```

### 2. 模式分岔点：全系统仅一处

`workers/pipeline-executor.ts:67-70`：

```ts
function motionModeFor(shot: ShotSnapshot): 'composition' | 'native' {
  if (process.env.IMAGINEOS_FORCE_NATIVE === '1') return 'native'
  return shot.motion ?? 'composition'   // ← 默认 composition
}
```

native 的开启条件（满足其一）：

| # | 途径 | 当前状态 | 证据 |
|---|------|---------|------|
| 1 | 环境变量 `IMAGINEOS_FORCE_NATIVE=1`（服务器启动时注入，唯一设置脚本 `restart-dev.sh native`） | **空**（运行中 dev server 进程 PID 16381/16396 实测 `IMAGINEOS_FORCE_NATIVE=` 空） | /proc/16381/environ |
| 2 | 配方字段 `shot.motion = 'native'`（schemas.ts:63 定义） | **死字段——全系统零写入点**：plan-service.ts:163-166 仅写 cameraMotion/durationMs/narrationLine/emotion；story.ts LLM 输出 schema 无 motion 字段；无任何 API 接受该字段 | grep 全 src/ `motion\s*[:=]` 零业务写入 |

### 3. Provider 层（video.shot 能力链，功能完备）

`src/ai/router/registry.ts:41` + DB `ModelProviderConfig`：

| 优先级 | Provider | 模型 | 状态 |
|--------|----------|------|------|
| 10 | `openai-compat:agnes-com` | agnes-video-2.5-flash | **ENABLED**（但 lastTest=untested） |
| 兜底 | `zai-video`（内置） | cogvideox-3 | 恒在链尾 |

`hasVideoShotProvider()` 恒为 true；`router.video()` 调度/重试/记账逻辑齐全（能力级超时 330s、3 次指数退避、失败记 Generation 表）。

### 4. Job 类型体系（DB 全库实测）

| type | 数量 | 说明 |
|------|------|------|
| video.storyboard | 43 | **生成阶段唯一 Job 类型**——native 与否是 Job 内部逐镜头选择，不是 Job 级别 |
| video.render | 29 | FFmpeg 合成 |

**结论：`job.type = video.storyboard` 本身不构成「composition 证据」——所有生成都创建这个类型。真正的证据在 shotAssets 是否携带 videoAssetId。**

---

## 实际运行路径

### 该用户创作的完整链路（cmuw6r7kl014pktgk91ipxxp9）

```
用户输入（Remix 衍生，10-06 04:35）
  → Intent：Remix 继承（intent engine 未重新解析——plan 为继承，无需生成）
  → Planning：配方 v2 密封（5 镜头，motion 字段全部 undefined——无写入点）
  → Generation Decision：generationFlow.startStoryboardGeneration / regenerate
      （generation-flow.ts:111/158/189 硬编码 type: 'video.storyboard'，
        入队参数不含任何模式字段）
  → Video Mode Selection：worker executeStoryboardJob 逐镜头 motionModeFor(shot)
      ├─ IMAGINEOS_FORCE_NATIVE ≠ '1'（进程环境实测为空）
      └─ shot.motion = undefined（配方无此值）
      ⇒ 全部 5 镜头判定 'composition' —— native 分支从未进入
  → Provider Router：router.image × 5（zai-image/agnes）+ router.tts × 5
      【router.video 调用次数 = 0】
  → Job Creation：Job cmuxhadr1…（10-07 02:18 重试成功）
  → Asset Finalize：5 PNG + 5 WAV，shotAssets=5，videoAssetId 计数=0
  → video.render：FFmpeg Ken Burns + xfade → MP4（纯组合式成片）
```

### DB 行级物证（audit-video-pipeline.mjs 输出）

| 证据 | 值 | 排除了什么 |
|------|-----|-----------|
| 成功 Job shotAssets | 5 镜，videoAssetId=0 | 排除「部分 native」 |
| 全库 video.shot Generation 记账 28 条 | **无一条属于该 contentId**（15 失败 agnes + 12 失败 zai + 1 成功 zai，全部来自 Native Golden 评估内容 cmux6az7 等） | 排除「native 被尝试过」（含失败） |
| Provenance native-fallback 事件 4 条 | 全部在 cmux6az7（Native Golden），零条在本创作 | 排除「native 失败回落」（状态 B） |
| 配方两个版本 motion 值 | `[undefined × 5]` × 2 | 排除「配方要求过 native」 |
| 运行中进程环境 | `IMAGINEOS_FORCE_NATIVE=`（空） | 排除「环境强制关闭的偶然」——这是既定默认 |

### 三态判定

**C——默认直接 composition。** 非 A（native 成功）：零 videoAssetId。非 B（native 失败回落）：零 video.shot 调用、零 native-fallback 事件——native 分支根本未被进入，连失败的机会都没有。

---

## 与产品目标差异

### 产品文档立场（一致性检查结果）

| 文档 | 表述 | 与代码一致性 |
|------|------|-------------|
| ADR-0001 | 「组合式管线优先（方案 B，产品负责人确认）」；Gate 6 修订补 native 并行路径；「调度策略在 M2 按用户分层再定」 | ✅ 完全一致——默认 composition 是**成文决策**，非实现偏差 |
| m15-final-package Q3 | 「Native Video 升主线？**不升主线，并行深化**（预注册标准裁决：1/5 镜成功未达线）」 | ✅ 一致 |
| m15-final-package L1 | 「组合式成片为静态画面+运镜+转场，不是真运动」 | ✅ 限制已诚实记录 |
| human-test-plan §10 | 「运动路径决定：默认 composition；如需 native 样本 → restart-dev.sh native」 | ✅ 一致——Gate 7 Pre-flight 的显式决定 |
| human-test-report §0.5.6 | 三态判定 C 的取证记录 | ✅ 一致 |
| product-north-star | 「我们探索的不是『AI 生成视频』，而是……」 | ✅ 产品定位本身不以 AI 视频模型为核心卖点 |
| **仓库根 README.md** | **不存在**（仅 docs/README.md，且未解释双路径策略） | ⚠️ 缺口——新用户/协作者无从得知双路径设计 |
| UI 生成模式徽章（gate7-incident-002 上线） | 组合成片/原生视频/混合三态标注 + 悬停说明 | ✅ 用户可见性已补 |

### 差异的本质

**代码行为与文档决策零偏差；偏差存在于「用户预期」与「产品现状」之间**：用户看到「AI 原生视频平台」的定位和能动的成片，预期是真 AI 视频模型产物；实际拿到的是 Ken Burns 组合式（L1 已记录的质量上限：YDIF≈1.0 vs 实拍 3–8）。这不是 bug，是 Alpha 阶段的**已知且有意的权衡**——但传递给用户的强度不足，徽章只是补丁式缓解。

---

## 风险

| # | 风险 | 等级 | 证据 |
|---|------|------|------|
| R1 | **Native 通道实际可用性远低于「已接入」的观感**：全库 video.shot 记账 28 次尝试仅 1 次成功（3.6%）；agnes-video 15 次全败（503 队列满）且 lastTest=untested；zai-video 12 败 1 成 | 高 | Generation 表 |
| R2 | **死字段陷阱**：`shot.motion` 有 schema 无写入点，未来开发者可能误以为配置它就生效 | 中 | schemas.ts:63 vs 零写入 |
| R3 | **组合式路径无路由决策日志**：mode=composition 时不产生任何「为什么是这个模式」的记录（观测性缺口，§0.5.6 已记录）——本次审计要靠零记账反推 | 中 | Provenance 表空 |
| R4 | **成本/延迟断崖**：native 3–5 倍成本与延迟（ADR-0001），若 M2 直接翻转默认而无分层调度，配额与体验双崩 | 中 | ADR |
| R5 | 用户预期落差是 Gate 7 真人测试的系统性混淆变量：被试可能把「画面不动」编码为「AI 能力差」，而非「产品形态选择」 | 高（对当前测试） | L1 + §0.5.6 |

---

## 最小修复方案（仅提案，未动代码）

**原则：不动评估标准、不动状态机、不改 ADR 决策。按代价从小到大排列：**

### 方案 0：零改动（维持现状）
现状是 ADR-0001 成文决策 + Gate 7 Pre-flight 既定配置。若 Gate 7 目标是度量组合式基线的表达成功率，则什么都不用改，R5 由徽章+观察员口径缓解。

### 方案 1：补根 README（文档级，最小代价）
新建仓库根 README.md，用三段话讲清：产品是什么 / 双路径架构（Native vs Composition）与当前默认 / 如何切换（restart-dev.sh native / motion 字段规划）。同时把 R2 死字段陷阱写进 ADR-0001 附录备注。

### 方案 2：路由决策日志（观测性，~15 行）
`executeStoryboardJob` 开头追加一条 Provenance 事件 `{ stage: 'mode.decision', mode, reason, forceNative: bool }`——补齐 R3 缺口，此后任何产物都能一查便知模式与原因，不再需要零记账反推。

### 方案 3：给死字段一个写入点（产品级，M2 入口）
在 plan/storyboard 密封时按策略写 `shot.motion`（来源可以是：创作页用户开关 / 分层调度默认 / provider 健康度动态降级）。这是 ADR-0001 预留的正规钩子，也是「native 可用但默认关」走向「按需 native」的唯一无破坏路径。**建议纳入 M2 决策输入，Gate 7 前不动。**

### 前置动作（无论选哪个方案）
Gate 7 若需 native 样本：先跑 `probe-channels-now.mjs` 探测 agnes-video 队列健康（R1 显示其历史可用性差），确认通道可用再 `restart-dev.sh native`，并在 human-test-report §1 记录配置切换。

---

## 附录：取证工具与证据清单

- 源码：pipeline-executor.ts / generation-flow.ts / registry.ts / plan-service.ts / schemas.ts / generation-log.ts / restart-dev.sh
- DB（只读）：GenerationJob（43+29）/ Generation（video.shot×28）/ Provenance（native-fallback×4）/ ModelProviderConfig（video 通道）/ ContentVersion（该创作两版本配方）
- 进程：/proc/16381、/proc/16396 环境（IMAGINEOS_FORCE_NATIVE 空）
- 文档：ADR-0001 / m15-final-package（Q3、L1-L2、Provider Matrix）/ human-test-plan §10 / m15-human-test-report §0.5.5-0.5.6 / product-north-star
- 取证脚本：scripts/m15/audit-video-pipeline.mjs（本次新增，只读，可重跑复现全部 DB 证据）
