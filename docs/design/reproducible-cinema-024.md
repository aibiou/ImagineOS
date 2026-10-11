# 设计文档：持续复现好作品（reproducible-cinema-024）

> 状态：Approved（产品负责人 2026-10-09 指令：「不要 Ken Burns 回落」「设计好再动手」）
> 范围：本轮 = native-first 供给调度 + P0 质量门 + 指纹落盘 + 短剧手法库；剧集化（Series Bible）为下一轮 Epic。

## 0. 一句话

把「好作品」从偶发的抽卡，改造成「生成 → 评测 → 修正 → 记忆」的闭环系统：下限由质量门守住，上限由耐心供给与手法库抬升，复利由指纹账本积累。

## 1. 事实基础（2026-10-09 账本实测，非推测）

- **agnes-com 视频通道 48h 内 0% 成功率**（52 条 video.shot 账本，agnes 全部 429，每次先挂 41s 再拒绝：「You've reached the API rate limit for free users」）。免费档视频 RPM=1 是硬墙，不是偶发。
- **zai-video/cogvideox-3 是真实出片供给**：63–81s/镜，多轮成功；但其限流恢复窗口抖动大（60s 间隔常失败，~120–500s 间隔稳定成功）。
- **当前每镜视频预算 ≈ 160–200s**（agnes 3×41s 死亡螺旋 + zai 3 次尝试×60s 间隔）→ 撞不上 zai 恢复窗口 → 回落 Ken Burns。**「Ken Burns 回落」不是供给绝对不足，是预算与调度错配。**
- 编剧层（三幕微结构/人物小传）与一致性层（锚点注入）已代码化（186 测试），但**画面质感无任何反馈回路**：图丑、人跑偏，系统不知道也不管。

## 2. 目标架构：五层专业能力栈

| 层 | 现状 | 本轮 | 复现性贡献 |
|---|---|---|---|
| L1 编剧层 | 三幕微结构+人物小传（prompt+Zod） | +短剧手法库（钩子/卡点/节奏语法） | 结构合格率≈100% |
| L2 一致性层 | 锚点程序化注入（纯函数） | 不动（已是代码保证） | 跨镜一致不靠运气 |
| L3 供给层 | 3 分钟预算→回落 Ken Burns | **native-first 患性调度**（预算 8min/镜 + 断点续跑 + 严格门） | 「动起来」覆盖率→~100% |
| L4 质量门 | 无 | **P0 VLM 逐镜审图**（人物/场景/风格/缺陷四查 + 有界重试择优） | 单镜合格率从抽卡变闭环 |
| L5 记忆层 | 无 | **指纹账本**（promptHash/firstFrameHash/provider/attempt 全落 Generation） | 复现与范例库的地基 |

## 3. L3 native-first 患性调度（消灭 Ken Burns 回落）

### 3.1 原则
- **默认严格模式**：native 意图镜头必须拿到 AI 视频；预算耗尽 ≠ 静默回落，而是显式失败 + 断点续跑入口。
- 运维逃生阀 `IMAGINEOS_ALLOW_VIDEO_FALLBACK=1` 恢复旧行为（Ken Burns），Alpha 期默认关闭。

### 3.2 机制
1. **患性循环（pipeline 内）**：每镜视频在预算内反复整轮调用 `router.video`：
   - `IMAGINEOS_VIDEO_SHOT_BUDGET_MS`（默认 480s/镜）
   - 轮间延迟：限速类错误 → 70s（贴着 RPM 窗口）；其他 → 20s 指数退避
   - 每轮上报进度（`videoAttempts` 入 shotAssets 条目）→ **续租 lease**（防 30min 租约在长等待中被看门狗回收）+ 前端可见「第 N 次尝试」
   - registry 既有 60s 冷却把死通道（agnes）排链尾，患性循环自动绕开它，不再烧 41s×3
2. **断点续跑 `video.resume` Job**：storyboard Job 的图像/TTS 资产已落库；预算耗尽时 Job 显式失败（错误标记含「画面与配音已保留」），regenerate 路由检测到「有成功 storyboard 记录 + 存在缺视频镜头」→ 入队 `video.resume`（只补视频，不重烧图像/TTS 配额）。
3. **合成严格门**：`video.render` 发现 native 意图镜头缺 videoAssetId → 拒绝 Ken Burns 合成，报错引导「重新生成=续跑补齐」。显式 composition 镜头（配方 motion=composition）不受限。

### 3.3 UI 诚实原则（延续 023）
- videoing 态角标升级：「AI 视频生成中 · 第 N 次尝试（供给拥挤，会自动重试）」
- 缺视频等待态（videoPending）：琥珀提示 + 已保留资产说明，绝不伪装成成品。

## 4. L4 P0 质量门（VLM in-loop 逐镜审图）

### 4.1 为什么是它
编剧与一致性已代码化，剩余方差集中在「画面质感」：人物跑偏、水印文字、肢体畸形、风格断裂。VLM 审图把「API 返回了」升级为「结果是好的」。

