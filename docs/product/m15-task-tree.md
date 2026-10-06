# M1.5 Task Tree & Execution Plan — Expression Quality Gate

> 文档地位：M1.5 里程碑的任务树与执行计划 · GitHub 主事实源
> 定稿：2026-10-06 · 状态：执行中（约 60%）

## 0. 定位与纪律

M1.5 不是功能里程碑，是**质量闸门**。目的：验证 ImagineOS 是否真的让"人的表达"变成了有价值的视觉作品。

- 不推翻 M1 任何结构（增量修复可以：P2028 事务超时、GENERATING 失败恢复入口、语言字典更新）
- 不进入 M2 Social 开发（粉丝/评论/Feed/商业化/收益全部暂缓）
- 完成后提交 Expression Quality Report，等待产品方向确认，才决定 M2 范围

## 1. 七道闸门（Gate）

| Gate | 验证内容 | 手段 | 交付物 |
|------|----------|------|--------|
| G1 真实内容质量 | 10 类型真实创作（人物/家庭/旅行/知识/情绪/梦境/未来/科幻/产品/公益） | `scripts/m15/run-cases.mjs`（HTTP 全链真实驱动，断点续跑） | 10 案例数据（Intent/Plan/Path/Asset/Latency/Cost/Revision/Result） |
| G2 内容范式 | A 写实 ×4 / B 电影故事 ×3 / C 强想象 ×3 | 同上（案例配额设计） | 范式覆盖结论 |
| G3 修订质量 | 父亲故事 + 4 连改（再温暖一点/父亲不要说话/第二镜换童年/结尾不煽情） | `scripts/m15/run-revision-chain.mjs` | Revision Evaluation（理解/局部性/新版本/旧版保留/原因追踪） |
| G4 Remix 质量 | 原作→Remix（换母亲保持风格）→再修改 | `scripts/m15/run-remix-chain.mjs` | Remix Evaluation（零改动/新作/血缘/Intent 继承/可续改/Graph） |
| G5 Content Object 完整性 | 六表数据库级关系检查（非 UI） | `scripts/m15/integrity-check.mjs` | Content Integrity Report |
| G6 视觉质量 | "真视频体验"还是"静态画面+音轨+转场"；不足则建 Native 路径 | `scripts/m15/visual-quality.mjs`（YDIF 帧间差分/freezedetect/抽帧）+ 双路径对比 | Visual Quality Report |
| G7 真人测试 | 10–20 人，不教 Prompt，只说"告诉 ImagineOS 一件你想表达的东西" | `docs/evaluations/human-test-plan.md` | Human Test Plan（执行后出 Report） |

## 2. 工程任务（含已发现的缺陷修复）

| Task | 内容 | 状态 |
|------|------|------|
| T1 | 驱动库（cookie 会话 + 全链 + 轮询 + 断点续跑 + 指标采集） | ✅ `scripts/m15/lib.mjs` |
| T2 | 10 案例定义与跑批（并发 2） | ✅ 9/10 发布（p10 收尾中） |
| T3 | P2028 修复：8 处 `$transaction` 统一 30s 超时（SQLite 并发写锁） | ✅ |
| T4 | GENERATING 失败恢复入口（regenerate 接受失败态重入） | ✅（429 重试耗尽场景实测） |
| T5 | `video.shot` 能力 + zai-video Provider（cogvideox-3 图生视频） | ✅ 真实出片 56s/镜 |
| T6 | 合成器双路径（ComposeShotInput.videoPath 分叉，下游复用） | ✅ |
| T7 | 管线调度（motion 字段 + IMAGINEOS_FORCE_NATIVE）+ 失败回落 | ✅ |
| T8 | ADR-0001 Rev.2（双路径决策记录） | ✅ |
| T9 | video.shot 路由测试（fake provider，4 用例） | ✅ 4/4 |
| T10 | Human Test Plan | ✅ |
| T11 | UX 语言扫描（工程术语残留） | ✅ 干净；Remix 文案按新规则更新中 |
| T12 | 完整性/视觉质量/指标采集脚本 | ✅（终版数据待全部案例完成后重跑） |
| T13 | Native 对比样本（强制 native 跑 1 案例出对比成片） | ⏳ |
| T14 | Expression Quality Report（9 子报告 + 2 个关键问题回答） | ⏳ |

## 3. 执行顺序（剩余部分）

```text
p10 收尾 → G3 修订链 → G4 Remix 链 → G5 终版完整性
→ G6a 全量视觉度量 → G6b Native 对比样本 → 指标汇总
→ Expression Quality Report → 门禁全绿 → worklog + GitHub 推送
→ （人工阶段）G7 真人测试按 human-test-plan.md 执行
```

