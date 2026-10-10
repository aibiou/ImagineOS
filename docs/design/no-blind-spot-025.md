# 025 · 全方位无死角提升——设计文档

> 依据：产品负责人「好，继续全方位无死角的提升」。
> 输入：worklog gate-e2e-024 / quality-repro-023 / ux-plan-async-022 的全部「已知边界」清单。
> 纪律：先设计后动手；每个缺陷修在根因上；验收三层证据（代码/账本/浏览器）。

## 0. 死角盘点（从三个里程碑的遗留清单汇聚）

| # | 死角 | 来源 | 用户可感症状 |
|---|------|------|--------------|
| D1 | 景别遵从度：prompt 要求特写、模型给中景；变体重抽的构图 nudge 太软 | 024 镜4 实战（15 次图像全灭根因之一） | 成片景别与分镜表不符，导演意图丢失 |
| D2 | directions（选方向）仍是同步分钟级 LLM：429 冷却时前端裸等 150s 超时 | 022「directions/intent/revision-plan 仍同步」 | 「半天没反应」的老病，最后一处 |
| D3 | revision.plan（修订定位）同步等待，且换反馈重提时无并发防护 | 022 同上 | 修订对话框长转圈；改主意重提语义不明 |
| D4 | worker 单循环串行：规划 Job 排在 10–50 分钟视频生成 Job 后饿死 | 022「worker 单循环串行执行规划 Job」 | 第一部片子在生成时，第二部片子的方向/故事排队不动 |
| D5 | 范例库只做同片参考帧，跨项目的 prompt 写法经验不复利 | 023「跨项目风格 few-shot 留待后续」 | 每个新项目都从零学「怎么写能过门」 |

## 1. 战线一：景别遵从度闭环（D1）

### 1.1 根因
- `imagePromptFor` 的景别短语在 prompt 中部（`{base}. Framing: ...`）——图像模型对 prompt 开头的注意力最高，中部指令权重弱。
- `variantImagePrompt` 的 nudge 是通用三选一（"Recompose the shot…"），不含该镜的景别硬要求——重抽与首抽同权，模型大概率复犯。

### 1.2 设计
1. **首抽前置**：`imagePromptFor` 把景别指令挪到最前：`Framing requirement: close-up shot, face and shoulders fill the frame. {base}. …`（尾部原有 Framing 保留，双保险）。
2. **重抽硬指令**：`variantImagePrompt` 增加第 4 参 `framing?: string`——存在时前置 `FRAMING (mandatory): ${framing}.`；调用点从 `facts.shotSize` 传入（门事实与执行同源）。
3. **门反馈信号**：门 verdict 不需结构化「景别不符」标注——凡 pass=false 或 technical 低分触发重抽，景别硬指令一律生效（确定性，不赌 VLM 的标注纪律）。

### 1.3 验收
- 单测：前置位置断言 + 变体含 mandatory 景别指令断言 + 无 shotSize 时零注入（向后兼容）。
- 账本：E2E 轮次的 promptSummaryOf 里首镜 prompt 以 `Framing requirement:` 开头。

## 2. 战线二：规划 LLM 全 Job 化（D2+D3）

### 2.1 directions（intent.directions Job）
- 路由 `POST /directions` 改入队即返回 `{ jobId }`；`planService.startDirections()` 幂等（activeJob 复用——含 regenerate 场景：旧批还在跑时「换一批」返回 alreadyRunning，等本批出来再换，语义诚实）。
- 执行器 `executeDirectionsJob`：状态守卫（INTENT，不符幂等 skipped）→ generateDirections → saveDirections → complete。
- 前端：auto-fire 改「入队即返回，轮询接续」；`generating` 轮询条件已含 `jobActive`（任何活跃 Job）→ 自动生效；失败态扩展 directionsPending 判定 + 重试入口。

### 2.2 revision.plan（revision.plan Job，计算型 Job 首例）
- 特性：不推进状态机（REVIEW 原地）；结果存 Job.outputJson `{ plan, structure, feedback }`。
- **并发语义（新机制：supersede）**：同 feedback 活跃 Job 复用；不同 feedback → 旧 Job 标记 `failed`（error=「已被新的修订请求取代」，不可重试——直接终态写，不走 fail() 重试路径）+ 入新 Job。
- **complete() 竞态加固**：complete 增加 `status in (claimed, running)` 条件（与 markRunning 同款）——被 supersede 的 Job 即使 LLM 已返回也翻不回 succeeded。
- 前端对话框：POST 返回 `{ jobId }` → 专用轻量端点 `GET /revision/plan?jobId=` 轮询 → succeeded 取 output；failed/superseded 显示可重试错误；等待期用修订版叙事卡（REVISION_WAIT 文案）。
- `jobService.getJob(jobId)` 只读查询（含 status/error/outputJson）。

### 2.3 worker 双通道（D4）
- `claimNext(types?: string[])` 参数化过滤。
- `PLANNING_JOB_TYPES = ['story.draft', 'storyboard.plan', 'intent.directions', 'revision.plan']` 独立循环；其余类型（video.storyboard/video.render）原循环。乐观锁 claim 天然防双通道互踩。
- 效果：视频生成再长也不阻塞第二个作品的规划链（022 场景「多作品并行创作」解锁）。

