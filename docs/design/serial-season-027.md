# 027 · 连续剧分集架构（Serial Season）——50 分钟长片的正确打开方式

> 战役目标（产品负责人指令，2026-10-13）：
> 「如果用户创建 50 分钟的短视频，你打算怎么做？是要分集的，每集 1-2 分钟，
> 要连贯一致性，不能飘逸，其他的你来定，把它设定目标做好。」

## 0. 问题定义

用户输入「做一个 50 分钟的短视频」（一部连续剧/短剧集）。当前系统的真实行为：

| 层 | 现状 | 对 50 分钟请求的实际后果 |
|---|---|---|
| 意图层 | `duration = min(300, 分钟×60)`，秒级钳 180 | 「50分钟」被静默吞成 300 秒，用户无感知 |
| 镜头规划 | `planShotCount` 封顶 8 镜，单镜 ≤12s | 300 秒请求实际只产出 ~96 秒内容 |
| 结构表达 | Content→Version→Story→Scene→Shot 单集结构 | 无法表达「季/集/悬念链」 |
| 一致性 | lookBook/visualAnchor 随单集 Story 生成 | 每集重新发明人物 → 跨集必然飘逸 |
| 供给 | 视频 RPM=1 | 50 分钟全 native 视频物理不可能（~200镜×61s） |

**结论：长片需求在意图层就被吞掉，即使放行也无法正确表达与执行。需要分集架构。**

## 1. 核心设计：季圣经（Season Bible）一次冻结，全集引用

```
Intent「50分钟」(duration=3000, serial)
  └─ Season.plan Job（一次 LLM 调用）
       └─ Season Bible（冻结落盘）
            ├─ seasonLogline（整季一句话）
            ├─ characters[]（visualAnchor 字节串冻结——25 集共用同一份）
            ├─ lookBook（全季视觉圣经——冻结）
            ├─ recurringLocations[]（locationAnchor 冻结）
            ├─ acts[]（章节幕：每幕 5 集左右，幕有幕功能）
            └─ episodes[]（每集 title/synopsis/cliffhanger/情绪节拍/用哪些人物与场景）
                 └─ Episode 1..N（每个 = 一个独立 Content，走既有单集全链路）
                      └─ story.draft / storyboard.plan 注入圣经约束（锚点原样引用，禁止重新发明）
```

**三个关键决策（其他的我来定）：**

1. **Episode = 独立 Content**（`contentType: 'episode'`，挂 `seasonId`）
   - 完整复用既有单集状态机、Job、渲染、分享——每集从 IDEA→READY 走既有全链路，零新状态
   - 每集独立成片（1-2 分钟），用户边看边出，不用等全季
2. **分集几何**：50 分钟 → 25 集 × 120 秒（每集 90-120s，`planSeasonGeometry` 纯函数，见 §2）
3. **防飘逸 = 三层防线**（见 §4），第一层是代码保证而非 prompt 祈祷

## 2. 分集几何（纯函数，零 LLM）

`planSeasonGeometry(totalSec, hint?)`：
- 每集时长 `episodeSec`：目标区间 [90, 120] 秒（产品口径「每集 1-2 分钟」）
- `episodeCount = round(totalSec / episodeSec)`，再回算 `episodeSec = totalSec / count` 归一
- 边界：totalSec < 240（4 分钟）→ 不分集（单集短片走既有路径）；≥ 240 → serial
- 上限保护：episodeCount ≤ 60（一小时 60×60s 极端；50min→25 集远在界内）
- 50 分钟（3000s）→ 25 集 × 120s；8 分钟（480s）→ 4 集 × 120s；5 分钟 → 单集
- 用户说「每集 1 分钟」→ hint 覆盖 episodeSec=60

## 3. 季圣经生成（一次 LLM，Zod 硬校验）

`SeasonBibleSchema`：
- `seasonLogline`：整季故事一句话（含欲望与障碍）
- `characters[]`：复用 CharacterSheet（name/desire/obstacle/arc/wardrobe/visualAnchor）——**visualAnchor 生成后冻结**
- `lookBook`：全季视觉圣经（≤40 词英文）——冻结
- `recurringLocations[]`：`{ name, locationAnchor, timeOfDay? }`——场景库，冻结
- `acts[]`：`{ title, function, episodeRange }` 章节结构（25 集 ≈ 5 幕）
- `episodes[]`：`{ index, title, synopsis (≤60字), cliffhanger (≤30字，末集可空), emotionBeat, charactersUsed[], locationsUsed[] }`

