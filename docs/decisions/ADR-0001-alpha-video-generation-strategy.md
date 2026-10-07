# ADR-0001：Alpha 视频生成 Provider 策略 —— 组合式管线优先

- 日期：2026-10-05
- 状态：**Accepted**（2026-10-05 产品负责人确认，随 D1/D2/D3 一并批准）
- 决策人：产品负责人（确认方）；GLM-5.3（建议方）

## 问题

Alpha 的视频像素从哪里来？这决定成本结构、开发顺序、可测试性，以及 Model Router 抽象的验证方式。

## 背景

Phase 0 实测：本环境无外部视频模型 API 凭据；FFmpeg 7.1.5 可用；z-ai SDK 提供 LLM / 图像生成 / TTS。Master Brief §73 要求"只接第一阶段真正需要的 Provider，不为数量接几十个模型"。

## 方案 A：直接接外部视频模型 API

Alpha 即接入一个或多个商业视频生成 API（文本→视频端到端）。

- 优点：画面动态质量上限高；最接近终态体验
- 缺点：需要凭据与预算；成本不可控（每次全片重生成）；生成耗时长且失败率高；接口差异大导致 Adapter 厚；**无法对"分镜级修订"做局部重生成**（改一个镜头要重跑全片，与 Revision 主链冲突）

## 方案 B（推荐）：组合式管线优先

第一个 `video.compose` Provider 为内部 CompositeVideoProvider：

```text
Storyboard(Shots) → 逐镜头图像生成 → Ken Burns 运镜 + xfade 转场
→ TTS 旁白 + 背景音乐（自动闪避）→ 字幕烧制 → FFmpeg 合成 MP4
```

外部视频模型作为后续 Adapter 接入（接口位已留）。

- 优点：
  1. **分镜级局部重生成**：用户说"第二个镜头换掉"，只重生成镜头 2——直接支撑 Revision 主链与成本控制
  2. 成本低、速度快、确定性高、可回归测试（Golden Case 可全链自动跑）
  3. 环境就绪（FFmpeg 实测可用），零外部依赖启动
  4. 恰好是对 Model Router 的最强验证：后来接入真视频模型 = 仅注册新 Adapter，业务层零改动
- 缺点：动态画面质量上限低于端到端视频模型（Alpha 阶段可接受——Alpha 验证的是表达链路，不是像素质量）

## 决定（建议）

采用方案 B。触发升级条件：拿到外部视频模型凭据/预算，或 Alpha 验证完成进入质量深化期——届时以新 ADR 接入。

## 影响

- E5 / E7 的实现顺序按组合式管线排定（任务树已按此编写）
- 评测体系中 Visual Quality Eval 标注"组合式基线"，为未来模型对比留基线数据
- 若负责人选 A：任务树 E5.3/E7.1.2 重写，预计 M1 里程碑延后（外部依赖接入成本）

## 替代方案

混合（A+B 并行）：Alpha 同时维护两条 Provider 链——被否：违反 §73"只接真正需要的"，双链维护成本在单人节奏下不可承受。

---

## 修订 Rev.2（2026-10-06，M1.5 Expression Quality Gate）

**状态变更：Accepted（双路径）** —— 触发了原 ADR 预设的升级条件。

### 触发证据（Gate 6 Visual Quality 评估）

组合式管线（图像 + Ken Burns + xfade）在 M1.5 的 10 案例实测中确认了原 ADR 记录的质量上限：镜头内无真实运动（人物不动、无环境动态），"静态画面 + 音轨 + 转场"的观感占主导；对人物故事/情绪/强想象类表达，"被看见的价值"受损。

同时两个环境事实落定：
1. z-ai SDK 实测提供 `video.generations.create`（cogvideox-3，图生视频，speed 模式 ~60s/镜）；
2. Model Router 的注册表结构（M0 落地）使新能力接入的业务层改动为零——原 ADR 的验证目标达成。

### 决定

保留 Composition Pipeline，同时建立 Native Video Provider Adapter，两条路径由 Model Router 调度：

```text
Shot.motion = composition（缺省） → image.shot 生成首帧 → Ken Burns 运镜（原路径）
Shot.motion = native             → image.shot 生成首帧 → video.shot 图生视频 → 视频段直接入合成
                                    （失败回落 composition，Provenance 记 native-fallback）
```

- 新增能力 `video.shot`（types/registry/`zai-video` provider，cogvideox-3）；
- 合成层 `ComposeShotInput.videoPath`：有视频段的镜头跳过 Ken Burns，下游 xfade/字幕/音频链复用；
- 调度点在管线层（配方 `motion` 字段 + 评估开关 `IMAGINEOS_FORCE_NATIVE`），不由 LLM 决定——延续"模型选择不出现在业务层"的纪律；
- 两条路径落入同一 Evaluation Framework（Generation 记账 + Golden Case 对比）。

### 与"替代方案：混合（A+B 并行）"的关系

原否决理由（双链维护成本）在 Gate 6 证据面前被推翻一半：混合路径不是"两个整片管线并行"，而是**镜头级分叉 + 单一合成层**——维护面收敛在 `videoPath` 一个字段的分叉点。教训：原 ADR 把"混合"理解成了整片级的 A/B，镜头级分叉的代价远小于此。

