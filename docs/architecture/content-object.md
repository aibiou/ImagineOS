# Content Object（内容对象模型）

> 文档地位：核心领域模型文档 · GitHub 主事实源
> 源文件：架构理解报告附录 B + `prisma/schema.prisma`（19 表，§47–§52）
> 定稿：2026-10-06

## 1. 一句话

> **MP4 是棺材，Content Object 是基因。**

Content Object 是 ImagineOS 的核心资产：一件作品的表达意图、创作结构（配方）、全部生成产物、版本历史、血缘关系与来源记录的活集合。MP4 只是它某一版本的一种呈现。

## 2. 结构（11 个层次）

```text
Content（作品：状态机 + 可见性 + remixPermission + currentVersionId 现势指针）
├── Intent（用户原话 rawExpression + 结构化字段 + 访谈状态；字段级 source: user|ai_default）
├── CreativePlan（2–4 创作方向 → selectedDirectionId → 概念冻结 concept）
├── Story → Scene → Shot（工作副本；imagePrompt/cameraMotion/durationMs/narrationLine/emotion/motion）
├── ContentVersion（不可变密封快照：structureJson 配方 + changelog + parentVersionId 血缘链）
├── Asset（content-addressed：original|generated|derived|preview|thumbnail|final）
├── Generation（每次 provider 调用记账：type/provider/model/status/latency/cost）
├── GenerationJob（DB 持久化队列：queued→claimed→running→succeeded|failed|timeout）
├── Permission（view|edit|remix 能力授权）
├── Provenance（只追加事件流：人类/AI/系统行为全记录）
├── Remix（血缘三件套）
└── Publication（发布通道）
```

## 3. 六条数据不变量（仓储/服务层强制，tests/ 断言）

| # | 不变量 | 落地机制 |
|---|--------|----------|
| I1 | ContentVersion 一经创建不可变 | 版本仓储不暴露 update 方法（结构性不可变）；修订=新版本 |
| I2 | Remix 永远创建新 Content + 新 Version + 血缘三件套 | fork-service 单事务；原作字段级零改动（测试断言） |
| I3 | Provenance 只追加 | 仓储无 update/delete 面语义 |
| I4 | 领域表不含 provider/model 名 | 白名单区仅 Generation/GenerationJob/Provenance(ai 事件) |
| I5 | Intent 结构化字段携带 source 标记 | schema 预留，用户说的 vs AI 默认可区分 |
| I6 | Content.currentVersionId 唯一现势指针 | 历史版本永远可寻址（restore=以旧版配方新建版本） |

## 4. 双状态机

**创作状态机（Content.status）**：

```text
IDEA → INTENT → PLANNING → STORY → STORYBOARD → GENERATING → REVIEW
→ RENDERING → READY → PUBLISHED
```

- 转移表纯函数（`core/content/state-machine.ts`，6 测试）
- 失败不回滚（§51）：Job 失败原地留态，恢复后继续
- 回退路径：REVIEW→GENERATING（修订/换画面）；PUBLISHED 可继续修订（新版本）

**Job 生命周期（GenerationJob.status）**：`queued → claimed → running → succeeded | failed | timeout`（乐观锁 claim + 租约超时 requeue）

## 5. 版本语义

| creationMethod | 语义 | changelog 示例 |
|----------------|------|----------------|
| initial | 初稿配方 | 初稿配方 |
| revision | 修订（自然语言反馈→定位→局部修改） | "再温暖一点" |
| regenerate | 结构未变重跑（同配方新像素） | 调整了创作结构，重新生成 |
| restore | 恢复旧版（=以旧配方新建） | 回到第 2 版 |
| remix | 从他人作品开始（配方继承） | Remix 自《xxx》v3 |

## 6. Remix 血缘三件套（§35）

```text
Remix {
  derivativeContentId   → 新作品
  derivativeVersionId   → 新作品首版（method=remix）
  sourceContentId       → 原作（零改动）
  sourceVersionId       → 原作被 fork 的具体版本
}
```

- 衍作状态 READY（可再发布位继续）；配方 structureJson 完整继承
- Intent rawExpression 复制（新作者的起点语境）
- Provenance 双侧记录：原作侧 `remixed`、衍作侧 `remix_received`（诞生事件，替代 content_created）

## 7. 镜头配方（ShotSnapshot，随版本密封）

```ts
{
  index, visualDescription, imagePrompt,      // 画面（英文提示词，执行配方）
  cameraMotion,                                // zoom_in|zoom_out|pan_left|pan_right|static
  durationMs, narrationLine, emotion,
  motion?                                      // 'composition'（缺省）| 'native'（M1.5 双路径）
}
```

`motion` 由管线/评估层调度，不由 LLM 决定——模型选择不出现在业务层。

## 8. 完整性检查（M1.5 Gate 5）

数据库级六表关系检查脚本：`scripts/m15/integrity-check.mjs`（Content/Version/Asset/Generation/Provenance/Remix + 文件落盘 + 血缘 + 事件覆盖），输出 Content Integrity Report 的数据源。任何 UI 改动后应重跑。
