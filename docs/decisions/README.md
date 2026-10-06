# Decision Log（ADR 索引与协议）

> 六个月后仍然能知道"为什么当初这么设计"的地方。

## 协议

- 每次重要产品/技术决策记录一个 ADR 文件：`ADR-<编号>-<slug>.md`
- ADR 状态：`Proposed`（待负责人确认）→ `Accepted` / `Rejected` / `Superseded`
- **只追加**：已 Accepted 的 ADR 不修改，被推翻时标记 Superseded 并指向新 ADR
- 触及产品北极星"禁改清单"的决策，状态只能是 Proposed，等待产品负责人

## ADR 模板

```markdown
# ADR-XXXX：<标题>
- 日期 / 状态 / 决策人
## 问题
## 背景
## 方案 A
## 方案 B
## 决定（或：推荐方案 + 理由）
## 影响
## 替代方案（为何不选）
```

## 索引

| 编号 | 标题 | 状态 | 日期 |
|------|------|------|------|
| [ADR-0001](./ADR-0001-alpha-video-generation-strategy.md) | Alpha 视频生成 Provider 策略：组合式管线优先 | **Accepted** | 2026-10-05 |
| [ADR-0002](./ADR-0002-repository-strategy.md) | 仓库形态：单应用 + 严格内部边界（逻辑 monorepo） | **Accepted** | 2026-10-05 |
| [ADR-0003](./ADR-0003-auth-strategy.md) | Alpha 认证：最小会话 + 完整 User 实体预留 | **Accepted** | 2026-10-05 |
| [ADR-0004](./ADR-0004-multi-model-provider-strategy.md) | 多模型服务 Provider 策略：用户可配置 OpenAI 兼容通道 | **Accepted**（负责人直接指令） | 2026-10-06 |

> 前三项决策于 2026-10-05 由产品负责人确认（随 D1/D2/D3 一并批准）；ADR-0004 于 2026-10-06 由负责人以「不因单一模型配额限制阻塞 ImagineOS」指令直接批准。
