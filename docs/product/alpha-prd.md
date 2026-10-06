# ImagineOS Alpha PRD

> 文档地位：Alpha 阶段产品需求定义 · GitHub 主事实源
> 源文件：`docs/product/development-task-tree.md`（Epic E0–E15 全量任务树）、`docs/product/m0-review-m1-direction.md`（M0 评审）
> 定稿：2026-10-06

## 1. Alpha 要验证的唯一命题

> **一个普通人，只通过自然语言，能否把一个真实想表达的东西，转化成一个自己认可的视觉作品。**

唯一 KPI：**Expression Success Rate**。不验证：规模、留存、商业化、社交。

## 2. 集成验收链路（§63 自行车故事）

```text
"我想做一个45秒的视频，记录我小时候和父亲一起骑自行车。"
→ Intent（理解） → Creative Direction（3 个方向）→ 用户选择
→ Story → Scene → Shot（分镜）
→ AI Generation（画面 + 旁白）→ Preview
→ "再温暖一点。" → Version 2（旧版本保留）→ 用户满意 → Publish
→ 其他用户 Remix → 新作品 → 新用户继续修改
```

M1 状态：**全链已真实跑通**（无一处 mock）。M1.5 正在对该链路做 7 道质量闸门验证。

## 3. 用户与场景

- 用户：**普通人**——不会剪辑、不懂 Prompt、没有专业设备的表达者
- 主场景：竖屏 9:16 短视频（30–60 秒），手机优先
- 典型表达类型（M1.5 Gate 1 测试集）：人物故事、家庭回忆、旅行、知识、情绪、梦境、未来想象、科幻、产品介绍、公益

## 4. 功能范围（Alpha = M0–M2 候选）

### 已交付（M0+M1）

| 能力 | 说明 |
|------|------|
| 意图理解 | 自然语言 → 结构化 Intent（含 ≤5 问澄清访谈） |
| 创作规划 | 2–4 个创作方向 → 概念冻结 → 故事 → 分镜 |
| AI 生成 | 分镜图像 + TTS 旁白（Model Router 隔离 provider） |
| 视频合成 | Ken Burns 运镜 + xfade + 旁白时间线 + 字幕（FFmpeg） |
| 修订 | 自然语言修改 → 定位 → 新版本（永不覆盖） |
| 版本历史 | 初稿 / 第 N 版 / 回到这一版 |
| 发布 | 最小发布（public/unlisted/private + Publication 记录） |
| Remix | 血缘三件套 + 原作零改动 + 配方继承 |
| 溯源 | Provenance 只追加（content_created/version_created/remixed/…） |

### M1.5 新增（质量闸门 + 双路径）

- `video.shot` 能力：cogvideox-3 图生视频（Native 路径），与组合式管线（Composition 路径）由配方 `motion` 字段调度，同一 Evaluation Framework
- 失败恢复补全：GENERATING 态 Job 失败后可重新生成（§51 语义补全）

### 明确不做（Alpha）

粉丝 / 评论 / 复杂 Feed / 商业化 / 创作者收益 / 大型社交图谱 UI / 多人实时协作。

## 5. 七条 UX 原则（验收标准级）

1. 不让用户学习 Prompt（核心入口永远是"你想表达什么？"）
2. 重要创作都可继续修改（修订 = 新版本，旧版永不丢）
3. 生成失败不丢工作（状态机原地、可重试）
4. 旧版本保留（版本时间线可恢复）
5. 用户永远知道在哪一步（步骤条 + 阶段语言）
6. 默认参数交给 AI，用户指定 vs AI 默认可区分（Intent 字段级 source）
7. 专业控制逐步开放（Debug/Admin 才见工程术语）

## 6. 质量闸门（M1.5 Expression Quality Gate）

| Gate | 验证 | 状态 |
|------|------|------|
| G1 真实内容质量 | 10 类型 × 全链真实创作 + 指标采集 | 进行中 |
| G2 内容范式 | 写实 / 电影 / 强想象 三范式 | 进行中 |
| G3 修订质量 | 父亲故事 4 连改（理解/局部性/新版本/保留/原因） | 脚本就绪 |
| G4 Remix 质量 | 原作→Remix→再修改（零改动/血缘/继承/可续改） | 脚本就绪 |
| G5 Content Object 完整性 | 数据库级六表关系检查 | 脚本就绪 |
| G6 视觉质量 | 帧间差分/静止段度量 + Native 双路径对比 | 度量就绪 |
| G7 真人测试 | 10–20 人，不教 Prompt，观察"我还想做一个" | 计划就绪 |

完成标准：提交 Expression Quality Report（9 份子报告），回答两个问题：
1. ImagineOS 当前是否已证明"普通人的表达可以被转化为有价值的视频作品"？
2. 下一阶段最大瓶颈是 AI 生成质量、Intent 理解、Revision、UX，还是内容传播？

## 7. 非功能约束

- 端到端延迟：全链（表达到发布）目标 < 8 分钟；单镜图像 ~51s、TTS ~1.4s、合成 ~20s（M1.5 实测）
- 成本：每次 provider 调用落 Generation 记账（latency + provider/model），成本报告按案例归集
- 可靠性：能力级重试（3 次指数退避）+ Job 持久化 + 断点恢复
- 数据完整性：六条数据不变量（版本不可变 / Remix 三件套 / Provenance 只追加 / 领域表无模型名 / Intent source 标记 / currentVersionId 现势指针）

## 8. 相关文档

- 宪法：`docs/product/product-constitution.md`
- 任务树：`docs/product/development-task-tree.md`
- M1.5 任务树与执行计划：`docs/product/m15-task-tree.md`
- 架构：`docs/architecture/architecture.md`
