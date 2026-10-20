# M1.5 Visual Quality Report — 视觉质量报告

> ImagineOS Alpha · 2026-10-06 · M1.5 Gate 6
> 数据源：帧间差分（YDIF, signalstats）+ freezedetect + ffprobe + 抽帧人工检视
> 核心问题：**ImagineOS 当前生成的到底是真正的视频体验，还是高级一点的会动的图片？**
> 诚实声明：本报告区分「持久化可复现证据」与「不可复现的引用数据」（2026-10-06 沙箱重置销毁重置前成片，见 §0）

---

## 0a. Model Provider 执行环境

> 权威记录：`m15-expression-quality-report.md` §0.5。本报告度量的成片按产出段使用不同 Provider：

| 度量对象 | Image 来源 | Video 来源 | 说明 |
|----------|-----------|-----------|------|
| p01–p09 组合式成片（B/C 级历史数据） | 内置 `zai-image` | —（composition） | 晨跑段（04:00–04:44），agnes 未配置 |
| G3 父亲故事 composition 基线（A 级） | `openai-compat:agnes-com` · `agnes-image-2.5-flash` | —（composition） | Phase B 段 |
| Native Golden Case（A 级） | `openai-compat:agnes-com` · `agnes-image-2.5-flash`（首帧） | `openai-compat:agnes-com` · `agnes-video-2.5-flash`（OpenAI-Videos 协议，720P） | 全镜 native 路径 |
| TTS（全部成片旁白） | 内置 `zai-tts` · `zai-tts-tongtong` | — | 产品负责人指定 TTS 走内置 |

---

## 0. 证据等级说明（沙箱重置事件后必需）

