# ImagineOS 产品宪章（Project Charter）

- 版本：v1.0（提炼自 Master Brief v1.0，97 条）
- 日期：2026-10-05
- 作用：全周期不可变基线。完整原文见创始指令（v1.0 Master Brief）；本文件是工程协作时的快速引用版。
- 位置：/docs/product/charter.md

---

## 1. 一句话定义

> ImagineOS = AI 时代的人类表达与视觉创造操作系统。口号：**想到了，就让它发生。**

## 2. 使命

让更多普通人获得过去只有专业影视团队才拥有的视觉表达能力。**AI 扩展人的创作能力，不是替人创作。** 人负责：为什么表达 / 表达什么 / 最终取舍；AI 负责创意辅助到后期制作的全链执行。

## 3. 第一性原理

用户先表达"我想表达什么"，而不是"我要生成什么视频"。系统职责：理解意图 → 找到最适合的视觉表达方式。视频是第一载体，非永久唯一载体。

## 4. 产品主循环

`想 → 创 → 看 → 改 → 分享 → 共创 → 再创`。从 Consumption Loop 转向 Creation Loop。

## 5. 阶段路线（顺序不可倒置）

Expression → Creation → Content → Social → World → Economy
Stage 1 Imagine Creator → Stage 2 Studio → Stage 3 Social → Stage 4 World → Stage 5 OS

## 6. Alpha 唯一目标与金路径

验证：普通人只靠自然语言，能否把真实想表达的东西变成自己认可的视觉作品。

金路径（§63 自行车故事）：Intent → Creative Direction（用户选）→ Story/Scene/Shot → AI Generation → Preview → "再温暖一点" → Version 2 → Publish → Remix。**这条链顺畅 = Alpha 成立。**

## 7. 核心红线（不得擅改，涉及时升级给人）

1. Content Object 核心模型（作品 = 可继续创造的状态树，非 MP4）
2. Model Router 原则（业务层禁止绑定具体模型/供应商）
3. Creation Loop 与 Remix 方向（内容图谱种子）
4. Provenance / Trust 原则（第一版即保存来源，面向 C2PA）
5. 版本不覆盖（parent_version_id 链，旧版本只读）
6. AI 标识义务（公开内容显示 AI Generated / AI Assisted）

## 8. UX 七原则（§44）

不学 Prompt；重要创作可续改；生成失败不丢工作；旧版本保留；用户永远知道当前步骤；默认交给 AI；专业控制逐步开放。

## 9. Alpha 范围

**做**：Home（Explore+Imagine）/ Imagine 全流程 / Projects / Content / Profile（轻）。
**不做**：World、完整 Studio、完整社交、直播、商城、广告、收益体系、3D。
**必须做对**：Content Object（含版本/血缘/权限/溯源）从第一版正确。

## 10. 必须升级给人的决策（§85）

产品战略/商业模式/核心用户定义变化；Content Object 大改；数据库核心模型推翻；隐私与真人数字分身政策；重要版权政策；内容安全边界；生产支付；破坏性迁移；大规模数据删除。格式：问题/影响/方案 A/方案 B/推荐+理由。

## 11. DoD 与汇报（§82/§83）

- DoD：代码 + typecheck + lint + 测试 + 关键路径手测 + 错误路径测试 + 文档更新 + 无回归。
- 汇报：完成/修改/原因/验证/测试/风险/已知问题/下一步。禁止只报 "Done"。

## 12. 工程哲学

- 战略看十年，产品看三年，工程看三个月，任务只做当前一项。
- 为未来留接口（数据关系），不为未来提前建摩天大楼（功能代码）。
- 模型是基础设施；长期资产 = Intent Engine / Creative Planner / Content Object / Revision / Content Graph / Provenance / Evaluation。
- 任何功能先问：**它是否让人的表达能力变强？**
