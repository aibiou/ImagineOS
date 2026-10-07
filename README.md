# ImagineOS（Alpha）

AI 原生的表达与视频创作平台：用户说一句自然语言，系统完成意图理解 → 创作方向 → 故事与分镜 → 逐镜生成 → 合成成片，支持自然语言修订、Remix 与发布。Alpha 阶段唯一北极星指标是 **Expression Success Rate**（表达→作品的成功率），详见 `docs/product/product-north-star.md`。

## 视频像素从哪里来：双路径架构（重要）

成片有两条生成路径，由 Model Router 统一调度（`docs/decisions/ADR-0001-alpha-video-generation-strategy.md`）：

| 路径 | 原理 | 质量特征 |
|------|------|---------|
| **Composition（组合式，当前默认）** | 逐镜头 AI 生成首帧图像 + Ken Burns 运镜 + xfade 转场 + TTS 旁白，FFmpeg 合成 MP4 | 确定性高、成本低、速度快；镜头内无真实运动（已知上限，ADR-0001 L1） |
| **Native（原生视频）** | 逐镜头首帧图像 → 图生视频模型（video.shot 能力），视频段直接入合成；单镜失败自动回落组合式 | 画面真运动；成本/延迟约为组合式 3–5 倍，外部队列可用性不稳定 |

**Alpha 当前默认：所有真实用户生成都走 Composition**（ADR-0001 Rev.2「调度策略在 M2 按用户分层再定」；Gate 7 真人测试 Pre-flight 显式决定）。UI 已上线「生成模式」徽章（组合成片 / 原生视频 / 混合）标注每个作品的真实产物路径，避免把组合式形态误读为 AI 视频模型能力。

### 如何切换到 Native（评估/演示用）

```bash
bash scripts/m15/restart-dev.sh native   # 注入 IMAGINEOS_FORCE_NATIVE=1，逐镜强制 native（失败自动回落）
bash scripts/m15/restart-dev.sh composition   # 回到默认
```

切换前建议先探测视频队列健康：`node scripts/m15/probe-channels-now.mjs`（agnes-video 队列满 503 时 native 会全程回落，意义不大）。

> ⚠️ 开发者注意：配方 `Shot.motion` 字段（`src/core/content/schemas.ts`）是 ADR-0001 预留给产品侧调度的钩子，**当前无任何写入点（死字段）**——别误以为设置它就生效，详见 ADR-0001 附录备注。产品化入口属于 M2 范围。

## 仓库导航

- **文档地图**：`docs/README.md`（产品 / 架构 / 决策 / 评测四大区）
- **项目宪法**：`docs/product/product-north-star.md`
- **架构总览**：`docs/architecture/architecture-understanding-report.md`
- **当前里程碑**：M1.5 Expression Quality Gate 已收口（`docs/evaluations/m15-final-package.md`）；Gate 7 真人测试进行中（`docs/evaluations/human-test-plan.md`）
- **工作日志**：`worklog.md`（多智能体共享，append-only）

## 技术栈与运行

Next.js 15（App Router）+ Prisma / SQLite（`db/custom.db`）+ z-ai-web-dev-sdk（LLM / 图像 / TTS / 视频）+ FFmpeg 7（合成）+ Vitest（79 项门禁）。

```bash
bun install           # 安装依赖
bun run dev           # 开发服务器（含 generation worker 与孤儿看门狗）
bun run test          # Vitest 全量门禁
bun run lint && bun run typecheck
```

环境变量见 `.env`（`DATABASE_URL`）；自定义 Provider（openai-compat 形态的 LLM / Image / Video）在数据库 `ModelProviderConfig` 表配置，运行时动态生效，无需重启。
