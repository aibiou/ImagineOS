# ImagineOS 产品北极星（项目宪法）

> 本文件是 Master Brief v1.0 的宪法级摘要，供所有后续开发对齐。
> 源指令与本文冲突时，以最新 ADR + 本文件共同裁决；触及"禁改清单"的必须升级给产品负责人。

- 定稿日期：2026-10-05
- 文档地位：**最高优先级产品约束**
- 评审节奏：每个里程碑结束时全文重读一遍

---

## 1. 一句话定位

> **ImagineOS = AI 时代的人类表达与视觉创造操作系统。**
> 口号：想到了，就让它发生。

## 2. 使命

让更多普通人获得过去只有专业导演、摄影师、演员、编剧、动画师、影视团队才拥有的视觉表达能力。

我们探索的不是"AI 生成视频"，而是：**当 AI 能低成本理解人的意图、生成画面/人物/声音/故事以后，人类的表达方式和视频平台应该变成什么。**

## 3. 第一性原理

用户的第一句话不是"我要生成什么视频"，而是——

> **"我想表达什么？"**

一个想法、一个故事、一段回忆、一种情绪、一个知识、一个观点、一个梦想、一个虚构世界。

ImagineOS 的职责：**理解人的意图，帮助找到最适合的视觉表达方式。**

人负责：为什么表达、表达什么、想传递什么、最终取舍。
AI 负责：创意辅助、编剧、导演、摄影、演员、美术、音乐、剪辑、后期、技术制作。

> AI 扩展人的创作能力，而不是替人创作。

## 4. 核心变化：从 Consumption Loop 到 Creation Loop

```text
传统：人 → 拍摄 → 剪辑 → 发布 → 推荐 → 观看
ImagineOS：想 → 创 → 看 → 改 → 分享 → 共创 → 再创
```

产品主循环：`想 → 创 → 看 → 改 → 分享 → 共创 → 再创`

## 5. 阶段路线与顺序纪律

Stage 1 Imagine Creator → Stage 2 Imagine Studio → Stage 3 Imagine Social → Stage 4 Imagine World → Stage 5 ImagineOS

**路线顺序（不可因工程便利倒置）：**

```text
Expression → Creation → Content → Social → World → Economy
```

## 6. Alpha 唯一目标

Alpha 只验证一件事：

> **一个普通人，只通过自然语言，能否把一个真实想表达的东西，转化成一个自己认可的视觉作品。**

核心闭环：`Human Intent → Creative Plan → AI Creation → Content Object → Publish`（预留 Remix）。

Alpha 第一条必须打通的链路（整条链顺畅 = Alpha 成立）：

```text
"我想做一个45秒的视频，记录我小时候和父亲一起骑自行车。"
→ Intent → Creative Direction → 用户选择 → Story → Scene → Shot
→ AI Generation → Preview
→ "再温暖一点。" → Version 2 → 用户满意 → Publish
→ 其他用户 Remix → 新作品
```

## 7. 七条 UX 原则（不可违反）

1. 不要让普通用户学习 Prompt
2. 重要创作都可以继续修改
3. AI 生成失败不能丢失工作
4. 旧版本尽量保留
5. 用户永远知道现在处于哪一步
6. 默认参数尽量交给 AI（并记录哪些是用户指定、哪些是 AI 默认）
7. 专业控制能力逐步开放

## 8. 禁改清单（除非产品负责人明确决定）

- ImagineOS 核心使命
- Human Expression 核心理念
- Content Object 核心模型
- Model Router 原则（业务层禁止绑定具体模型名）
- Creation Loop
- Remix 方向
- Provenance / Trust 原则
- Alpha 核心主链

## 9. 必须升级给人的决策（工程侧不得自行拍板）

产品战略变化 / 商业模式变化 / 核心用户定义变化 / Content Object 大改 / 数据库核心模型推翻 / 隐私政策 / 真人数字分身政策 / 重要版权政策 / 内容安全边界 / 生产支付系统 / 破坏性数据库迁移 / 大规模用户数据删除。

升级格式：`问题 → 影响 → 方案 A → 方案 B → 推荐方案 → 推荐理由`，然后等待决定。

## 10. 最终判断标准

> **任何功能都问：这个东西是否让人的表达能力变强？** 答案是否定的就重新考虑。

## 11. 不要把 ImagineOS 做成什么

- ❌ "AI 生成视频按钮集合"
- ❌ "传统剪辑软件 + AI"
- ❌ "抖音复制品 + AI"
- ❌ "几十个模型 API 拼起来的工具"
- ❌ "AI 生成垃圾内容的自动化工厂"

## 12. 工程纪律摘要

- 先读需求、先读架构、先看代码、先分析影响，再写代码
- Definition of Done（§82）：代码完成 + typecheck/lint/test/build 通过 + 关键路径手测 + 错误路径测试 + 文档更新 + 无明显回归
- 汇报规范（§83）：完成/修改/原因/验证/测试/风险/已知问题/下一步——禁止只输出 "Done"
- 不过度工程：**为未来留接口，不为未来提前建摩天大楼**
- ImagineOS 自有资产（§87）：Intent Engine / Creative Planner / Content Object / Creative State / Model Router / Revision System / Content Graph / Identity Graph / Provenance / Evaluation——模型永远是可替换的基础设施
