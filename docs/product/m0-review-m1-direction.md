# M0 评审结论与 M1 方向（产品负责人指令落档）

- 日期：2026-10-06
- 性质：**产品负责人对 M0 Walking Skeleton 的正式评审结论**——M1 的最高优先级输入
- 效力：与《product-north-star.md》同级引用；与既有 Epic 规划冲突时，以本文为准

## 总体判断

> 方向正确，架构骨架正确，不需要推倒重做。

M0 已正确体现：第一性问题入口、"想→创→看→改→分享→共创→再创" Creation Loop、我的创作、Explore、Version、Revision、Remix。

已知偏差：当前 UI 更像"AI 创作工作台"，尚未充分体现"下一代视频/内容平台"。M1 起围绕以下方向**增强**，而非重构。

## M1 的核心命题

> M0 证明了产品骨架可以成立。M1 要证明的是：**用户看到内容以后，会不会产生"我也想创造一个"的冲动。**

主链（M1 工程顺序）：

```
Intent Engine → AI Generation → Visual Content → Revision → Publish → Remix
```

**尤其关注 Visual Content + Remix**——这是从"AI 工具"向"下一代内容平台"迈出的关键一步。

## P0（必须做到）

### P0-1 Explore 必须具有"视频平台感"

- 视觉内容（Video / Image / Motion / Audio-visual）必须成为卡片的**第一视觉元素**
- Alpha 初期内容即使是占位，也必须为真实内容展示预留区域
- 卡片结构（自上而下）：

```
Visual Content
↓
Title
↓
Creator
↓
AI involvement
↓
Remix
```

- 禁止继续以纯文字卡片作为主要内容形态

### P0-2 「你想表达什么？」保持核心入口

- 保留现有设计；禁止改为「请输入 Prompt」
- 禁止暴露模型、Seed、采样器等工程参数
- 产品核心语言永远是：**你想表达什么？**

### P0-3 普通用户不见工程术语

工程词汇 → 用户语言的映射（UI 文案层的强制规范）：

| 禁止出现（用户界面） | 允许存在（Debug/Admin/Internal） | 用户应看到 |
|---|---|---|
| Content Object | 内部元数据 | 作品 |
| Version V0 / V1 | 内部版本号 | 初稿 / 第2版 / 最新版本 |
| V1 · 共1版 | — | 第1版 / 共2版 |
| Intent Engine | 内部服务名 | （不可见） |
| AI Generation Chain | — | AI 参与创作 |
| Remix 这个作品（过渡期可留） | — | 从这里开始我的版本 / 创造我的版本 |

底层技术模型不得直接成为用户界面语言。

## P1（方向性引导）

1. **Remix 强化**：M1 保留「Remix」概念，文案逐步过渡到「从这里开始我的版本」「创造我的版本」。Remix 是 ImagineOS 与传统短视频平台的核心差异。
2. **Home 信息架构保持**：Home → 主创作入口 → 我的创作 → 探索，M0/M1 不重构。长期演化方向：Home=我的入口 / Imagine=创作空间 / Explore=内容世界 / Projects=我的作品。
3. **视觉语言**：黑+紫+Glow 的 Alpha 风格可保留，但不再强化"通用 AI SaaS"感；逐步向**电影感、内容感、创作感、人的温度、沉浸**发展。重点不是更多发光效果。
4. **禁止为 UI 提前大重构**：不更换 UI framework、不重构全部路由、不推翻数据库/Content Object/页面。只做增量改进。

## 对开发顺序的裁决

继续按既有 Architecture / PRD / Master Brief 与开发任务树推进 M1（E3–E7 打通真实生成管线），并将本文 P0/P1 作为 M1 UI 任务的验收标准。

## 落实到任务树的映射

| 评审条目 | 落点 |
|---|---|
| P0-1 视觉化卡片 | E7.x（Explore Visual Cards）+ E7 Media Pipeline 产出真实素材 |
| P0-2 入口保持 | 既有首页英雄区，不动 |
| P0-3 用户语言层 | 新增「产品语言字典」（src/app 内唯一 UI 文案规范源） |
| P1 Remix 文案 | ExploreCard / 详情页按钮文案切换 |
| P1 创作空间 | /create/[id] 增量新页面（不动首页 IA） |