| 等级 | 含义 | 本报告适用数据 |
|------|------|----------------|
| **A（可复现）** | 文件在盘，任何人可重跑度量 | native-video-smoke.mp4（YDIF 复测与原记录一致：2.079 vs 2.08）；配额恢复后的 G3/G4/p10/Native Golden Case 新数据 |
| **B（持久化不可复现）** | 度量结果已持久化（state/*.json，时间戳早于重置），源文件已销毁 | p04 组合式成片 YDIF=0.907 |
| **C（不可复现的引用）** | 仅存在于报告正文，未落盘 | 主报告曾引用的其余 8 案例逐例 YDIF（0.705–1.33 区间） |

> **处置**：C 级数据在终版收口时以 Golden Case + G3 新数据（A 级）替代为对比基线；p04（B 级）保留并标注。任何 C 级数字不得单独支撑结论。

## 1. 度量方法

- **YDIF（帧间差分）**：`ffmpeg signalstats` 逐帧输出 YDIF；剔除切镜帧（> 全帧最大值 30% 的跳变）后得「镜头内运动」分布。参考系：真实实拍视频通常 3–8；完全静态的 PNG 序列 ≈ 0。
- **freezedetect**：完全静止段检测（n=0.003, d=1s）。
- **抽帧人工检视**：每 4s 一帧，供人物/环境/镜头运动与一致性的定性评估。

## 2. 组合式管线（当前默认路径）

| 指标 | 值 | 证据等级 |
|------|-----|----------|
| p04 镜头内 YDIF 均值 / p95 | 0.907 / 2.501（全帧均值 1.85） | B |
| 9 案例镜头内 YDIF 区间（引用） | 0.705–1.33，均值 ≈1.0 | C |
| 完全静止段 | 0（运镜始终存在） | B |
| 分辨率 / 帧率 | 720x1280 / 30fps | A（重置前多案例一致） |

**机制解释**：Ken Burns 全局缓动（推拉摇移）产生持续但微小的整帧位移 → YDIF ≈ 1.0；**人物不动、环境不动**——画面是「动的图片」，不是「运动的场景」。

## 3. Native 路径（cogvideox-3 图生视频 + agnes-video-2.5-flash 自定义）

| 指标 | 值 | 证据等级 |
|------|-----|----------|
| smoke 单镜 YDIF 均值 / p50 / p95 | **2.079 / 1.873 / 4.181**（本次复测） | **A** |
| 与组合式均值比 | ≈ 2.1–2.3× | A/B 推导 |
| 单镜生成延迟（直连 smoke） | 56s（提交→轮询→下载）；agnes 通道 278s（10-06 20:19 队列窗口内全链） | A |
| 720x1280 / 31fps / 5.1s 片段 | AIGC 元数据在文件内（可验真） | A |
| 管线级全案例（≥5 镜、回落、逐镜延迟） | **Golden Case 已执行（10-06 21:15，混合降级形态）**：28 次 video.shot 尝试，1 镜真 native 成功（zai-video/cogvideox-3，68.6s），4 镜全候选失败后按设计回落 composition（Provenance 逐镜记账 native-fallback ×4，成片仍完整发布） | **A** |
| 混合成片度量 | 43s / 720×1280 / 零冻结段；帧内 YDIF 均值 0.549 vs G3 composition 基线 0.665（注：混合形态含 4 镜 Ken Burns，非纯 native 口径，不能作为 native vs composition 的定量结论） | A |
| 全镜 native 状态 | ❓未达成——受外部约束（agnes 队列满 503 持续 + zai 视频配额间歇）；队列窗口重开可一键重跑 | 诚实记录 |

## 4. 十二维度评估（指令要求的完整口径）

| # | 维度 | 组合式 | Native | 证据 |
|---|------|--------|--------|------|
| 1 | Motion（整体运动量） | YDIF≈1.0，运镜级 | YDIF≈2.1，含主体运动 | B/C + A |
| 2 | Camera Motion | 配方 cameraMotion 5 种忠实执行（Ken Burns） | 提示词引导 + 首帧约束 | A（重置前观察）/ 待 Golden |
| 3 | Subject Motion（人物/动物动） | ❌ 无 | ✅ 有（smoke 肉眼可辨 + YDIF 支撑） | A |
| 4 | Character Consistency | 分镜图独立生成（Prompt 约束，弱） | 首帧锚定（更强） | 机制层；Golden Case 定量 |
| 5 | Scene Continuity | xfade 1.2s 渐变 | 镜头级独立生成，依赖首帧一致性 | 待 Golden |
| 6 | Audio（TTS 旁白质量） | tongtong 声线，1.9s/段，82 段真实产出 | 同左（共用编排层） | A（DB 记账） |
| 7 | Audio-Visual Alignment | TTS 实测时长→镜头时长 max 对齐（±0.5s） | 同左 | A（合成器逻辑+成片时长） |
| 8 | Narrative Continuity | 旁白驱动，结构层保证（10/10 案例故事完整） | 同左 | A（Gate 1） |
| 9 | Composition vs Native | 成本/延迟/确定性好；运动量 1/2 | 运动量 2.1×；每镜 +56s 与额外配额 | A |
| 10 | Latency | 端到端中位 409s（干净窗口 121–262s） | 全 native 预计 +5×56s ≈ +4.7min | A / 待 Golden |
| 11 | Cost | ~10.9 图/案例 | +每镜 1 次 video 调用（配额压力 ≈ 翻倍） | A / 待 Golden |
| 12 | Failure Rate | 图像 84.5%（429 风暴期）；干净期接近 100% | smoke 1/1；回落机制在位（Provenance 记账） | A / 待 Golden |

## 5. 核心问题的回答（当前证据下的诚实版本）

> **ImagineOS 当前生成的到底是真正的视频体验，还是高级一点的会动的图片？**

**组合式路径（当前默认）：是「高级一点的会动的图片」**——运镜精致、音画对齐、叙事完整，但 YDIF≈1.0 量化证实了主体与环境的静止。对「照片回忆型」表达（p01 外婆、p03 星空）够用；对「人物故事/情绪/想象」类表达构成价值上限。

**Native 路径：是「真正的视频体验」的最小可行版本**——A 级证据（可复现）显示运动量 2.1×且含主体运动。但每镜 56s + 配额翻倍 + 一致性未定量验证，**尚不满足作为默认路径的条件**。

**终版结论待 Golden Case 补齐**：人物/环境/镜头运动质量、首帧一致性、场景连续性、逐镜延迟与成功率——配额恢复后以 ≥5 镜全 native 案例定量回答「Native 是否值得成为下一阶段核心视觉路径」。

## 6. 待补项（Golden Case 已执行，剩余为队列窗口重跑）

**Golden Case 实际执行记录（2026-10-06 21:15）**：脚本已跑完全链（`state/g6-native.json`）——含每镜 video.shot 延迟/成功、回落事件、成片 YDIF、G3 基线对比、抽帧目录（`frames/g6-native`）。因 agnes 队列满 + zai 视频配额间歇，本次为**混合降级形态**（1/5 镜真 native + 4/5 镜 composition 回落）。

**剩余待补**：全镜 native 口径的 Golden Case（队列窗口重开时）：

```bash
bash scripts/m15/restart-dev.sh native       # 切 native 模式（dev server 级开关）
node scripts/m15/run-native-golden.mjs       # 全链 Golden Case + 逐镜记账 + 基线对比
bash scripts/m15/restart-dev.sh composition  # 切回默认
```

队列状态探测：`bun scripts/m15/probe-agnes-video.mjs`（提交即知，503=队列满）。
