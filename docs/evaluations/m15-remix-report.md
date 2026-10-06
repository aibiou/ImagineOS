# M1.5 Remix Report — 续创（Remix）质量报告

> ImagineOS Alpha · 2026-10-06 · M1.5 Gate 4
> 状态：**机制层已验证 ｜ 专项行为链待配额恢复补跑**（不冒充完成）
> 执行脚本：`node scripts/m15/run-remix-chain.mjs`（依赖 Gate 3 完成的父亲故事，断点续跑）

---

## 1. Remix 的产品命题（为什么这不是「复制页面」）

> Remix 必须证明：**从一个作品出发，诞生另一个属于新作者的创作。**

判据不是「副本存在」，而是三条同时成立：
1. **继承**：新作者从原作的意图语境与创作结构出发（Intent rawExpression + 配方 structureJson 继承）——站在原作的肩膀上；
2. **再创作**：副本生成**属于自己的媒体**（自己的像素，不是复用原作的 Asset 文件）；
3. **隔离与零改动**：原作任何字段零改动；新作的资产、版本、溯源完全独立——两个创作生命体。

## 2. 机制层证据（已验证，DB 级，M1 种子 8 条 Remix 血缘）

| 检查项 | 证据 | 状态 |
|--------|------|------|
| 血缘三件套 | 8 条 Remix 行：derivativeContentId + derivativeVersionId + sourceContentId/sourceVersionId 全非空（Gate 5 断言） | ✅ A 级 |
| 原作零改动 | fork-service 无原作写路径；原作侧仅追加 remixed 事件 | ✅ 机制层（专项链将做字段级快照 diff 复核） |
| 衍作首版 method=remix | 8/8 条衍作首版本 creationMethod=remix，changelog「Remix 自《xxx》vN」 | ✅ A 级 |
| 配方继承 | structureJson 字节级相等（Gate 5 断言通过） | ✅ A 级 |
| Intent 语境继承 | 衍作 Intent.rawExpression = 原作 rawExpression（复制为起点语境） | ✅ A 级 |
| 双侧溯源 | 8 对 remixed（原作侧）+ remix_received（衍作侧）事件，含 sourceTitle/sourceVersionNumber | ✅ A 级 |
| 副本真实再生成 | M1 种子 Remix 副本经 regenerate 产生自己的资产（README 记录：真实再生成像素） | ✅ A 级（M1 期） |
| 两层 Remix 关系查询 | 种子含两层血缘（A→B→C），查询正确 | ✅ A 级 |
| 新作品可继续发布 | 种子 Remix 副本已发布（explore 可见，带「从《xxx》开始」角标） | ✅ A 级 |

## 3. 专项行为链（⏸ 待补跑，脚本就绪）

**链路设计**（完全按用户指令）：

```
用户 B（新匿名会话）
→ 在用户 A 已发布的父亲故事（Gate 3 产物）上点「从这里开始创作」
→ 创建新 Content（血缘三件套落库）
→ 副本重新生成自己的画面（regenerate 全镜）
→ 修改 1：「把父亲换成母亲，保持原来的情绪和视觉风格。」
→ 修改 2：「结尾旁白轻一点，收得更平静。」
→ （验收：原作字段级快照 diff = 零改动）
```

**逐项验证矩阵**（run-remix-chain.mjs 自动断言 + 输出）：

| 类别 | 检查项 | 手段 |
|------|--------|------|
| 血缘 | sourceContentId / sourceVersionId / derivativeContentId / derivativeVersionId / remixerId | DB 断言 |
| 继承 | Intent rawExpression / structureJson / 创作结构 | DB 对比（字节级） |
| 隔离 | 原作 Content/versions/intents/publication/provenance/资产集 Remix 前后快照 diff | 字段级零改动断言（remix_received 只追加事件例外，符合只追加不变量） |
| 再创作 | 副本新资产与原作资产 ID 全不同；video.shot/image.shot Generation 新行 | DB + 资产 hash |
| 修改 | 两次自然语言修改走 applyRevision（同 Gate 3 标准） | plan/diff/新版本 |
| 发布 | 副本最终可发布 | API + Publication |
| 图谱 | Remix Graph 汇总（源/衍/总数/两层查询） | DB 查询 |

## 4. 诚实失败口径（预注册）

- 若「把父亲换成母亲」的修订定位只改了旁白文字而未改 imagePrompt（视觉上父亲仍是父亲），记为**角色替换缺陷**——这正是 Gate 4 要暴露的真相，不重试掩盖；
- 若原作快照 diff 出现任何非「只追加事件」类改动，记为**不变量破坏**（P0 级缺陷，直接进入修复流程）。

## 5. 阻塞与恢复

- 阻塞原因：副本全镜再生成 + 两次修订重生成需要 image.shot 配额；
- 前置依赖：Gate 3 四连改完成（父亲故事发布后作为 Remix 源）；
- 恢复动作：`node scripts/m15/run-remix-chain.mjs`；
- 预计时长：Remix + 再生成 ~3.5min + 两轮修改 ~4min ≈ 8min。

## 6. 结论（当前）

**Remix 的「继承 + 隔离 + 零改动 + 双侧溯源」不变量已在 8 条真实血缘上数据库级全过；「新作者从原作出发诞生自己的创作」的行为链证据（换母亲 + 再修改）待配额补跑——此项补齐后才能回答 Q5（Remix 是否真的形成 Creation Loop）。**
