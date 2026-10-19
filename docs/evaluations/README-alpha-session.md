# /docs/evaluations — 评测体系（Brief §59/60/80）

## 目标

让模型、Prompt、Orchestrator、Revision 策略的每一次变更都可回归、可对比。评测是 ImagineOS 的长期资产（charter §12）。

## 评测维度（对应 Brief §59）

| 维度 | 度量对象 | 自动化 |
| - | - | - |
| Intent Eval | NL → Intent Object 的抽取成功率/schema 合法率/默认合理性 | 自动 |
| Story Eval | 结构完整性（Story→Scene→Shot）/时长达标/与 Intent 一致性 | 自动 + 人审 |
| Visual Quality | 分镜图像质量（抽样） | 人审 |
| Character Consistency | 同角色跨 shot 外观一致性 | 人审 + 抽样 |
| Instruction Following | 修订指令定位准确性 | 自动（Golden 修订集） |
| Revision Eval | 修订最小扰动（改 shot 不动 story） | 自动 diff |
| Latency Eval | 各阶段耗时分布 | 自动 |
| Cost Eval | 单成功作品平均成本 | 自动（job 成本字段聚合） |
| Safety Eval | 内容安全边界 | 自动关键词 + 抽样人审 |

## Golden Dataset 计划（Brief §60）

- 规模：≥100 真实创作意图。
- 覆盖：生活 / 人物 / 故事 / 知识 / 情绪 / 想象 / 商业 / 纪录（八类各 ≥10）。
- 结构：`intent_nl / expected_intent_fields / expected_direction_count / golden_revision_cases`。
- 位置（Phase 17 建立）：`tests/golden/*.json`，harness 一键回归并输出对比报告。
- 积累方式：Epic 3/4/8 完成时各贡献首批 ≥10 例（T3.6 / T4 验收 / T8 Golden 修订集 ≥20 例）。

## 触发回归的变更

换 Provider / 换模型 / 换系统 Prompt / 换 Orchestrator 策略 / 换修订解析策略。
