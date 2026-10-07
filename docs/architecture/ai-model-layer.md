# AI 模型层（Model Router & Providers）

> 文档地位：AI 层架构文档 · GitHub 主事实源
> 源文件：架构理解报告 §27–§30 + `src/ai/router/`（types / registry / generation-log / llm-json）
> 定稿：2026-10-06

## 1. 铁律

> **业务层（src/app、src/core）只声明能力需求，永不出现 provider/model 名。**

```text
Application → AI Orchestrator → Model Router → Provider Adapter → Model
```

provider/model 名只允许存在于三处：
1. `src/ai/router/`（注册表）与 `src/ai/providers/`（适配器）
2. `Generation` / `GenerationJob` 执行层记录
3. `Provenance` 的 ai 事件（§34 白名单）

测试注入：`registerProvider()` 允许 fake provider 整链替换，绝不触网。

## 2. 能力分类（§29）

| 能力 | Payload 要点 | Provider | 用途 |
|------|--------------|----------|------|
| `text.plan` | system/user/jsonHint | zai-llm | Intent 抽取 / 方向 / 故事 / 分镜 / 修订定位 |
| `image.shot` | prompt + size(9:16=768x1344) | zai-image | 分镜画面 |
| `audio.tts` | text | zai-tts | 旁白配音 |
| `video.shot` | prompt + imageUrl(首帧) + size | **zai-video（cogvideox-3）** | 镜头级图生视频（M1.5 新增） |
| `video.compose` | （由 media 层合成器定义） | 内部 CompositeVideoProvider | FFmpeg 组合式合成 |

## 3. 失败处理与记账

- 单 provider 指数退避重试 ≤3 次（600ms 起）→ 同能力 fallback 链 → 全链耗尽抛 `ProviderExhaustedError`
- 能力级超时熔断：text 90s / image 180s / tts 120s / **video.shot 330s**（含提交+轮询+下载）
- 每次尝试（成功/失败）写 `Generation` 记账（provider/model/latency/purpose）——成本可观测（§62）的落点
- 记账失败绝不影响主链路（观测性让位于可用性）

## 4. 双路径视频生成（ADR-0001 Rev.2，M1.5）

```text
Shot.motion = composition（缺省）
  → image.shot 生成首帧 → FFmpeg Ken Burns 运镜（zoompan）→ xfade → TTS 时间线 → MP4
Shot.motion = native
  → image.shot 生成首帧 → video.shot 图生视频（cogvideox-3，speed ~60s/镜）
  → 视频段标准化（scale/crop/fps/tpad）→ 同一 xfade/字幕/音频合成层
  → 失败自动回落 composition（Provenance 记 native-fallback，不丢用户工作）
```

- 调度点：配方 `Shot.motion` 字段 + 评估开关 `IMAGINEOS_FORCE_NATIVE=1`；**不由 LLM 决定**
- 两路径同一 Generation 记账、同一 Evaluation Framework（Golden Case 对比）
- Native 视频不带音轨（with_audio=false）：音画统一由组合层编排

## 5. Native Provider 语义（zai-video）

```text
create(image_url=dataURL, prompt, quality=speed|quality, size)
→ { id, task_status: PROCESSING }
→ 轮询 async.result.query(id)（6s 间隔，5min 上限）
→ SUCCESS → video_result[0].url → fetch MP4 → base64 返回
→ FAIL / 超时 → 抛错（由 Router 重试链与管线回落机制接管）
```

## 6. 结构化输出纪律

`completeJson()`：Zod schema + JSON hint + 统一修复轮——LLM 返回必须过 schema 才进入领域层。修订定位器的"未受影响部分逐字保留"约束写进 system prompt（§24 局部修订）。

## 7. 扩展方式

接入新模型 = 实现 Provider 接口 + `registerProvider()` 注册，业务层零改动。这是 M0 落地 Model Router 的验证目标，已在 M1.5 用 `video.shot` 真实验证（cogvideox-3 接入未改任何 core 文件）。

## 8. 限速感知调度（双免费额度动态利用，2026-10-07）

**背景**：agnes-com（apihub.agnes-ai.com）与 agnes-cn（api.agnes-ai.cn）双站点免费额度独立，但免费档限速严格（官方 tokenplan.md：文本实际 RPM 10、图片 1K 档 RPM 10、视频 RPM 1 + 每日秒数配额；429 官方处置口径 = 等 1 分钟）。§0.5.5 的 P0 事故根因之一正是 image 429 重试耗尽——单站点打满即全线失败。

**调度策略（registry.ts，三层）**：

