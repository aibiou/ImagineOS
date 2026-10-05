# Ideas（想法登记簿）

> 防止项目做着做着忘记最初目标。每个新想法先登记，再决定做不做、何时做。

## 协议

新想法一律登记为条目（文件或本 README 列表），必填六字段：Idea / Problem / Why It Matters / Product Layer / Status / Decision & Reason Not Now。

## 状态机

```text
Candidate → Validated → Planned → Building → Shipped
                ↘ Rejected / Future（搁置但记录）
```

Roadmap 纪律（§90）：每个新 Feature 必须回答——服务哪个用户？解决什么问题？属于哪个产品层？是否增强人类表达能力？是否支持 Content Object？是否影响未来 Social/World？为什么现在做？

## 当前登记

| ID | Idea | Product Layer | Status | Decision |
|----|------|---------------|--------|----------|
| I-001 | For You to Create：不只推荐"看什么"，还推荐"你可能创造什么" | Social (Stage 3) | Future | Alpha 只做基础 Explore + 埋点；推荐创造需要创作行为数据积累 |
| I-002 | My AI Creator：AI 逐渐了解用户审美/表达习惯/常用角色 | Studio (Stage 2) | Future | Alpha 只留 CreatorPreferences 表；记忆系统等表达数据规模化后启动 |
| I-003 | 外部视频模型接入（端到端文生视频） | Creation | Future | 见 ADR-0001 升级触发条件 |
| I-004 | 交互式故事 / 新内容原子（§41） | World (Stage 4) | Future | 先完成视频原子；等 Social 层数据反馈 |
| I-005 | C2PA / Content Credentials 正式对接 | Trust | Planned(M4) | Provenance 结构按可映射设计（§34），M4 落结构不落合规 |
| I-006 | 语音/图片/视频素材输入的完整意图理解 | Creation | Future | Alpha 打通 Text；UI 预留多模态入口 |

## 模板

```markdown
- ID: I-0XX
- Idea:
- Problem:
- Why It Matters:
- Product Layer:
- Status: Candidate
- Decision / Reason Not Now:
```
