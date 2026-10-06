# Evaluation（评测体系）

> 让模型、Prompt、Orchestrator、Revision 策略的每一次变更都可回归（§59–§60）。

## 评测维度（§59 子集，Alpha 落地）

| 维度 | 测什么 | 方法 |
|------|--------|------|
| Intent Eval | 自然语言→结构化 Intent 的字段准确率 | Golden 意图集 + 字段级断言 |
| Story Eval | 故事结构完整性/情绪弧/时长预算 | 结构校验 + 人工抽评（1–5 分） |
| Instruction Following | 生成是否遵守 Intent/Plan 约束 | 约束清单逐项断言 |
| Revision Eval | 修订定位准确率（改对对象、改对节点） | 修订语料表驱动（"第二个镜头太快"→shot[1].duration） |
| Latency Eval | 各环节耗时分布 | 埋点统计 |
| Cost Eval | 单次调用/单作品成本 | 成本记账表汇总 |
| Safety Eval | 输入过滤与生成内容安全 | 红线语料负例 |
| Character Consistency / Visual Quality | 组合式基线 | M4 起人工抽评，为未来模型对比留基线 |

## Golden Dataset（目标：≥100 条真实创作意图）

- 覆盖 §40 内容范式：生活记录 / 人物故事 / 旅行 / 回忆 / 梦境 / 情绪视觉化 / 微电影 / 知识视觉化 / 教学 / 公益 / 经验分享 / 纪录 / 原创角色 / 世界创造……
- 每条含：原始表达文本 / 期望 Intent 字段（含合法多解）/ 期望访谈问题方向 / 至少一条修订语料与期望定位
- 建设节奏：M1 起随开发积累（先 20 条启动），M4 达 100 条

## 回归触发器（每次必跑）

换模型 / 换 Prompt / 换 Orchestrator / 换生成策略——一条命令输出 GoldenRun 报告（成功率、字段准确率、修订定位准确率、平均成本、P50/P95 延迟），与上一 Run 对比，回归超阈值阻断合并。

## Model Provider 执行环境（M1.5 收口期）

> 权威记录：`m15-expression-quality-report.md` §0.5。系统经「设置 → 模型服务」支持 OpenAI 兼容自定义 Provider（ADR-0004），Registry 动态链：自定义优先（priority 升序）→ 内置 z-ai 兜底，失败自动降级。M1.5 收口期真实配置：

| 通道 | 自定义（首选） | 内置（兜底） |
|------|---------------|-------------|
| LLM | `openai-compat:agnes-com` · `agnes-3.0-flash` | `zai-chat` |
| Image | `openai-compat:agnes-com` · `agnes-image-2.5-flash` | `zai-image`（降级已实测） |
| TTS | —（产品负责人指定 TTS 走内置） | `zai-tts` · `zai-tts-tongtong` |
| Video | `openai-compat:agnes-com` · `agnes-video-2.5-flash` | `zai-video` · `cogvideox-3` |

> 换 Provider/模型属回归触发器范围：任何通道变更后须重跑 GoldenRun 并在报告中标注新 Provider 信息（用户指令：所有评测报告须标注每个通道的真实 Provider/Model）。评估标准不随 Provider 变更而修改。

## Alpha 指标（§61–§62，M5 起可计算）

- **Expression Success Rate（北极星）**：输入意图→完成自认可作品
- 诊断：Intent Completion / First Creation Success / Revision Success / Publish Rate / Repeat Creation / Remix Rate / 各步骤流失漏斗
- 成本：单成功作品平均成本 =（模型 + 媒体 + 存储 + 带宽）
