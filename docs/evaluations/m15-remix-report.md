# M1.5 Remix Report — 续创（Remix）质量报告

> ImagineOS Alpha · 2026-10-06 · M1.5 Gate 4
> 状态：**机制层 + 专项行为链全部验证通过（2026-10-06 21:10）**
> 执行脚本：`node scripts/m15/run-remix-chain.mjs`（已实际执行完毕，断点续跑幂等）

---

## 0. Model Provider 执行环境

> 权威记录：`m15-expression-quality-report.md` §0.5。本 Gate Remix 链（原作 = Gate 3 父亲故事 v5）在以下通道配置下执行：

| 通道 | Provider | Model | 本 Gate 用途 |
|------|----------|-------|--------------|
| LLM（text.plan） | `openai-compat:agnes-com`（自定义，priority 10） | `agnes-3.0-flash` | Remix 后两轮自然语言修改的定位与应用 |
| Image（image.shot） | `openai-compat:agnes-com` | `agnes-image-2.5-flash` | 副本 regenerate 自有像素 + 修订镜头重生成（失败自动降级 `zai-image`） |
| TTS（audio.tts） | 内置 `zai-tts`（无自定义；产品负责人指定 TTS 走内置） | `zai-tts-tongtong` | 副本旁白合成 |
| Video | —（composition 模式，无 video.shot） | — | Native 路径见视觉质量报告 Gate 6b |

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

## 3. 专项行为链 ✅（2026-10-06 21:10 全链通过）

**链路设计**（完全按用户指令）：

```
用户 B（新匿名会话）
→ 在用户 A 已发布的父亲故事（Gate 3 产物 v5）上点「从这里开始创作」
→ 创建新 Content（血缘三件套落库）
→ 副本重新生成自己的画面（regenerate 全镜）
→ 修改 1：「把父亲换成母亲，保持原来的情绪和视觉风格。」
→ 修改 2：「结尾旁白轻一点，收得更平静。」
→ （验收：原作字段级快照 diff = 零改动）
```

**实际执行结果**（衍作 contentId=cmux5yg9e0059kaid696a7t14）：

| 类别 | 检查项 | 结果 |
|------|--------|------|
| 血缘 | sourceContentId / sourceVersionId / derivativeContentId / derivativeVersionId | ✅ 三件套全部正确（remixId=cmux5yga） |
| 继承 | Intent rawExpression / structureJson | ✅ rawExpression 复制；structureJson 字节级相等 |
| 隔离 | 原作 Content/versions/intents/publication/provenance/资产集 字段级快照 diff | ✅ **零改动**（仅追加 remix_received 事件，只追加不变量成立） |
| 再创作 | 副本自有像素 | ✅ regenerate 全镜重生成（agnes image ×4 + zai-tts ×4，22s）+ 渲染成片 |
| 修改 1 | 换母亲 | ✅ v2：4/4 镜改动（imagePrompt + narrationLine，主角替换语义合理全改），~48s |
| 修改 2 | 结尾旁白轻一点 | ✅ v3：**2/4 镜**改动（仅镜 3/4 narrationLine，audio 级定位，影响镜头 [3,4]），64s |
| 发布 | 副本独立发布 | ✅ 新作者自己的 publish 动作，PUBLISHED (public) |
| 图谱 | Remix Graph | ✅ 源作 5 版 → 衍作 3 版 → 1 条 remix 记录 |

**诚实失败口径的实际检验**：两项预注册风险均未触发——「换母亲」修订同时改写了 imagePrompt（视觉层真实替换，非仅旁白文字）；原作快照 diff 零违规。

**诚实记录（测试装置缺陷，已修复）**：run-remix-chain 第 7 步旧 state 覆盖把 revisions 记账踩空——DB 权威数据无损，state 已从版本链重建（`scripts/m15/repair-g4-state.mjs`），脚本已修复；此为脚本侧缺陷，Remix 应用层行为不受影响。

## 4. 诚实失败口径（预注册）

- 若「把父亲换成母亲」的修订定位只改了旁白文字而未改 imagePrompt（视觉上父亲仍是父亲），记为**角色替换缺陷**——这正是 Gate 4 要暴露的真相，不重试掩盖；
- 若原作快照 diff 出现任何非「只追加事件」类改动，记为**不变量破坏**（P0 级缺陷，直接进入修复流程）。

## 5. 阻塞与恢复（已全部解除）

- ~~阻塞原因：副本全镜再生成 + 两次修订重生成需要 image.shot 配额~~ → 已解除（agnes 图通道畅通，见 §0）；
- ~~前置依赖：Gate 3 四连改完成~~ → 已完成（10-06 21:00 父亲故事 v5 发布）；
- 执行记录：10-06 21:01–21:10 全链完成（Remix + 再生成 22s + 两轮修改 ~112s + 验证矩阵全部通过）。

## 6. 结论（终版）

**Remix 的「继承 + 隔离 + 零改动 + 双侧溯源」不变量已在 8 条种子血缘上数据库级全过；「新作者从原作出发诞生自己的创作」的行为链证据（换母亲 + 再修改 + 独立发布）已于 10-06 21:10 补齐——Q5（Remix 是否真的形成 Creation Loop）的机制与行为层证据完整，社交传播层证据属 Gate 7 真人测试范畴。**