### 影响

- 版本配方（ShotSnapshot）新增可选 `motion` 字段，旧配方零迁移（缺省 composition）；
- Native 路径成本/延迟约为组合式的 3–5 倍（60s/镜 vs 15s/镜），调度策略在 M2 按用户分层再定；
- Visual Quality Eval 从"组合式基线"升级为"双路径对比"，cogvideox 首帧一致性成为新的评测维度。

---

## 附录：实施现状备注（2026-10-07，Video Pipeline Audit 补录）

Rev.2 定义的调度点，当前实际状态（审计证据：`download/video-pipeline-audit-report.md`）：

1. **`IMAGINEOS_FORCE_NATIVE`（评估开关）**：仅 `scripts/m15/restart-dev.sh native` 注入，dev server 进程级环境变量，默认空。生产用户路径从不设置。
2. **`Shot.motion`（配方字段）**：⚠️ **死字段——schema 已定义（schemas.ts:63），但全系统零写入点**。plan-service 密封配方只写 cameraMotion / durationMs / narrationLine / emotion；story.ts 的 LLM 输出 schema 不含 motion；无任何 API 接受该字段。也就是说 Rev.2 图中的 `Shot.motion = native` 分支目前**只能由评估开关触发**，不存在产品侧入口。
3. **由此形成的 Alpha 现状**：所有真实用户生成 = 默认 composition（三态判定 C）。这与 Rev.2「调度策略在 M2 按用户分层再定」一致——不是实现偏差，是调度策略尚未开始建设。给 `motion` 字段建设写入点（创作页开关 / 分层调度 / provider 健康度降级）是 M2 的正规入口，届时应先给本字段补测试再启用。
4. **观测性补齐（Audit R3）**：storyboard Job 现在会在执行开头写 Provenance `mode.decision` 事件（`src/core/content/storyboard-mode.ts`，意图口径；产物口径仍以 computeGenerationMode 为准，两者差异 = 回落证据）。native-fallback 事件自 Gate 6 起就有；缺的是 composition 路径的决策记录，现已补。

---

## 修订 Rev.3（2026-10-07，产品负责人指令：native-first 产品默认）

### 触发

产品负责人明示：「我就想要AI视频，不是AI图片播放」。用户在 Gate 7 预演中看到的 composition 产物（AI 图 + Ken Burns 运镜）与产品预期（AI 视频模型生成的真实运动画面）不符。Rev.2 留待 M2 的调度策略裁决，由产品负责人本指令提前作出：**产品默认 = native**。

### 前置条件（为何此时可翻转）

- 双站点 native 通道全链验证通过：agnes-com（2026-10-06 20:14，278s / 1.12MB / 704x1280）与 agnes-cn（2026-10-07 12:18 抢救收割，0.78MB / 704x1280）——**data URI 首帧在两家 Flash 推理层均被接受**（此前唯一遗留的形态风险，report §0.5.9 闭合）；
- 限速感知调度（gate7-rate-aware-005）在位：双 provider 轮转 + 429/队列满冷却让位，RPM 1 环境下可排队消化；
- 逐镜回落兜底（Rev.2 已实现）：native 失败 → 该镜回落 composition + `native-fallback` 溯源事件，用户工作永不丢失；
- 诚实标签在位：`computeGenerationMode`（native/hybrid/composition）对用户可见，回落不隐瞒。

### 决定

1. **产品默认翻转**：`motionModeFor` 缺省值 `composition` → `native`（`src/core/content/storyboard-mode.ts`，逐镜头判定与 Job 级快照的单一事实源；`workers/pipeline-executor.ts` 本地副本已删除改为引用）。
2. **决策优先级**：`IMAGINEOS_FORCE_NATIVE=1`（评估开关）> `IMAGINEOS_FORCE_COMPOSITION=1`（**新增运维逃生阀**：视频 provider 全挂/长时限速时强制合成路径，保生成可用性）> 配方 `motion` 显式值 > 产品默认 native。
3. `Shot.motion` 死字段状态不变（写入点仍留 M2 正规建设：创作页开关 / 分层调度）；当前默认即产品行为，无需写入点即可生效。
4. `restart-dev.sh` 三模式：`product`（默认，无开关=产品行为）/ `native` / `composition`。

### 影响

- 真实用户生成预期形态：native（全镜 AI 视频）或 hybrid（部分镜回落）——队列满/限速时回落概率上升，产物标签如实反映；
- 生成时长预期从 ~15s/镜升至 native ~60-250s/镜（含队列等待）；storyboard 租约 30 分钟内可容纳（4-8 镜），进度按镜上报续租；
- 每日免费秒数消耗显著上升（Flash 限时免费档），双站点轮转分摊；额度耗尽日回落 composition 属预期行为（非缺陷）；
- 评估标准零修改：Gate 7 六指标不涉及产物形态判定；被试对「AI 视频 vs 图片播放」的感知本身是 Alpha 要验证的表达链路事实。
