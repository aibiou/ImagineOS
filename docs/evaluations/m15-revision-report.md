# M1.5 Revision Report — 修订质量报告

> ImagineOS Alpha · 2026-10-06 · M1.5 Gate 3
> 状态：**机制层 + 四连改行为链全部验证通过（2026-10-06/07 完成，v1→v5 发布）**
> 执行脚本：`node scripts/m15/run-revision-chain.mjs`（已实际执行完毕，断点续跑幂等）

---

## 0. Model Provider 执行环境

> 权威记录：`m15-expression-quality-report.md` §0.5（配置链路验证 + 协议缺陷工程记录）。本 Gate 四连改全程在以下通道配置下执行（Generation 记账可复查）：

| 通道 | Provider | Model | 本 Gate 记账概要 |
|------|----------|-------|------------------|
| LLM（text.plan / revision.locate） | `openai-compat:agnes-com`（自定义，priority 10） | `agnes-3.0-flash` | 定位/应用/分镜 12+ 次调用全成功，10–51s/次 |
| Image（image.shot） | `openai-compat:agnes-com` | `agnes-image-2.5-flash` | 34 成功 / 6 失败（失败自动降级 `zai-image` 2 次成功——fallback 铁证） |
| TTS（audio.tts） | 内置 `zai-tts`（无自定义；产品负责人指定 TTS 走内置） | `zai-tts-tongtong` | 23 成功 / 37 失败（z-ai 配额间歇 429，重试与重入吸收） |
| Video | —（composition 模式，无 video.shot） | — | Native 路径见视觉质量报告 Gate 6b |

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

## 2. 四连改行为链 ✅（2026-10-06/07 全部完成并发布）

**测试对象**（用户指令原文）：「我想做一个关于父亲的故事。」READY 态连续四改，最终 v5 发布：

| # | 用户反馈（原话） | 实际定位 | 局部性 | 新版本 | 耗时 | 状态 |
|---|------------------|----------|--------|--------|------|------|
| 1 | 再温暖一点 | style｜调暖全片色调并软化旁白措辞 | 4/4 镜（imagePrompt + narrationLine） | v2 | 113s | ✅ 原生完成 |
| 2 | 父亲不要说话 | shot｜移除暗示父亲语言交互的旁白 | 2/4 镜（narrationLine） | v3 | 84s | ✅ 原生完成 |
| 3 | 第二个镜头换成童年 | shot｜镜头 2 场景替换 | **1/4 镜** | v4 | 28s（恢复重入） | ✅ 恢复模式完成 |
| 4 | 结尾不要煽情 | 尾部镜头｜结尾情绪收敛 | 2/4 镜 | v5 | 26s（恢复重入） | ✅ 恢复模式完成 |

**九项验收的实际通过情况**：

| 验收项 | 结果 | 证据 |
|--------|------|------|
| 1–2. AI 理解正确 / targetLevel 正确 | ✅ | 四改定位分别为 style 级 / shot 级（台词）/ shot 级（单镜）/ 尾部镜头级——与人工预期一致 |
| 3–4. target node / affectedShotIndexes 正确 | ✅ | 改 2 影响含台词的镜 1/2；改 3 仅镜 2；改 4 影响镜 3/4 |
| 5. 无关镜头不变（局部性） | ✅ | 4/4（全局情绪合理全改）→ 2/4 → **1/4** → 2/4，unchangedShots 六字段零变化 |
| 6. 新 ContentVersion | ✅ | v2/v3/v4/v5 全部 method=revision |
| 7. 旧版本完整保留 | ✅ | v1–v4 structureJson 不变（Gate 5 不可变断言 0 错） |
| 8. changelog | ✅ | 「整体情绪调暖」「去掉父亲台词…」「镜头 2 替换为童年场景」「结尾收敛情绪」 |
| 9. 真实重新生成 | ✅ | 每轮受影响镜头产生新 image.shot/audio.tts 记账 + 成片重渲染（v2 42s / v3 40s / v4 40s / v5 40s 级） |

**诚实记录（两轮恢复，应用层 §51/T9.1.1 设计的真实考验）**：
- 改 3 首次尝试（10-06 16:24）：v4 创建成功后 storyboard Job 因 **z-ai TTS 二次 429** 失败（audio.tts 全候选 Provider 失败）——内容状态机原地留在 GENERATING（未丢用户工作），20:50 经 **regenerate 同版本重入**（28s）恢复并完成；
- 改 4（10-06 20:52）：v5 生成完成后编排器进程被外部 SIGKILL 击杀（非应用缺陷），21:00 补 render/发布/记账（22s）收尾；
- 同窗口内的 **fallback 铁证**：agnes-image 6 连败（16:25）→ `zai-image` 自动接管 2 次成功（56s/张）——自定义 Provider 失败自动降级内置，Image 通道的降级链路真实生效。

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