1. **同优先级轮转**：同通道同优先级且启用的自定义 provider ≥2 个 → 轮转组；每次路由调用偏移 +1，组内起始位交替（agnes-com ↔ agnes-cn）→ 两家额度各承担约一半流量，等效吞吐翻倍。组信息由 `buildChainsFromConfigs` 随链重建计算（TTL 3s），配置改动即时生效。
2. **限速冷却**：错误匹配 `429 / rate limit / too many requests / video_queue_full / 队列满 / 限流` → 该 provider 冷却 60s（`IMAGINEOS_RATE_COOLDOWN_MS` 可调）；冷却者排候选链尾（仍可作最后手段，不作弊式拉黑；全员冷却时维持原序照常尝试）。
3. **快速让位**：非末位候选命中限速 → 跳过剩余退避重试立即切换下一候选（不烧 1.8s 退避、不加重限流）；**末位候选例外**：保留 3 次指数退避（单链场景等待恢复——zai-tts 无备选，实测曾 2 次瞬时失败后第三次成功）。

**与优先级语义的关系**：不同 priority 仍严格按升序（轮转只发生在同优先级组内）；z-ai 内置兜底恒在链尾，永不参与轮转。测试环境不注入轮转组（保持链序确定性），`resetRegistry()/clearRegistry()` 清空冷却与偏移防污染。

**验证**（2026-10-07 实测）：单测 12 项（orderCandidates 纯函数 7 + router 行为 5，97/97 全绿）；全链 E2E 13/13——真实创作一件（150s 至 READY），Generation 记账双通道分布：LLM cn:4/com:3、图片 cn:3/com:2，零限速失败。

**agnes-cn 视频链路实测**（2026-10-07 06:44，两段证据）：①提交端点 `api.agnes-ai.cn/v1/videos` 真实可达——队列满时返回本地化业务错误（中文「视频队列已满，请稍后重试」；同期 agnes-com 为英文 `video queue is full`，两站点独立部署、消息各自本地化）；②轮询路径 `api.agnes-ai.cn/agnesapi` 零额度坐实——GET 假 video_id 返回 JSON 协议体（`{"error":{"code":404,"message":"任务不存在"}}`，与 com 站 `task not found` 同构），此前为文档推导，现已实测确认。中英文错误消息均命中冷却正则（`video_queue_full` 与「队列满」双保险）。视频队列两站点探测时点均满（R1 事实延续），native 样本采集仍待队列窗口。

**官方文档双站复核**（2026-10-07 07:00，产品负责人指定 agnes-video-25-flash 双站页 + tokenplan，实测拉取 .md 源逐节比对）：

1. **双站同构**：agnes-video-25-flash 与 tokenplan 两页内容完全一致，仅域名与币种差异（cn 现价 `¥0/秒`、com 现价 `$0/秒`，均为限时免费原价 0.15¥ / 0.025$ 每秒）。
2. **视频免费档限速**：允许发起 RPM 2 / **实际 RPM 1**；RPM 与每日秒数配额同时生效（tokenplan §5-§6；免费期计费 ¥0）。与代码注释口径一致。
3. **限制池规则（关键合规确认）**：限制按**密钥类型**共享，同类型多密钥**不叠加**额度（tokenplan §8 明示「不用于叠加使用限制」）；但 agnes-cn（api.agnes-ai.cn）与 agnes-com（apihub.agnes-ai.com）是**两套独立部署**（域名/本地化/限制池各自独立）→ 双 provider 轮转是官方口径下合规的额度利用方式，非同站多密钥绕限。
4. **轮询最佳实践**：官方建议 1–2 秒一次直至 completed/failed；keyframe 模式**必须**带 `model_name` 查询（代码恒带 ✓）；以 `status`/`progress` 为准、忽略 `internal_*` 字段（代码已按 status 判定 ✓）；我们 3s 轮询处保守侧，不超速且覆盖建议区间下限的 1.5 倍冗余。
5. **Flash 专属校验**：`size` 固定字符串 `"720P"`、`images` ≤5、`audios` ≤3、`videos` 不支持（代码 `size:'720P'` 硬编码 ✓、keyframe 模式仅传 first_frame ✓）；校验失败不建任务不计费。
6. **遗留风险（first_frame 形态）**：文档口径 first_frame 为「可公开访问的 URL」；生产传 data URI（base64）——已通过 Flash 校验层（实测返回 503 队列满而非 400，说明未被校验拒绝），但**推理层是否接受 data URI 待队列窗口验证**（native 历史零成功均在提交层失败，无推理层证据）；本地环境无公网 URL 托管能力，data URI 是当前唯一可行形态，风险如实入档。
7. **历史失败复盘佐证**：Generation 记账 15 条 agnes video.shot 失败呈延迟双峰——~20.5s（队列满+内部退避重试耗尽）与 ~200ms（非队列满错误立即抛出，与 RPM 1 下 429 形态吻合：21:12 时 6 次调用挤在 3 秒内）；失败原因此前未持久化（`generationLog.append` 丢弃 `input.error`），已修复——失败原因现写入 `outputJson.error`，为 429 冷却调试提供数据源。

**运维口径**：`node scripts/m15/probe-channels-now.mjs`（LLM 逐行 + TTS，近零消耗）；`--full` 追加 Image（每行 1 张）与 Video 队列（每行 4s 每日额度）探测；`--video` 仅 Video 队列（最小额度验证轮询路径）。另有零额度轮询路径探测：`node scripts/m15/probe-video-poll-path.mjs`（GET 假 video_id，不提交任务不耗每日配额）。
