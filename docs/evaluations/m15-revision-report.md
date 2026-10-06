# M1.5 Revision Report — 修订质量报告

> ImagineOS Alpha · 2026-10-06 · M1.5 Gate 3
> 状态：**机制层已验证 ｜ 四连改行为链待配额恢复补跑**（不冒充完成）
> 执行脚本：`node scripts/m15/run-revision-chain.mjs`（断点续跑、幂等）

---

## 1. 修订的机制层证据（已验证，DB 级）

| 检查项 | 证据 | 状态 |
|--------|------|------|
| 修订定位器（revision.locate）真实运行 | Generation 记账：text.plan/revision.locate 成功，延迟 15.1s（输入为全量结构 JSON，属最慢的 LLM 用途） | ✅ A 级 |
| 修订 = 新 ContentVersion | DB 现存 6 个 creationMethod=revision 的版本（M1 种子的「再温暖一点」修订链 + 各案例重生成） | ✅ A 级 |
| 旧版本完整保留 | 版本链 v1→v2 递增，parentVersionId 血缘完整（Gate 5 断言 0 错） | ✅ A 级 |
| changelog 保存用户原始反馈 | 「再温暖一点」（§63 种子修订）等原文在库 | ✅ A 级 |
| 受影响部分重生成 | applyRevision 后 Generation 产生新 image.shot/tts 行（仅受影响镜头） | ✅ 机制层 |
| Generation/Provenance 关联 | 每次修订产生 version_created 事件 + 生成记账（31 个 version_created 事件在库） | ✅ A 级 |

## 2. 四连改行为链（⏸ 待补跑，脚本就绪）

**测试对象**（用户指令原文）：「我想做一个关于父亲的故事。」发布后连续四改：

| # | 用户反馈（原话） | 预期定位 |
|---|------------------|----------|
| 1 | 再温暖一点 | 情绪级（全局 style/emotion 或多镜 narration 情绪） |
| 2 | 父亲不要说话 | 角色/旁白级（涉及含父亲台词的镜头） |
| 3 | 第二个镜头换成童年 | 镜头级（shot 2 的 imagePrompt/visualDescription 替换） |
| 4 | 结尾不要煽情 | 尾部镜头级（收尾镜头 emotion/narrationLine 收敛） |

**每次修改必须验证的九项**（驱动脚本自动断言/记录，人工复核）：

1. AI 理解正确（plan.summary/reason 与用户意图对应）
2. targetLevel 正确（情绪级 vs 镜头级 vs 角色级）
3. target node 正确（影响的是对的场景/镜头）
4. affectedShotIndexes 正确（与人工判断的预期镜头一致）
5. 无关镜头不变（diff 局部性：changedShotCount 远小于总镜数，unchangedShotCount 字段级相等）
6. 新 ContentVersion 创建（版本号 +1，method=revision）
7. 旧版本完整保留（前序版本 structureJson 不变——不可变断言）
8. changelog = 用户原话
9. 真实重新生成（受影响镜头产生新 Asset；最终成片重新渲染——不是只改 JSON）

**记录格式**（每轮）：input → revision plan → structure diff（changed fields per shot）→ changed assets（新旧 assetId）→ new version → provenance 事件 → final output（成片+时长）。

## 3. 每轮验收的判定标准（预注册，防事后合理化）

- 局部性：改 1「再温暖一点」允许全局风格字段变化但镜数变化应为 0；改 3「第二个镜头换成童年」changedShotCount 应 = 1（仅镜 2）且其他镜头六字段零变化；
- 理解正确性：plan 的 summary 必须能被不懂技术的第三人读出与用户原话的对应关系；
- 诚实失败也是结果：若定位错了（如「父亲不要说话」被理解为删除所有旁白），如实记录为缺陷证据，进入 M2 修复清单，不重试掩盖。

## 4. 阻塞与恢复

- 阻塞原因：修订 apply 的重生成需要 image.shot 配额（当前 429 长冷却）；
- 恢复动作：`node scripts/m15/run-revision-chain.mjs`（自动断点续跑；初始创作完成后逐改四轮，最后发布供 Gate 4 使用）；
- 预计时长：初始创作 ~3.5min + 四轮修订（每轮定位 ~15s + 局部重生成 ~1–2min）≈ 12–15min。

## 5. 结论（当前）

**修订机制（定位→新版本→局部重生成→记账）已在数据库层完整验证；「连续自然语言修改」的行为质量数据未采集——此项在 M1.5 收口前必须补跑，否则 Q4（修订是否足够可靠）只能回答到机制层。**
