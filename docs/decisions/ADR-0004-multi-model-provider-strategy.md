# ADR-0004：多模型服务 Provider 策略（用户可配置的 OpenAI 兼容通道）

- 状态：**Accepted**（产品负责人 2026-10-06 直接指令：「不要因为单一模型 quota 限制阻塞 ImagineOS……现在先实现最小闭环」）
- 日期：2026-10-06
- 关联：ADR-0001（视觉生成策略 · 双路径）、ADR-0002（架构边界）

## 背景

M1.5 收口阶段暴露了一个工程级瓶颈：内置 Provider（z-ai 平台通道）在 ~360 次/日的评测消耗后进入小时级配额冷却（429），Gate 3/4/p10/Native Golden Case 四项行为链证据被阻塞。等待恢复违背「不因单一模型配额限制阻塞 ImagineOS」的原则；同时，产品终局本身就需要多模型 Provider 支持（Master Brief 模型层可整体替换）。

## 决策

1. **新增「设置 → 模型服务」页面**（`/settings/models`）：用户可配置外部 OpenAI 兼容服务（LLM / 图像 / 视频 / 配音四通道），字段含服务商、模型名、密钥、接口地址、启停、优先级、连接测试。
2. **Model Router 候选链配置驱动**：每次路由调用前按 `ensureChainsFresh()` 同步——启用的自定义配置按优先级升序排前，内置 z-ai 恒为兜底尾位；单 provider 确定性失败（401/403/不兼容协议）跳过重试立即降级。
3. **领域边界不动**：配置领域服务落 `src/core/settings/`（仅依赖 db + 纯 fetch）；适配器落 `src/ai/providers/openai-compat.ts`（纯 fetch，零 SDK 依赖）；业务层铁律不变——仍然只声明能力需求，永不出现 provider/model 名。
4. **记账诚实**：Generation 表记录的 provider/model 是实际服务方（`openai-compat:<显示名>` / 用户配置的模型名），fallback 切换如实可见。
5. **密钥处理（Alpha 取舍）**：明文存 SQLite（单租户沙箱），API 返回一律打码（前3后4），掩码回传 = 不修改；正式密钥管理（加密/KMS/按用户隔离）留给 Trust 层阶段。
6. **视频通道实验性**：自定义视频按 SiliconFlow 风格 `video/submit + video/status` 轮询实现；不兼容的服务商会得到明确的「未返回 requestId」错误并自动降级——不假装支持。

## 实现要点

| 层 | 落点 | 说明 |
|---|---|---|
| 数据 | `prisma/schema.prisma → ModelProviderConfig` | 纯新增表（无破坏迁移）；`channel+enabled+priority` 索引 |
| 领域 | `src/core/settings/provider-config-service.ts` | CRUD + zod 校验 + 打码 + 连接测试（GET /models 零消耗）+ 变更通知 |
| AI | `src/ai/router/provider-config.ts` | 读取缓存（TTL 3s + 写后失效）；`registry.buildChainsFromConfigs()` |
| 适配 | `src/ai/providers/openai-compat.ts` | LLM/图像/TTS/视频四能力，兼容 b64_json/base64/url 三种图像返回形态 |
| API | `/api/settings/model-providers`（GET/POST/PATCH/DELETE/test） | 密钥永不回明文 |
| UI | `src/app/settings/models/page.tsx` | 通道卡片 + 预置服务商一键填充（OpenAI/DeepSeek/SiliconFlow/Moonshot/智谱） |

## 验证证据

- 单测 14 项（链构建排序/停用排除/掩码哨兵/四能力请求形态/401 降级判定/视频轮询与不兼容报错）——vitest 48/48 全绿
- E2E 实测（`scripts/e2e-custom-provider.mjs`）：本地 mock OpenAI 兼容服务 → 配置 → 连接测试 19ms → 真实创作流程的 `text.plan` 记账为 `openai-compat:Mock 模型 / mock-llm-1 / succeeded`（z-ai 处于 429 冷却期完全未被触达）→ 删除后链回到内置通道
- lint ✓ / typecheck ✓ / 34→48 测试全绿

## 后果与风险

- **正**：任何一家外部服务的密钥即可解锁全部被阻塞的评测与创作；用户可按成本/质量自由切换；平台配额不再构成单点故障。
- **负/风险**：外部服务兼容性参差（尤其视频与图像参数）——连接测试只验密钥与端点，不验生成质量；密钥明文落库在多租户前必须替换；自定义 LLM 的 JSON 纪律弱于内置通道时，意图编译可能进入更多修复轮次（llm-json 修复器已就位，且有 §16 缺省决策兜底）。
- **不做**（本期明确排除）：按用户隔离配置、密钥加密、非 OpenAI 兼容协议（Anthropic 原生等）、服务侧生成质量探针——全部登记为 M2+/Trust 层工作。