### 4.2 机制（`src/core/generation/quality-gate.ts`）
- **审什么**：每镜图像 base64 + 人物锚点 + 场景锚点 + lookBook → `zai.chat.completions.createVision`（glm 视觉，thinking disabled，30s 超时）
- **判什么（结构化 JSON）**：`characterMatch / sceneMatch / styleMatch / defects{text,watermark,deformity} / score(1-10) / pass`
- **硬失败**（触发重试）：人物大类错（性别/年龄档/发色服装体系）、明显文字水印、严重肢体畸形、风格与 lookBook 完全断裂
- **重试策略**：硬失败 → 有界重试 1 次（`IMAGINEOS_QG_RETRIES`），重试 prompt 追加缺陷规避提示；两轮取 score 高者（**门是择优器，不是阻断器**——重试后仍不合格则带 issue 继续走，记录 Provenance，绝不卡死管线）
- **可用性铁律**：VLM 挂了/解析失败 → 视为 pass（advisory 模式），质量门永不阻断主链路
- **记账**：每轮评审落 Provenance（`quality.gate` 事件：score/issues/attempts）+ Generation outputJson
- 开关 `IMAGINEOS_QUALITY_GATE=0` 可关（默认开）
- 视频不单独审（首帧=已审图像，运动质量由供给层负责）

## 5. L5 指纹账本（复现与范例库地基）

Generation.inputJson/outputJson 扩展（不动 schema，纯 JSON 内容扩展）：
- `promptHash`（sha256 前 16 位）+ `firstFrameHash`（视频调用时的图像指纹）
- `attempt`（第几次尝试）、`providerId`
- 价值：① 同 prompt 复现对账 ② 高分镜头检索（下一步范例库 few-shot 的数据源）③ 供给质量归因（哪个 provider 的分高）

范例库（P1，下一轮）：`BestShot` 视图（score≥8 的 Generation + prompt + hash）→ 分镜 prompt 组装时注入同风格 few-shot 参考。

## 6. L1 短剧手法库（`src/ai/planning/craft-library.ts`）

回答「专业影视剧集剧情、短剧资源能不能进编剧层」：**不搬运版权剧本，把手法提炼成可注入的语法**（法律干净、可测试、可迭代）：
- **钩子四型**（悬念/反常/冲突/奇观 + 各一例句式）注入 STORY_SYSTEM 的 hook 规则
- **卡点结尾**（最后一镜 narrationLine 必须是钩：悬念钩/情绪钩/反转钩，短剧「下一集冲动」的语法）注入 STORYBOARD_SYSTEM
- **节奏语法**：45s≈5 镜的信息密度基准（8–12s 一个信息点）、高潮最短、release 留白——已有规则强化为硬性措辞
- 剧集化（多集 Series Bible / 分集大纲 / 跨集锚点继承）→ 下一轮 Epic（需要 Series 数据模型 + 分集 Job 编排，量级独立立项）

## 7. 评测闭环（回归即复现）

- 单测：患性调度纯函数 / 质量门判定与择优 / 严格门拒绝 / 手法库注入存在性
- 真实管线 E2E：3 镜短片全程真实供给，断言：native 覆盖率 100%、videoAttempts 可见、质量门账本落盘、成片可播放
- VLM 盲评：截图 → glm 视觉盲评（既有范式复用）
- 指标口径：native 覆盖率（native 镜/意图 native 镜）、质量门拦截率、重试后合格率、单镜视频到达时长分布

## 8. 风险与边界（诚实清单）

- zai-video 若彻底断供（当日配额尽），严格模式下用户会看到显式失败+续跑入口而非假成品——这是设计意图，不是缺陷
- 患性预算拉长总时长（5 镜最坏 ~40min），UI 已有逐镜状态+尝试次数对冲焦虑；预算可 env 调
- 质量门每镜 +1 次 VLM 调用（秒级、免费档内）；择优重试每镜最多 +1 次图像调用
- 范例库/best-of-N/多集剧集化本轮不实现，防范围失控——设计已预留数据地基

## 9. E2E 实测纪要（2026-10-09，真实供给全程）

- 供给实况：agnes-com 视频 48h 内 0%（免费档 RPM=1 硬墙，每次先挂 41s 再 429）；zai-video 当日成功 11 段后于 10:42 起持续 429（疑似每日配额上限）
- 患性调度实证：每镜 3-5 轮自动重试、70s 轮间延迟、每轮进度上报（lease 续租 + 前端「第 N 轮」可见）；零静默回落
- 质量门实证（真实 VLM）：5 镜全部评审，3 镜捕捉到真实硬缺陷（日文招牌「おでん/岩滝」、便签手写文字、耳麦与「笔在耳后」锚点不符）→ 全部触发择优重试（attempts=2）；通过镜 9 分
- 指纹账本实证：91 条 Generation，79 条 promptHash、71 条 firstFrameHash
- 严格门+断点续跑实证：storyboard 预算耗尽 → 显式失败（「第 2、4 镜…画面与配音已全部保留」）→ regenerate 自动路由 video.resume × 4 轮（只补缺口，图像零重烧——图像调用计数不变）
- 浏览器层：重试轮次角标 + 逐镜五态 + Lightbox 720×1280 视频播放推进 2.45s
- 未完成项（供给受限，非能力缺失）：末 2 镜 native 补齐与成片渲染等待 zai 配额窗口恢复；续跑入口已就位，恢复后一键补齐

## 10. 后续优化（下一轮候选）

- 限速冷却递增：agnes 连续 429 后冷却 60s→2min→4min 递增（当前每轮仍烧 41s 死亡螺旋，~18% 轮时间浪费）
- BestShot 范例库：score≥8 的 Generation（prompt+指纹）注入分镜 few-shot
- 剧集化（Series Bible / 分集大纲 / 跨集锚点继承）：独立 Epic 立项
- 供给升级（付费解除 RPM/配额墙）：产品决策
