# 信任层（Trust：权限 · 溯源 · 血缘）

> 文档地位：信任架构文档 · GitHub 主事实源
> 源文件：架构理解报告 §32–§36 + `src/core/repositories/{provenance,remix}-repo.ts` + fork-service
> 定稿：2026-10-06

## 1. 为什么需要信任层

AI 生成内容的平台必须能回答三个问题：

1. **这件作品是谁的？**（权限与所有权）
2. **它是怎么来的？**（AI 参与了什么、来源是什么——Provenance）
3. **它从哪件作品生长出来？**（Remix 血缘）

Alpha 阶段的最小可信实现已经全部落地；完整 Trust 层（E13）在后续里程碑扩展。

## 2. 权限（Permission）

```text
Permission { contentId, granteeId?(null=默认策略), capability: view|edit|remix, constraintJson? }
```

- Content 级开关：`visibility`（private/unlisted/public）+ `remixPermission`（allow/deny）
- Remix 前置检查：`remixPermission !== 'allow'` → RemixNotAllowedError（403）
- 自 Remix 禁止（修订请走版本系统）
- 不可见与不存在同语义（防枚举探测）

## 3. 溯源（Provenance，不变量 I3：只追加）

事件流（仓储无 update/delete）：

| eventType | 记录侧 | actorType |
|-----------|--------|-----------|
| content_created | 新作品 | human |
| version_created | 该作品 | human/ai |
| version_restored | 该作品 | human |
| status_changed | 该作品 | human/system |
| ai_generated | 该作品 | ai（provider/model 白名单区） |
| published / unpublished | 该作品 | human |
| remixed | **原作侧**（被谁 Remix） | human |
| remix_received | **衍作侧**（从哪来 = 诞生事件） | system |

- 每件作品的全生命周期可重建（M1.5 Gate 5 检查项）
- ai 事件允许携带 provider/model（§34 白名单）——领域表其余位置禁止
- 时间线单调（并列写入可接受，检查器弱断言）

## 4. Remix 血缘（不变量 I2）

见 `docs/architecture/content-object.md` §6。信任语义要点：

- **原作零改动**：fork 事务内不修改源作任何字段（字段级 diff 测试断言）；原作侧只追加 `remixed` 事件
- **衍作完整诞生记录**：`remix_received`（含 sourceTitle/sourceVersionNumber）+ 首版 method=remix + changelog「Remix 自《xxx》v3」
- 血缘可查：`GET /api/contents/:id` 返回 remixOf（前端展示「从《xxx》开始」）

## 5. AI 参与的透明呈现

- 每件公开作品的卡片带「AI 参与创作」标识（用户语言：AI 参与，非模型名）
- 全部生成调用落 Generation 记账（provider/model/latency/cost）——审计与成本归集的统一数据源
- 用户指定 vs AI 默认：Intent 字段级 source 标记（I5）

## 6. 已知边界（Alpha）

- User 硬删除存在外键约束（Remix.remixer/ContentVersion.creator 无级联）→ Alpha 用软删除语义，正式处理留 E13
- 内容安全 / 版权 / 真人数字分身政策属"必须升级给人的决策"（宪法 §9）
- 数据库级完整性由 `scripts/m15/integrity-check.mjs` 批量复核（M1.5 起为常规检查）

## 7. 用户语言呈现

| 信任概念 | 用户看到的 |
|----------|-----------|
| Provenance | 「每一件作品都带着它的完整来路」 |
| Remix 血缘 | 「从《xxx》开始」/「从这里开始创作」 |
| AI 参与 | 「AI 参与创作」徽标 |
| 版本历史 | 「初稿 / 第 2 版 · 共 3 版」+「回到这一版」 |
