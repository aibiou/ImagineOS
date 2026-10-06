# Human Test Report — M1.5 Gate 7（真人表达测试）

> 文档地位：Gate 7 执行报告模板 · 真人执行前就绪，执行后填充
> 状态：**待人工执行**（本模板由系统侧预填充能力数据；凡未执行的字段一律标「未执行」，禁止预填虚构值）
> 对应计划：`docs/evaluations/human-test-plan.md`（16 人 / 30 分钟 / 六指标）

---

## 0a. Model Provider 执行环境（真人测试期间生效配置）

> 权威记录：`m15-expression-quality-report.md` §0.5。真人测试执行时系统实际路由（Registry 动态链，自定义优先 → 内置兜底）：

| 通道 | 首选（自定义） | 兜底（内置） | 说明 |
|------|---------------|-------------|------|
| LLM | `openai-compat:agnes-com` · `agnes-3.0-flash` | `zai-chat` | 自定义失败自动降级 |
| Image | `openai-compat:agnes-com` · `agnes-image-2.5-flash` | `zai-image` | 降级已实测（agnes 6 连败 → zai-image 接管） |
| TTS | —（无自定义，产品负责人指定 TTS 走内置） | `zai-tts` · `zai-tts-tongtong` | z-ai 配额间歇 429 时 narration 重试吸收 |
| Video | `openai-compat:agnes-com` · `agnes-video-2.5-flash` | `zai-video` · `cogvideox-3` | 仅 native 模式路径；agnes 队列满时自动降级内置视频 |

---

## 0. 系统侧就绪声明（2026-10-06 验证）

| 就绪项 | 验证方式 | 状态 |
|--------|----------|------|
| Session ↔ Content 关联 | 匿名会话（imagineos_sid cookie）→ User → Content.ownerId；`ContentVersion.createdBy` 记录每一次修订的操作者 | ✅ 已验证（DB 抽查） |
| 修订关联用户 | ContentVersion.createdBy + creationMethod=revision + changelog 保存用户原话 | ✅ |
| 发布记录 | Publication 表 + Provenance `published` 事件（终版 20 条发布在库） | ✅ |
| Remix 记录 | Remix 血缘三件套 + remixerId + 双侧 Provenance 事件（8 条在库） | ✅ |
| Repeat Creation 记录 | 同一 ownerId 多作品计数（`export-human-test.mjs` 自动推导 repeatCreation） | ✅ |
| 结果可导出 | `node scripts/m15/export-human-test.mjs --since="<测试开始时刻>"` → `state/human-test-export.json`（六指标汇总 + 每被试明细） | ✅ 实测可运行 |
| 测试作品批量 integrity check | `node scripts/m15/integrity-check.mjs <idsFile>`（idsFile 由导出结果提取 contentId，换行分隔） | ✅ 作用域机制实测 |
| composition / native 配置区分 | Generation 记账：type=video.shot 存在且 succeeded → native 镜头；导出结果含 nativeConfig 字段（native / native-with-fallback / composition-fallback） | ✅ |

**执行注意**：Alpha 默认 composition 路径；如本轮测试需含 native 样本，测试时段内 dev server 以 `IMAGINEOS_FORCE_NATIVE=1` 运行（切换方式：`bash scripts/m15/restart-dev.sh native`），并在 §1 记录配置。

---

## 1. 测试执行概况（人工填写）

- 执行时段：______（含时区）
- 应到 / 实到：____ / ____ 人（目标 16，起步线 10）
- 设备分布（手机/桌面）：____ / ____
- 运动路径配置：composition 全程 ／ native 全程 ／ 混合（说明）：______
- 观察员：______
- Provider 配额状态（测试时段）：______（如遇 429 长冷却需如实记录并暂停测试，不得带病出数据）

## 2. 主指标汇总（自动 + 人工编码各占一半）

### 2.1 系统侧自动指标（来自 human-test-export.json）

| 指标 | 数值 | 目标线 | 达标 |
|------|------|--------|------|
| Intent completion（系统侧代理：开场表达→完成首件作品创建） | 未执行 | — | — |
| 发布率（published/participants） | 未执行 | — | — |
| 修订参与率（revisedParticipants/participants） | 未执行 | — | — |
| Remix 参与率（remixedParticipants/participants） | 未执行 | — | — |
| 「我还想做一个」行为率（repeatCreationParticipants/participants） | 未执行 | ≥30% | — |

> 导出命令复现：`node scripts/m15/export-human-test.mjs --since="<§1 执行时段起点>"`

### 2.2 人工编码指标（观察员记录表转录）

| 指标 | 正 / 中 / 负 | 备注 |
|------|--------------|------|
| First result satisfaction（初稿首反应编码分布） | 未执行 | — |
| Intent completion（访谈确认「方向里有我想要的」） | 未执行 | — |
| 修订后满意度变化 | 未执行 | — |
| 未发布者理由分布 | 未执行 | — |

**主指标（一票汇总）**：Expression Success = Intent completion ∧ First result satisfaction ≥ 中 ∧ (Published ∨ 明确表达满意)

- 数值：未执行（目标 ≥50%）

## 3. 每被试明细（人工转录 + 系统导出合并）

（每行一人；系统侧字段由 export 自动生成，人工字段由记录表转录）

| # | 编号 | 表达原文（开场） | 到达方向耗时 | 首反应 | 修订轮数/类别 | 发布 | Remix | 还想做一个 | Expression Success |
|---|------|------------------|--------------|--------|----------------|------|-------|------------|--------------------|
| 1 | 未执行 | | | | | | | | |
| … | | | | | | | | | |

## 4. 质性发现（收尾访谈要点，人工填写）

未执行。重点记录：
- 被试自己的语言如何描述「这是什么」（产品认知）
- 最卡住的时刻与原话
- 对「旧版本随时可以找回」的理解程度
- 对「从这里开始创作」的理解（是否理解为「抄袭」vs「接力」）

## 5. 测试作品完整性复核（系统侧，测试结束后执行）

- 导出作品清单：______ 件
- `node scripts/m15/integrity-check.mjs <idsFile>` 结果：未执行（预期 0 错误 0 警告；如有告警逐条列出并归因）
- native 样本（若有）：nativeConfig 分布 ______

## 6. M2 范围决策矩阵应用（人工执行后填写）

| 结果模式 | 命中 |
|----------|------|
| Expression Success ≥50% 且「还想做一个」≥30% → M2 可进入内容传播侧 | 未判定 |
| Expression Success ≥50% 但「还想做一个」<30% → 瓶颈在内容传播侧，聚焦 Explore 分发与作品呈现 | 未判定 |
| Expression Success <50%，修订行为少 → 瓶颈在生成质量/Intent，聚焦 Native Video 与访谈优化 | 未判定 |
| 满意度高但发布意愿低 → 私域价值成立，优先私域分享链路 | 未判定 |

## 7. 结论（人工执行后填写）

未执行。