**悬念链规则**（短剧手法库的「卡点三钩」已经入库，此处结构化）：每集结尾必须有 cliffhanger（大结局除外）——反转预告/危机升级/情感悬念三型。

## 4. 防飘逸三层防线（不能飘逸 = 可验证的不变量）

**L1 配方层（代码保证——锚点字节一致）**
- Bible 落盘后锚点串（visualAnchor/locationAnchor/lookBook）为唯一事实源
- 每集 story.draft / storyboard 的 prompt 里锚点由**代码注入 bible 原文**，LLM 只被允许「引用」不允许「改写」
- 每集 StorySnapshot.characters 是 bible 人物表的深拷贝；`shot-prompt.ts` 组装 imagePrompt 时锚点取自 structure（与 bible 字节一致）
- **anchorHash**：bibleJson 的 sha256 前 16 位，存 Season 行；每集 structure 落盘时可对账（漂移=可检测的账本事件）

**L2 评审层（VLM in-loop）**
- 既有质量门四维评审（characterMatch/sceneMatch/styleMatch/defects）以锚点为证据——锚点同源 ⇒ 评审口径跨集同源
- （后续战役）跨集参考帧抽查：第 1 集主角定妆镜 vs 第 N 集，VLM 二图对比

**L3 账本层**
- 每集 Generation 已落 promptHash/attempt；Season 级 anchorHash 提供漂移检测的对照基准

## 5. 供给策略（诚实分层，RPM=1 的物理现实）

- **图片**（RPM 10）：25 集 × ~8 镜 = ~200 图 ≈ 20-30 分钟墙钟，断点续跑已有
- **视频**（RPM 1）：每集 hook + climax 关键镜 native（每集 ≤2 次 × 61s 间隔），其余镜头 composition（静图+运镜+转场，既有机制）——**这是设计选择而非失败回落**（与被取缔的「视频失败悄悄回落 Ken Burns」语义不同：分集供给计划在规划期就明示）
- **进度体验**：每集独立成片独立发布；季页面显示 N 集进度网格（后续战役 UI）

## 6. 实施切片（本战役 = 能力链完整落地）

| # | 模块 | 内容 |
|---|---|---|
| 1 | `src/core/content/season-geometry.ts` | 分集几何纯函数 |
| 2 | `src/ai/planning/season.ts` | SeasonBibleSchema + generateSeasonBible + 冻结工具 |
| 3 | `prisma/schema.prisma` | Season / Episode 模型 + migration |
| 4 | `src/ai/intent/engine.ts` | 分钟钳制 300→3600；duration≥240 或关键词 → serial |
| 5 | `src/ai/planning/story.ts` | draft/storyboard 增 `opts.season`（圣经注入，锚点原样引用） |
| 6 | `src/core/content/shot-prompt.ts` | structure 携 season bible 时锚点以 bible 为准 |
| 7 | `src/core/planning/season-service.ts` | planSeason：bible 生成 → Season 落盘 → Episode Contents 创建（Intent 合成） |
| 8 | `workers/pipeline-executor.ts` + job 注册 | `season.plan` Job（计算型，仿 revision.plan 范式）；story.draft 接 bible 注入 |
| 9 | API | `POST /api/contents/[id]/season/plan` + `GET ?jobId=` 轮询（既有范式） |
| 10 | 测试 | 纯函数全分支 + 注入断言 + **3 集迷你季集成**（fake provider） |

**明确不做（后续战役，诚实记录）**：季进度 UI 网格、全季连播拼片、跨集参考帧 VLM 抽查、季级断点续跑编排（逐集自动入队下一集）。

## 7. 验收标准

1. **单元**：`planSeasonGeometry` 全分支（50min→25×120s；4min→单集；hint 覆盖；上限保护）
2. **集成（fake provider，3 集迷你季）**：
   - 全季 3 集的 `structure.story.characters[].visualAnchor` 与 bible **字节一致**（`expect(a).toBe(b)` 级别的断言）
   - 每集 `cliffhanger` 非空（末集除外）；synopsis 与集序号单调对应
   - 每集镜头总时长 ≈ episodeSec（±15%，复用既有预算纪律）
   - `anchorHash` 全季一致
3. **回归**：全量测试 ≥250 绿；非 serial 路径零行为变化（单集短片 prompt 与旧版逐字一致的既有纪律保持）
4. **真实冒烟**：一次真实 `season.plan`（agnes LLM），bible 通过 Zod 校验落盘