## 4. 完成标准（对用户的承诺清单）

1. 10 个真实创作案例 ✓（数据全量落 `scripts/m15/state/`）
2. Visual Quality Report
3. Revision Evaluation
4. Remix Evaluation
5. Content Integrity Report
6. Cost Report（Generation 记账归集）
7. Latency Report（分阶段 + 分能力延迟）
8. Human Test Plan（✓ 已交付，执行属人工阶段）
9. M1.5 Decision Report（含两个关键问题的回答）

最终回答：

> **ImagineOS 当前是否已经证明"普通人的表达可以被转化为有价值的视频作品"？**
> **下一阶段最大的瓶颈究竟是 AI 生成质量、Intent 理解、Revision、UX，还是内容传播？**

## 5. 明确不做

粉丝系统、评论系统、复杂 Feed 算法、商业化、创作者收益、大型社交图谱 UI、大规模 UI 重构、推翻 M1 数据模型。

## 6. M1.5 Status Snapshot（2026-10-06 收口时点；以真实实验为准，覆盖本文件早期状态）

> 数据源：DB 权威记账 + `scripts/m15/state/*` + git log。本节为准，早期 T1–T14 表格是过程记录。

### 6.1 Gate 完成度

| Gate | 状态 | 关键证据 |
|------|------|----------|
| G1 十案例 | ✅ 9/10 发布；p10 ⏸（Job failed 429，重入机制已闭环） | state/p01–p09 phase=published（A） |
| G2 三范式 | ✅ | 配方 style 分化传导至画面（A/B） |
| G3 修订链 | 🔶 机制 ✅（6 个 revision 版本在库）／四连改 ⏸ | `m15-revision-report.md` |
| G4 Remix 链 | 🔶 机制 ✅（8 条血缘全过）／专项链 ⏸ | `m15-remix-report.md` |
| G5 完整性 | ✅ 0 错 0 警（重置后复验仍绿） | `m15-content-integrity-report.md` |
| G6 视觉质量 | ✅ 组合式量化完成（证据分级 A/B/C）／Native Golden Case ⏸ | `m15-visual-quality-report.md` |
| G7 真人测试 | ✅ 计划 + 系统侧就绪（导出/批量完整性实测）+ 报告模板；执行属人工阶段 | `human-test-plan.md` + `m15-human-test-report.md` |

### 6.2 阻塞原因

- Provider 三通道（LLM/图像/TTS）429 长冷却（2026-10-06 当日 ~360 次调用触发），全部配额依赖项已就绪待恢复：`node scripts/m15/finish-m15.mjs` 一键补跑（含 failed Job 重入 + native 模式切换）；
- 2026-10-06 09:03 沙箱重置销毁重置前媒体文件（占位恢复）：结构完整性不受影响，历史度量数据为重置前真实采集（时间戳可证），native smoke 文件幸存且复测一致。

### 6.3 已验证 / 未验证

- **已验证（A 级）**：Intent 10/10 编译零失败；六不变量 DB 级全过；端到端延迟（干净窗 121–262s / 波动中位 409s）；成本画像（LLM 8.6 + 图 10.9 + TTS 9.1 / 案例）；Native 运动量 2.079（可复现）；UX 语言零工程术语（含 meta 描述，2 处边界已修）。
- **未验证（⏸/人工）**：四连改定位精度；Remix 换母亲语义修改；p10 发布；Native 全案例质量；真人六指标。

### 6.4 当前核心指标

| 指标 | 值 | 等级 |
|------|-----|------|
| Intent 编译成功率 | 10/10 | A |
| 组合式 YDIF（镜头内均值） | ≈1.0（p04=0.907） | B/C |
| Native YDIF | 2.079 | A |
| 端到端（干净/波动中位） | 121–262s / 409s | A |
| 完整性 | 0 错 0 警 | A |
| Expression Success Rate | **未度量**（Gate 7 真人测试） | 人工 |

### 6.5 M2 前置条件（进入 M2 需全部满足）

1. G3/G4/p10/Native Golden Case 补跑完成且报告更新（配额恢复后 ~40 分钟机器时间）；
2. Gate 7 真人测试 ≥10 人执行完毕，Expression Success 与「我还想做一个」行为率出数；
3. 完整性持续绿（已满足）；
4. 无 P0 缺陷（已满足）。

详见 `docs/evaluations/m15-decision-report.md`（Q1–Q7）。
