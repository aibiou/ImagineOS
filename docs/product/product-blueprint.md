# ImagineOS 产品蓝图（Product Blueprint）

> 文档地位：产品形态与演进蓝图 · GitHub 主事实源
> 定稿：2026-10-06

## 1. 产品是什么

AI 原生的人类表达与视觉创作平台。用户入口只有一个问题：

> **你想表达什么？**

用户用人话说出想表达的东西（一个人、一件事、一段回忆、一种情绪、一个梦、一个想象），ImagineOS 的 Intent Engine 理解它，Creative Planner 给出创作方向，AI 创作管线产出作品，用户以自然语言修订，发布，其他人可以从任何作品继续创作自己的版本。

## 2. 产品主循环（六环）

```text
Human Intent → AI Creation → Content → Revision → Publish → Continue Creating
        ↑                                                        │
        └────────────────────────────────────────────────────────┘
```

每一环的产品语义：

| 环 | 内部概念 | 用户语言 | 已落地（M1） |
|----|----------|----------|--------------|
| 表达 | Intent / Intent Engine | 理解你的表达 / 我听到了这些 | ✓ |
| 创作 | Creative Planner + Generation Pipeline | 挑选方向 / 展开故事 / 分镜 / AI 生成 | ✓ |
| 作品 | Content Object / ContentVersion | 作品 / 初稿 / 第 N 版 | ✓ |
| 修改 | Revision System（locator + 版本不可变） | 你想怎么改 / 继续修改 | ✓ |
| 发布 | Publication | 发布作品 / 已发布 | ✓ |
| 再创 | Remix（血缘三件套） | 从这里开始创作 | ✓ |

## 3. 长期演进路线

```text
Expression → Creation → Content → Social → World → Economy
```

- **Expression + Creation（当前，M0–M1.5）**：把"人的表达变成有价值的视觉作品"这条链走通、走好。唯一 KPI = Expression Success Rate。
- **Content（M2 候选）**：作品的世界——探索、发现、被看见。前置条件：M1.5 证明表达链路质量。
- **Social**：从"看到别人的作品想做一个"到真正的共创社区（粉丝/评论/Feed 均属此阶段，**当前明确暂缓**）。
- **World**：可进入的内容世界与角色资产。
- **Economy**：创作者价值回流（最后才做）。

## 4. 载体矩阵

第一阶段 Video；长期 Image / Audio / Character / Story / Interactive Content / World。所有载体共享同一 Content Object 基因与同一创作循环——载体是 Content Object 的呈现方式，不是产品边界。

## 5. 平台双面

1. **创作面（Imagine Creator）**：创作空间（/create）——理解、方向、故事、分镜、生成、修订、发布。
2. **内容面（Explore）**：探索页——视觉优先的作品流，每件作品带"从这里开始创作"的入口。

创作面是本体，内容面是表达被看见的方式；两者由 Remix 血缘连接成活的内容图谱。

## 6. 里程碑状态（2026-10-06）

| 里程碑 | 状态 | 内容 |
|--------|------|------|
| M0 Walking Skeleton | ✅ 完成 | Content Object 原语 + 状态机 + 版本/Remix/Provenance + 30 测试 |
| M1 First Video | ✅ 完成 | Intent Engine→Creative Planner→Model Router→Generation Jobs→FFmpeg 合成 全链真实生成；P0/P1 UI 验收通过 |
| M1.5 Expression Quality Gate | 🔶 进行中 | 七道质量闸门（真实内容质量/范式/修订/Remix/完整性/视觉/真人测试）+ Native Video 双路径 |
| M2 | ⏸ 等待 M1.5 决策 | 范围由 Expression Quality Report 决定 |

## 7. 明确暂缓（当前阶段不做）

粉丝系统、评论系统、复杂 Feed 算法、商业化、创作者收益、大型社交图谱 UI。原因：当前真正需要验证的是 **Expression Success**——普通人的表达能否被转化为有价值的视觉作品。

## 8. 相关文档

- 愿景：`docs/product/vision.md`
- 宪法：`docs/product/product-constitution.md`
- Alpha PRD：`docs/product/alpha-prd.md`
- 任务树：`docs/product/development-task-tree.md`（Epic E0–E15 全量）
- M1.5 任务树：`docs/product/m15-task-tree.md`
