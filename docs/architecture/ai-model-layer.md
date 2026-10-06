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