### 2.4 验收
- 单测：入队语义/幂等/状态守卫/supersede 终态不可翻/双通道类型过滤互不领取。
- E2E：真实管线跑 directions 异步链（POST 秒回 → 轮询出方向）；修订链换反馈 supersede 实证。
- 浏览器：agent-browser 走查等待叙事卡与失败重试入口。

## 3. 战线三：经验复利跨项目激活（D5）

### 3.1 设计
- `exemplarService.topPromptsForTeaching(limit=3)`：跨项目按分降序，返回 `{ imagePrompt, score, summary }`（资产不加载——只教写法，不做图比对）。
- `generateStoryboard` 增可选参 `exemplarPrompts`：storyboard system prompt 追加「已验证的高分写法范例」段（≤3 条，含分数），教 LLM「主体前置、光线具体、环境锚定」的真实过门写法。
- 架构边界：core/quality 查 DB（服务层本分）；src/ai 的 story.ts 只收字符串数组注入 prompt，不触 DB。

### 3.2 闭环语义
高分镜头沉淀（023）→ prompt 写法反哺新项目分镜（本轮）→ 新项目首抽更易过门 → 高分沉淀加速——经验复利从「同片参考帧」扩展为「跨项目写法遗传」。

### 3.3 验收
- 单测：topPromptsForTeaching 排序与截断 + prompt 注入段存在性 + 空库零注入（向后兼容）。
- 账本：E2E storyboard Job 的 Generation 账本 promptSummary 含范例段。

## 4. 实施顺序与回归

1. 战线一（纯函数，小）→ 测试
2. 战线三（纯函数+服务查询，小）→ 测试
3. 战线二后端（jobService/plan-service/执行器/路由）→ 测试
4. 战线二前端（page.tsx 等待/轮询/对话框）+ 战线四（worker 双通道）→ 测试
5. 门禁：vitest 全量 + tsc + eslint
6. E2E（按供给状态定深度）+ agent-browser 走查
7. commit → push → ls-remote 核实 → worklog

## 5. 风险与对策
- revision.plan Job 化引入新并发面 → supersede 直接终态写 + complete 条件化，双保险；单测锁定「被取代的 Job 不可翻回 succeeded」。
- 双通道 worker 改动调度核心 → claimNext 过滤是纯增量（不传参=旧行为），既有 27 个 job 测试全量回归。
- 范例注入增长 prompt 体积 → ≤3 条 + 每条截断，方向/故事 prompt 不注入（只有分镜层需要写法教学）。

## 6. 实战记录（2026-10-10 真实管线走查）

- **E2E 揪出两处实现缺陷当场修复**：①`parseJobPayload` 白名单漏 `feedback` 字段——Job 入库正确但执行器读不到（「修订反馈缺失或太短」），补透传 + 回归测试；②`promptSummaryOf` 只记 `p.prompt`（用户侧）不记 `p.system`——规划层的教学/范例注入从无账本证据，补 system 截断 2000 字采集（020 的「注入证据」纪律延伸到规划层）。
- **战线二实证**：POST /directions 858ms 入队即返（旧同步链分钟级）→ 轮询 3 方向零刷新出现 → 期间 bundle.job.type=intent.directions（双通道领取）；revision.plan 运行中重提 → 旧 Job failed（「已被新的修订请求取代」）+ 新 plan 到达（targetLevel=audio 正确定位旁白语气层）；账本两行互证（一条 succeeded 一条 superseded-failed）。
- **战线三实证**：分镜 Generation 账本 system 摘要 2001 字含「已验证的高分写法范例」段（4 条范例跨项目注入）；本轮生成中范例库 4→9（5 条新高分沉淀，其中首镜 8.35/9.3/9.1/9.3/9.3——景别前置后的首过率明显高于 024 基线的一次通过率 30%）。
- **战线一实证**：首个图像 Generation 账本 prompt 以 `Framing requirement: medium shot, waist-up framing.` 开头（前置兑现）；门重抽实战 attempts=2~3（择优保留 working：镜2 三次重抽后仍 5.45 → 诚实标注 pass=false 入库不冒充）。
- **浏览器实证**（1440×900 agent-browser）：方向等待卡「正在为你构思几个创作方向…/正在从你的想法里找三种不同的可能/已进行 3 秒/通常需要半分钟/完成后这里会自动出现——不用刷新页面」逐字渲染；方向网格零刷新自动出现；console 零错误；截图 ×3 入 download/ui-e2e/。
- **供给边界**：agnes 视频 queue-full（503）贯穿全程——Job 走诚实退避（retry=3，供给耗尽 ×8 窗口），6 镜中 4 镜 native 完成、图像全成。视频全成非本轮验证目标（024 已闭环），断点续跑就绪。
- **门禁**：235/235（+19）· tsc 0 错 · eslint 0 错。
