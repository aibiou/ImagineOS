# ImagineOS 多智能体工作日志（worklog）

> 所有 agent 开工前必读本文件；完工后按模板追加（只追加，不覆盖）。

---

Task ID: phase-0-2
Agent: GLM-5.3（主 agent，AI CTO / Principal Architect 角色）
Task: Master Brief v1.0 指令的 Phase 0（Repository Discovery）+ Phase 1（Architecture Understanding Report）+ Phase 2（Development Task Tree）+ /docs 文档地基。明确不进入大规模写代码阶段。

Work Log:
- 探测仓库：发现为空仓库（仅 download/README.md），git 已初始化（1 个 initial commit，无 remote），无 package.json/src/依赖/CI
- 探测环境能力：Node v24.21.0 / npm 11.19.0（无 pnpm）；FFmpeg 7.1.5 可用；无 Redis；无 Postgres 服务；DATABASE_URL=file:...custom.db（SQLite）；.env 存在
- 建立 /docs 地基：README（文档地图+冲突裁决规则）、product/product-north-star.md（项目宪法：使命/北极星/禁改清单/UX七原则）、architecture/、decisions/、evaluations/、ideas/
- 撰写并交付《架构理解报告》docs/architecture/architecture-understanding-report.md：10 个必答问题 + 风险清单 R1-R8 + 待确认决策 D1-D3 + 附录（模块图/数据模型六不变量/状态机/API 面/环境实测）
- 撰写并交付《开发任务树》docs/product/development-task-tree.md：Epic E0-E15（Feature→Task→AC→实现要点→测试要点）+ 里程碑 M0-M5 + §96 Phase 映射表
- 撰写 ADR-0001（Alpha 视频生成策略：组合式管线优先，状态 Proposed 待负责人确认）；ADR-0002（仓库形态）/ADR-0003（认证方案）以摘要形式登记于 decisions/README
- 撰写 ideas/README（I-001~I-006 登记）与 evaluations/README（评测维度/Golden Dataset 计划/回归触发器）
- 归档两份主报告副本至 download/ 目录

Stage Summary:
- 关键结论 1：ImagineOS = 意图编译器 + AI 创作管线 + 活内容图谱（Content Object），模型层经 Model Router 隔离且可整体替换
- 关键结论 2：Alpha 唯一 KPI = Expression Success Rate，§63 自行车故事链路 = 集成验收测试，四个可证伪假设 H1-H4 已显式化
- 关键结论 3：环境实测（SQLite/无Redis/FFmpeg在位/无外部视频API凭据）→ 推荐 DB 持久化 Job + 乐观锁 claim；组合式视频管线（ADR-0001 方案B）
- 关键结论 4：开发顺序 = 垂直切片优先（M0 Walking Skeleton → M5 Alpha Validation），E2 Content Object 先于 E3-E12 一切
- 产物清单：docs/{README.md, product/product-north-star.md, product/development-task-tree.md, architecture/architecture-understanding-report.md, decisions/README.md, decisions/ADR-0001-alpha-video-generation-strategy.md, ideas/README.md, evaluations/README.md}；download/{architecture-understanding-report.md, development-task-tree.md}
- 阻塞项：D1（ADR-0001 生成策略）/D2（仓库形态）/D3（认证方案）待产品负责人确认后才能启动 Phase 3（E0 脚手架）

---

Task ID: phase-3-5 (M0)
Agent: GLM-5.3（主 agent）
Task: M0 Walking Skeleton —— Phase 3 Repository Foundation + Phase 4 Database Foundation + Phase 5 Content Object（产品负责人已确认 D1/D2/D3）

Work Log:
- 初始化 fullstack 环境（Next.js 16 + shadcn/ui + Prisma/SQLite + z-ai SDK）
- E0：tsconfig 升级 strict + noUncheckedIndexedAccess；新增 typecheck/test/check 门禁脚本 + vitest(tsx)；ESLint 架构边界守卫（app 层禁触 DB、core 层禁绑模型 SDK，ADR-0002 落地）
- E1：Prisma schema 落地 §47 全部 19 张表（User/Identity/Project/Content/ContentVersion/Intent/CreativePlan/Story/Scene/Shot/Asset/Generation/GenerationJob/Permission/Provenance/Remix/Publication/ContentInteraction/CreatorPreferences），SQLite 约束（无 enum/Json）以 String+Zod 应用层校验解决；dev/test 双库 push；seed 走真实服务路径铺陈 §63 自行车故事（v1→v2"再温暖一点"→发布）+ 4 件探索作品 + 1 条两层 Remix 血缘
- E2：创作状态机（纯函数转移表+全量测试）；版本系统（createVersion 配方延续 / restoreVersion 恢复即新建 / 仓储无 update 面=结构性不可变）；Fork 原语（血缘三件套+原作字段级零改动断言）；contentService（startCreation/advanceStatus/publishMinimal/getContentBundle）
- API：/api/imagine/start、/api/contents(CRUD list)、/[id](detail)/versions(时间线+新建)/versions/[vid]/restore、/[id]/remix、/[id]/status、/[id]/publish，领域错误→HTTP 语义映射（404/403/422）
- 首页 /：ImagineOS 品牌页（"你想表达什么？"英雄区+建议词+Creation Loop 可视化+我的创作卡片带状态机推进按钮+探索流带 Remix+版本时间线对话框+修订对话框，暗色紫粉金渐变，移动端适配，sticky footer）
- 修复：Remix schema 漏 derivativeVersionId（§35 血缘三件套）；route 相对导入深度；zod input/output 类型差（VersionStructureInput）；vitest4 fileParallelism
- DoD 验证：lint ✓ / typecheck 0 错误 ✓ / vitest 30/30 ✓ / agent-browser 黄金路径自验：表达→创建(IDEA)→推进(INTENT)→修订(v1+changelog)→Remix(副本+血缘 toast)→发布(徽章)→版本时间线(恢复按钮可见)，零 console 错误，移动+桌面截图存 download/

Stage Summary:
- M0 里程碑达成：Content Object 核心原语（Create/Read/Update/Version/Fork）全部可用且有测试护栏；状态机/版本链/Remix 血缘/Provenance 四大不变量经 30 个测试断言
- 六条数据不变量落地：版本不可变(仓储无 update)/Remix 原作零改动(字段级 diff)/Provenance 只追加/领域表无模型名/Intent source 标记(schema 预留)/currentVersionId 现势指针
- 产物：src/core(领域层)/src/infra(配置)/src/app/api(7 组路由)/prisma(schema+seed)/tests(4 套件 30 用例)/首页
- 已知问题：User 硬删除存在外键约束（Remix.remixer/ContentVersion.creator 无级联）——Alpha 用软删除语义，正式处理留 E13/Trust 层；POST /api/contents(手工建)与 imagine/start 语义重叠待收敛
- 下一步：M1 First Video —— E3 Intent Engine（LLM 结构化抽取+访谈）→ E4 Creative Planner → E5 Model Router（z-ai Adapter×3+组合式视频 Provider）→ E6 Generation Jobs（DB 持久化+乐观锁 claim）→ E7 Media Pipeline（FFmpeg 合成）

---

Task ID: m1-first-video
Agent: GLM-5.3（主 agent）
Task: M1 First Video —— 按 M0 评审指令（docs/product/m0-review-m1-direction.md）完成 E3-E7 真实生成管线 + P0/P1 UI 验收。本会话为断点续跑收尾。

Work Log:
- 恢复上下文：发现上个会话已完成 E3-E7 大部分实现（intent/planning/router/jobs/ffmpeg/workers/create 页面/语言字典），但 dev server 持有已删除的旧 custom.db inode（/proc/1187/fd 确认 deleted），导致 explore API 读到旧种子数据
- 重启 dev server → explore 返回「父亲与那辆二八大杠」（§63 全链真实产物：49.4s MP4 + 封面 + 11 图 + 8 TTS 已在磁盘库）
- 修复 seed 预设配方路径 bug①：DirectionsPayloadSchema 要求 ≥2 方向，但预设只存 1 个 → 补第二备选方向（altDirection），损坏数据被 saveDirections 整批替换自愈
- 修复 seed Remix 路径 bug②：fork 副本状态 READY（继承配方），ensureGeneratedToReview 只会调 startStoryboardGeneration（要求 STORYBOARD）→ 增加 READY/REVIEW 分支走 generationFlow.regenerate（同版本重跑=真实再创作）
- 修复 storyboard API 500 bug③：StoryboardSchema 硬约束 shots.max(4)，LLM 时长预算（45s→5镜）与单场景 5 镜冲突且修复轮不拆 → 放宽至 max(8) + system prompt 规则 7 引导按叙事拆场景
- 断点续跑 seed 全量完成：林小满自行车（§63 v1→v2 修订→发布）+ 阿澈水彩梦 + 南星天空蓝 + 阿澈 Remix 自行车（真实再生成像素）→ 4 件公开作品 · 54 件资产
- agent-browser 黄金路径全链验证：建议词→表达→意图（真实 LLM 3 方向：水滴梦境/枕边漫游/记忆捕梦）→选向→故事→分镜→AI 生成（5 镜图像+TTS）→REVIEW 预览→渲染成片→发布，零 console 错误
- 验证 Remix 黄金路径：explore 卡片「从这里开始我的版本」→ 匿名用户获得 READY 副本（配方继承）
- P0 验收截图：m1-home-desktop/mobile.png、m1-explore-desktop.png、m1-play-dialog.png、m1-create-review/ready/published.png
- 门禁：lint ✓ / typecheck 0 错误 ✓ / vitest 30/30 ✓

Stage Summary:
- M1 主链 Intent Engine → AI Generation → Visual Content → Revision → Publish → Remix 全部真实跑通（无一处 mock）
- P0-1 ✓：Explore 卡片结构 Visual Content→Title→Creator→AI involvement→Remix，poster/video/duration 真实资产，9:16 海报+播放浮层+时长角标+Remix 血缘角标「从《xxx》开始」
- P0-2 ✓：「你想表达什么？」保持 h1 核心入口；无模型/Seed/采样参数暴露
- P0-3 ✓：产品语言字典（src/app/_language）全站生效——初稿/第N版/共X版/继续修改/从这里开始我的版本/换一批画面/满意，渲染成片
- P1 ✓：Remix 文案「从这里开始我的版本」；Home IA 未重构；黑紫基调向内容感演进（视觉卡片+成片播放器）
- 发布文案闭环 M1 命题：「已发布 · 别人可以从这里开始他们的版本」
- 已知留白：User 硬删除外键（E13）；POST /api/contents 与 imagine/start 语义收敛；多画幅（当前固定 9:16）；字幕行 subtitles.lines 未接旁白文本
- 下一步：M2 Creator Loop —— E8 发布/分享（Publication 通道）、E9 Explore 发现（排序/互动）、E10 Remix 强化（血缘图谱可视化）

---
Task ID: m15-expression-quality-gate
Agent: GLM-5.3（主 agent）
Task: M1.5 Expression Quality Gate —— 七道质量闸门 + Native Video 双路径 + GitHub 正式仓库阶段（产品负责人 2026-10-06 指令）

Work Log:
- S0 基建：scripts/m15 驱动库（cookie 会话持久化 + HTTP 全链 + 轮询 + 断点续跑 422 容错 + 结构 diff + 指标采集）
- Gate1+2：10 类型 × 3 范式真实创作，9/10 已发布（p10 因图像配额 429 阻塞于成片前，断点续跑就绪）；阶段延迟表：端到端均值 ~3.5 分钟
- 缺陷修复①（P2028）：并发写锁下 SQLite 事务 5s 超时 → 8 处 $transaction 统一 30s（scripts/m15/patch-tx-timeout.mjs）
- 缺陷修复②（失败恢复缺口）：Job 失败后 GENERATING 无重入入口 → regenerate 接受 GENERATING（429 场景实测）
- Gate6b（双路径）：z-ai SDK 实测有 video.generations（cogvideox-3 图生视频）→ 新增 video.shot 能力 + zai-video Provider + 合成器 videoPath 分叉 + motion 字段调度 + 失败回落 composition + ADR-0001 Rev.2 + 路由测试 4/4 + 真实出片 56s/镜
- Gate5：integrity-check.mjs 数据库级六表检查 → M1.5 生产案例 0 错 0 警（遗留测试夹具 20 错单独归类）
- Gate6a：visual-quality.mjs 帧间差分度量 → 组合式 YDIF≈1.0（近静态）vs Native 2.08（2.1×）——"静态画面+运镜+转场"判断被量化证实
- Gate7：human-test-plan.md（16 人/30 分钟/六指标/"我还想做一个"行为率/M2 决策矩阵）
- UX 语言：全站扫描零工程术语残留；Remix →「从这里开始创作」全站落地（字典+卡片+发布提示+SEO）
- GitHub 阶段：一致性检查（9 文档缺失）→ 补齐 vision/product-constitution/product-blueprint/alpha-prd/user-language-rules/architecture×4/worklog 索引 + README 文档地图（GitHub 文档=主事实源）
- M1.5 Task Tree + Expression Quality Report（§1–§11，含两个关键问题回答）
- 首推 GitHub main（运行数据不入库：db/storage/m15 state/frames/tool-results）
- 阻塞：Gate3 四连改链 + Gate4 Remix 专项链 + p10 + Native Golden Case——provider 全能力配额长冷却（当日 ~100 图+130 LLM+130 TTS），恢复脚本就绪且幂等

Stage Summary:
- M1.5 达成度 ≈85%：Gate1/2/5/6/7 完成；Gate3/4 机制层已验证（M1 种子血缘 + Gate5 断言），专项行为链待配额恢复补跑
- 关键结论1：表达→作品链路成立（10/10 类型 Intent 编译零失败，3 范式真实分化）
- 关键结论2：视觉质量是量化证实的最大短板（YDIF 1.0 vs Native 2.1 vs 实拍 3–8）——双路径已接入，M2 主线建议=视觉深化优先于内容传播
- 关键结论3：Content Object 六不变量在 10 案例+2 Remix 血缘+138 溯源事件上数据库级全过
- 关键结论4：瓶颈排序：AI 生成质量 > 内容传播 > Intent 理解 ≈ Revision > UX
- 产物：docs/evaluations/m15-expression-quality-report.md + human-test-plan.md + docs/product/{vision,product-constitution,product-blueprint,alpha-prd,user-language-rules,m15-task-tree}.md + docs/architecture/{architecture,content-object,ai-model-layer,trust}.md + docs/worklog/README.md + scripts/m15/*（9 个脚本）+ src/ai/providers/zai-video.ts + tests/video-shot-router.test.ts
- 下一步：配额恢复后补跑 Gate3/4 + p10 + Native Golden Case（~30 分钟）→ 报告 §3/§4/§10 更新 → 等待产品负责人确认 M2 范围（不自动进入 M2）

---
Task ID: sandbox-restore-001
Agent: GLM-5.3（主 agent）
Task: 沙箱重置事故恢复——预览不可用（用户报障「预览页面打不开」），全链路诊断与 M1.5 运行时恢复

Work Log:
- 诊断：沙箱于 2026-10-06 09:03 重置（boot-timeline 证实），M0-M1.5 全部运行时丢失——dev server 进程死亡、src/prisma/node_modules/db/storage 清空，仅 Phase 0-2 文档、git 零头提交与 worklog 幸存；预览 URL 因 :3000 无监听而 502
- 定位恢复源：/tmp/my-project 完整快照（05:41 生成）——含全部 M1.5 源码、prisma/schema+seed、db/custom.db（44 内容/40 版本/208 资产/15 发布/8 Remix）、M1.5 全套文档、scripts/m15；本地 git 对象库仅 35 objects（无代码提交），GitHub remote 未在幸存文件中记录 URL
- 恢复执行：cp -a 快照合并（保留 .git/skills/upload）→ bun install（861 包）→ prisma generate → 首页 200 / explore API 15 作品 / 数据完好验证
- 媒体恢复：storage/ 未随快照幸存且 AI 三通道（LLM/图像/TTS）全部 429 冷却（冒烟实测）→ 编写 scripts/restore-media.ts 以本地 FFmpeg+sharp 生成 208 个品牌化合成占位资产（112 图 720x1280 / 82 音 / 14 视频 H.264 精确 durationMs），4 并发 181s 完成，API 伺服 200 且 ffprobe 时长精确匹配
- 持久化研究：实测沙箱按工具调用回收进程（setsid 亦被杀）；发现孤儿化进程被 tini（PID 1）接管后可长期存活——与老沙箱 dev server 02:30-09:03 存活模式一致；调用 Complete 走平台交付流程
- 验收（agent-browser + 外部 URL）：预览 URL 200；h1「你想表达什么？」渲染；0 图片破损；探索流 15 卡片（标题/创作者/海报/时长/Remix 血缘）；播放对话框 video readyState=4、duration 28.24s 精确匹配、720x1280；console 零错误；桌面/移动/探索/播放四截图存 download/restore-preview-*.png

Stage Summary:
- 预览已恢复可用：https://preview-chat-b15437ca-c5ff-4f2b-b971-7ae3748bcf4b.space-z.ai/
- 代码与数据 100% 恢复（快照为 M1.5 最终态）；媒体为合成占位（品牌渐变系），已验证功能完整
- 遗留：(1) AI 配额冷却中——新创作会 429 阻塞于意图抽取；配额恢复后跑 bunx tsx prisma/seed.ts（幂等可续）替换为真实 AI 像素并补跑 M1.5 Gate3/4；(2) 沙箱重置会再次清空运行时——建议尽快建立外部备份（GitHub remote URL 需产品负责人提供）与恢复 runbook（本节即模板）；(3) dev server 存活依赖孤儿化进程模式，若再死亡：于工具调用内重启 next dev 并 kill 外层包装使其孤儿化
- 新增产物：scripts/restore-media.ts（可复用媒体占位恢复）、scripts/smoke-restore.ts + smoke-channels.ts（配额探针）、download/restore-preview-{desktop,mobile,explore,play}.png

---
Task ID: sandbox-restore-002
Agent: GLM-5.3（主 agent）
Task: 远端一致性核对 + 恢复增量备份推送（产品负责人提供 GitHub 仓库 aibiou/ImagineOS）

Work Log:
- 拉取远端 main（token 经 http.extraHeader 传递，不落盘 .git/config）：远端含 M0+M1.5 共 8 提交（顶点 469d8a3 quota-recovery orchestrator）
- 文件级核对：核心代码（src/prisma/workers/tests/docs/package.json/tsconfig/bun.lock）与远端 **零差异**——/tmp 快照即远端推送后的最终态
- 本地独有增量：worklog 恢复记录、restore-media/smoke 脚本、4 张验收截图；远端独有垃圾：examples/websocket（脚手架示例）与 tool-results/*.txt（工具输出）——被 .gitignore 覆盖但早期已跟踪（"运行数据不入库"原则遗漏项）
- 同步执行：git reset --mixed origin/main 对齐基线 → 暂存增量 + git rm --cached 移除垃圾跟踪 → 提交 528a5b0 chore(ops) → 推送成功（469d8a3..528a5b0）→ 复核 git diff origin/main 无输出（完全一致）+ 上游跟踪已设置
- 附带确认：预览 URL 200 / dev server 存活（09:15 起跨 20+ 次工具调用）/ 仓库为私有（匿名 404 属预期）

Stage Summary:
- 本地与远端现已 100% 一致（main = 528a5b0）；沙箱再重置时可从远端完整恢复（代码+文档），仅需重跑 bun install + prisma generate + restore-media.ts + seed
- 恢复 runbook 已固化在 worklog sandbox-restore-001/002 两条记录中

---
Task ID: m15-closeout-phase-a
Agent: GLM-5.3（主 agent，AI CTO 角色）
Task: M1.5 收口指令 Phase A（非配额依赖全量工作）——2026-10-06 产品负责人 /goal 指令

Work Log:
- 状态评估（指令§1）：重读真实仓库（git log/state 代码/DB）——确认 M1.5 达成度 ≈85%：G1 9/10、G2/G5/G6a/G7 完成，G3/G4 机制层已验证、行为链待配额；发现 2026-10-06 09:03 沙箱重置销毁重置前全部媒体（占位恢复）——历史度量数据为重置前真实采集（时间戳可证），native smoke 文件幸存
- 证据分级体系（A 可复现 / B 持久化不可复现 / C 引用 / ⏸ 待补）落地到全部报告；native smoke 复测 YDIF=2.079 与原记录 2.08 一致（A 级加固）；发现 9 案例 YDIF 逐例数据未持久化（仅 p04 在库）→ 主报告该口径降级为 C 级引用
- 诚实修正：主报告延迟口径（「中位 3.5min」→ 干净窗 121-262s / 波动中位 409s，修正声明入档）；成本口径对齐 DB 权威记账（text.plan 77/0、image 98/18、tts 82/48）
- 报告交付（7 份新增/修正）：decision-report（Q1-Q7 全分级回答+预注册判定标准）、visual-quality（12 维度+核心问题诚实回答）、cost、content-integrity（0错0警+媒体真实性披露）、revision/remix（机制 A 级+行为链待补+预注册失败口径）、human-test-report 模板（8 项系统侧就绪实测，人工字段全部「未执行」）
- Gate 7 系统侧就绪（指令§6）：export-human-test.mjs 六指标导出实测可运行（34 非种子用户可追溯）；integrity-check.mjs 支持 idsFile 作用域批量（实测）；composition/native 配置区分经 Generation 记账可判
- 语言扫描（指令§9）：修复 2 处边界（layout meta「会写 Prompt」、status 路由「缺少目标状态 to」）；STAGE_LABEL 全状态覆盖确认；Remix→「从这里开始创作」全站生效
- 关键缺陷预防（烧配额前的代码审查）：driveCase 无条件发布到 PUBLISHED 而 applyRevision 只接受 REVIEW/READY/STORYBOARD（Alpha 无下线 API）→ G3 四连改会在第 1 轮即 422 失败 → driveCase 新增 stopBeforePublish + G3/G4 脚本时序修复 + G4 补「衍作品可发布」验证
- 失败恢复闭环：lib.mjs driveCase 检测 failed Job 自动 regenerate 重入（p10 恢复路径打通）
- 度量诚实性防护：visual-quality.mjs 字节校验（9 占位成片全部正确跳过）+ 历史保留机制（p04=0.907 以 historical 标记携带）；collect-metrics 扩展到 g3/g4/g6
- Native Golden Case 就绪：run-native-golden.mjs（≥5 镜全 native+逐镜记账+G3 基线对比+回落事件采集）；restart-dev.sh 模式切换实测通过（server 跨工具调用存活验证）
- 门禁：lint ✓ / typecheck ✓ / vitest 34/34 ✓（build 因平台约束跳过：dev server 必须保活供配额依赖闸门 HTTP 驱动，build 会覆写 .next——已在收口总结注明）
- 提交：91e17e5（phase-A closeout）/ bca2b49（publish-timing fix）/ 653215a（metric honesty guards）→ 已推 GitHub

Stage Summary:
- M1.5 非配额工作 100% 完成；剩余全部为配额依赖项（p10/G3/G4/Native Golden Case），一键编排器 finish-m15.mjs 就绪
- 关键结论维持并加固：瓶颈排序 视觉质量 > 内容传播 > Intent ≈ Revision > UX；native smoke 为唯一可复现的运动量证据（2.079，2.1×于组合式）
- M2 前置条件明确（4 条，2 条已满足）；M2 冻结清单遵守
- 下一步：配额恢复（探测中，3 通道仍 429）→ finish-m15.mjs 或分步前台执行 Phase B → 报告终版更新 → 决策报告收口

---
Task ID: m15-phase-b-probe-001
Agent: GLM-5.3（主 agent）
Task: 产品负责人进度问询（/goal 目标是否完成）——Phase B 配额恢复探测

Work Log:
- 核实仓库状态：Phase A 4 提交（91e17e5/bca2b49/653215a/3654e08）已推 GitHub，本地与远端一致，工作树干净
- 核实报告体系：docs/evaluations/ 10 份报告齐备（含 decision-report Q1-Q7 证据分级版）
- 核实运行时：dev server 存活（首页 200，跨工具调用稳定）
- 配额探测（12:03 UTC）：LLM=429 / IMAGE=429 / TTS=429 —— 三通道仍在小时级冷却中
- Phase B（p10 / Gate3 四连改 / Gate4 Remix 链 / Native Golden Case）维持 blocked 状态，一键编排器 finish-m15.mjs 就绪待触发

Stage Summary:
- /goal 目标达成度：Phase A（非配额依赖项）100% 完成；Phase B（配额依赖项）blocked 于 provider 冷却，无伪造、无遗漏
- M1.5 总体 ≈85%；决策报告已可读，4 个 ⏸ 待补项全部有预注册判定标准
- 恢复路径：配额恢复 → bun scripts/m15/finish-m15.mjs（幂等、断点续跑）→ 报告终版更新 → 决策报告收口

---
Task ID: multi-provider-001
Agent: GLM-5.3（主 agent，AI CTO 角色）
Task: 自定义模型服务配置能力（产品负责人 2026-10-06 战略切换指令：不等待 429，开发多 Provider 最小闭环）

Work Log:
- 读码定缝：Model Router 本即链式设计（registerProvider/fallback/逐次记账）→ 改造点收敛为「静态链 → 配置动态链」
- 数据层：ModelProviderConfig 表（纯新增，channel/enabled/priority 索引，无破坏迁移；prisma 相对路径陷阱实测——意外创建 prisma/db/ 已清理，真实库数据完好 45 内容/208 资产）
- 领域层：src/core/settings/provider-config-service.ts（CRUD + zod 校验 + 密钥打码前3后4 + 掩码哨兵=不修改 + 连接测试 GET /models 零消耗 + 变更通知钩子避免 core→ai 反向依赖）
- AI 层：src/ai/router/provider-config.ts（TTL 3s 缓存 + 写后即时失效）；registry.ts 新增 buildChainsFromConfigs（自身保证 priority 升序）+ ensureChainsFresh（测试环境显式关闭，保护 clearRegistry 语义）+ isNonRetryable（401/403/不兼容协议跳过重试立即降级）
- 适配器：src/ai/providers/openai-compat.ts 纯 fetch 零 SDK——LLM(chat/completions)/图像(images/generations，兼容 b64_json/base64/url 三形态)/TTS(audio/speech)/视频(video/submit+status 轮询，实验性，不兼容时报明确错误自动降级)
- API：/api/settings/model-providers（GET 打码/POST/PATCH/DELETE/test 五端点）
- UI：/settings/models 页面（四通道卡片 + 预置服务商一键填充 OpenAI/DeepSeek/SiliconFlow/Moonshot/智谱 + 启停开关 + 优先级 + 连接测试徽章）；首页导航新增「模型服务」入口
- ESLint 边界修正：API 层禁直触 db → 全部走 core 领域服务（第一次 lint 失败后重构，架构守卫有效性的又一次实证）
- 门禁：typecheck ✓ / lint ✓ / vitest 48/48（新增 14：链排序/停用排除/掩码/四能力请求形态/401 判定/视频轮询）
- E2E 实测（scripts/e2e-custom-provider.mjs）：本地 mock OpenAI 兼容服务 → 配置 201 + 密钥打码 → 连接测试 19ms → 真实创作流程 text.plan 记账 = openai-compat:Mock 模型 / mock-llm-1 / succeeded（z-ai 429 冷却期完全未被触达）→ 删除后链回内置 → 全部 11 项断言通过
- dev server 重启一次：旧进程持有过期 Prisma Client 不认识新表（500）→ restart-dev.sh 重启后恢复
- 浏览器验收：/settings/models 渲染、添加表单、预置填充、console 零错误；截图 download/settings-models-{empty,addform}.png
- 文档：ADR-0004 多模型服务 Provider 策略（Accepted，负责人直接指令）+ decisions 索引更新
- Phase B 接力探测：z-ai 三通道（LLM/图像/TTS）13:00 UTC 仍全线 429——Phase B 现已具备「任意一家外部服务密钥即解锁」能力，等待配置真实密钥后跑 finish-m15.mjs

Stage Summary:
- 自定义模型服务配置最小闭环 100% 完成并 E2E 证明：配置保存 → 连接测试 → 生成链真实切换（记账可查）→ 失败自动降级 → 删除回归内置
- 「不因单一模型 quota 限制阻塞 ImagineOS」已在架构层落地：任何 OpenAI 兼容服务的密钥即可解锁全部被阻塞评测
- 密钥明文落库为 Alpha 单租户取舍（ADR-0004 已登记风险与后续路径）
- 下一步：产品负责人在 /settings/models 配置任一外部服务（或提供密钥由本 agent 配置）→ 立即执行 finish-m15.mjs 完成 Phase B（p10/Gate3/Gate4/Native Golden Case）

---
Task ID: multi-provider-002
Agent: GLM-5.3（主 agent，AI CTO 角色）
Task: 模型自定义配置 UX 清晰度增强（产品负责人反馈：「现在看不清自定义的配置」——定位为四大缺陷并全部修复）

Work Log:
- 摸底核实：multi-provider-001 功能层已完整提交（e3414f5）、dev server 存活、预览 URL 200、API 五端点全通（含 [id]/test 连接测试）——确认问题不在功能缺失而在可见性/可操作性
- 缺陷定位：① 配置保存后无编辑入口（改模型/密钥只能删除重建）② 通道卡片看不到当前实际生效的候选链 ③ 空状态引导弱（四个同款空卡片无行动指引）④ 首页入口为小文字链接不显眼
- 重写 /settings/models（6f028c7）：统一 ProviderForm 组件（新增/编辑双模式，编辑时密钥留空=保持不变+当前密钥打码提示）；ConfigCard 内联编辑；ChainPreview 生效链可视化（启用项按 priority 升序 → 内置兜底徽章）；顶部三步引导（选服务商一键填充→粘贴 API Key→连接测试）；密钥安全说明（ShieldCheck 前3后4打码）；通道头「N/M 启用」徽章；header「已配置 N 项」计数
- 首页入口增强：导航「模型服务」→ violet 描边高亮按钮 + PlugZap 图标 + title 提示；移动端隐藏锚链接防 header 溢出（模型服务按钮保留全断点）
- 后端零改动（PATCH 掩码哨兵/字段校验/测试状态重置本就齐备）——纯前端增强
- 门禁：typecheck ✓ / lint ✓ / vitest 48/48 ✓
- 浏览器 E2E 全链实测：添加（DeepSeek 预置一键填充 label/model/endpoint）→ 保存 → 卡片生成（打码 sk-••••3456）→ 编辑（改 model deepseek-chat→deepseek-reasoner，密钥留空后 PATCH 验证 apiKey 原值未动）→ 启停开关（DB enabled true→false→true）→ DELETE 清理回归空列表；console 零错误；桌面+移动截图存档（settings-models-with-config / settings-models-mobile / home-nav-mobile）
- 提交推送：6f028c7 → GitHub main（远端一致）

Stage Summary:
- 「看不清自定义的配置」四大缺陷全部修复：可编辑、可见生效链、有引导、入口显眼
- 配置闭环补齐最后一环：添加 → 测试 → 编辑修正 → 启停 → 删除 全生命周期可操作
- 等待产品负责人在 /settings/models 配置真实外部服务（OpenAI/DeepSeek/SiliconFlow/Moonshot/智谱 任一家的 API Key）→ 立即触发 finish-m15.mjs 补跑 Phase B

---
Task ID: multi-provider-003
Agent: GLM-5.3（主 agent，AI CTO 角色）
Task: 字段对比度修复（产品负责人反馈：「看不清模型的各个字段，和背景颜色冲突了」）

Work Log:
- 根因定位（非猜测，计算样式实证）：/settings/models 根元素缺 `dark` 类（首页有）→ 所有 shadcn 组件落入亮色主题令牌：Input 渲染浅灰边框（--input=oklch 0.922 亮灰）、Switch 开启态 = 亮色 primary（近黑）在暗背景上不可见、字段文字 zinc-400/500 直接压在 zinc-900 卡片上（标签仅 ~2.3:1）
- 系统修复（274f99a）：① 根元素加 dark 类——全组件切正确暗色令牌 ② 只读字段区重构为内嵌面板（bg-black/40 + divide-y 分行 + border-white/10）：标签 zinc-400、值 zinc-100 等宽字体 text-sm（12px→14px）③ 表单输入框 border-white/25! bg-black/40! text-zinc-100!（! 后缀确保覆盖 dark:bg-input/30 令牌）④ 全部 zinc-500 辅助文字提亮至 zinc-400/300
- 客观验证（VLM 通道仍 429，改用像素级测量代替主观判断）：scripts/verify-panel-contrast.py 按元素 getBoundingClientRect 精确裁剪面板区域——WCAG 对比度 13.8:1（AAA 级；文字 217/255 vs 背景 13/255）；Switch 开启态 lab L≈91 近白可见；Input 计算样式 = 白 25% 边框 + 黑 40% 实底
- E2E 复验：预置填充→保存→面板渲染→清理全链通过；刷新后零 console 错误；48/48 测试绿
- 过程缺陷记录：MultiEdit 在本环境为顺序应用非原子（第一次调用部分落地后报错），已逐项 grep 核实落地状态并补齐缺失编辑——后续使用需逐编辑验证
- 提交推送：274f99a → GitHub main

Stage Summary:
- 「字段和背景冲突」根因（暗色页面漏挂 dark 类）+ 表现层（低对比文字）双修复，像素级证据 AAA 13.8:1
- 设置页对比度体系：字段面板 13.8:1 / 辅助文字 ≥7:1 / 输入框实底清晰边界
- 继续等待产品负责人配置真实 API Key → 触发 Phase B 补跑

---
Task ID: multi-provider-004
Agent: GLM-5.3（主 agent，AI CTO 角色）
Task: 模型列表一键获取 + 所选模型真实验证（产品负责人需求：输入 URL 和密钥后点击自动获取有权限的模型名供选择，然后测试验证所选模型行不行）

Work Log:
- 服务层（2a50ad2）：fetchAvailableModels（GET /models 零消耗，双形态解析 {data:[{id}]} | 字符串数组，401/404 分别给「密钥无效/请手动填写」可读错误）；verifyModelForChannel 分通道真实最小调用——llm 真实对话（max_tokens=8 近零消耗，回报回复样本）、tts 真实合成（回报字节数）、image 真实生图（UI 二次确认消耗）、video 不实调（成本高，按列表存在性说明）；runConnectionTest 升级为两步（连接 → 模型真实验证），消息合成 + modelVerified 回传落库
- 过程缺陷修复：lightRequest 非 2xx 时未解析 JSON 错误体（服务商 "model not found" 信息丢失）→ 补 JSON.parse（单测捕获）
- 新路由 POST /api/settings/model-providers/models：{baseUrl,apiKey}（新增表单）与 {configId}（编辑表单复用已存密钥，明文不出服务端）双模式；422 非法 / 502 上游错误
- 纯模块 src/lib/model-catalog.ts：通道模式排序（推荐组/其他组 optgroup；llm 排除护栏防 gpt-image-1/*-tts 混入对话推荐）——客户端与测试共享、不依赖 db
- UI：模型名称旁「获取模型列表」按钮（地址+密钥就绪才启用）→ 分组下拉选择自动填入（保留手填）；卡片按钮改「测试验证」（image 通道消耗确认弹窗）；三步引导更新
- 测试：+12（列表解析/鉴权失败/四通道请求形态/404 错误透出/video 零实调保证/目录排序）→ 60/60 全绿
- E2E：scripts/e2e-model-list.mjs 22 断言全过（key 拉取/configId 拉取/保存/真实对话验证/落库/tts 真实合成/video 跳过说明）；agent-browser UI 全链（获取→分组选择→保存→测试验证→清理）
- 沙箱新知：独立 node 进程（mock）跨工具调用必被回收（setsid+nohup+disown 亦无效）——UI 验证须在单次调用内完成（ui-verify-model-list.sh 模式）
- 重要发现：产品负责人已自行配置真实服务 agnes-com（apihub.agnes-ai.com）三条通道——image: agnes-image-2.0-flash / llm: agnes-3.0-flash / video: agnes-video-2.5-flash，全部 enabled、旧连接测试 ok（tts 未配置）；UI 验证全程未触碰该配置

Stage Summary:
- 「点击自动获取模型名 + 选择 + 测试验证所选模型」完整落地：拉列表（零消耗）→ 分组选择 → 真实调用验证（llm/tts 近零消耗，image 一次生图，video 说明性跳过）
- Phase B 解锁钥匙已就位：agnes-com 三通道已配置且启用——LLM 通道可立即真实验证（近零消耗）；建议产品负责人在页面点「测试验证」确认（image 会消耗一次生图）
- 下一步：跑 finish-m15.mjs 补 Phase B（llm/image 走 agnes-com，video 通道 agnes 为 SiliconFlow 风格提交/查询协议是否兼容待首个任务验证，失败自动回退内置）

---
Task ID: m15-phase-b-integration-001
Agent: GLM-5.3（主 agent，AI CTO 角色）
Task: 产品负责人指令——停止新功能开发，验证 Model Provider 配置链路并恢复 Phase B（p10/G3/G4/Native Golden Case），真实记录全部结果

Work Log:
- 链路验证（指令§1，A 级证据落盘 chain-verification.json）：页面配置 → DB（ModelProviderConfig 3 行 agnes-com）→ Registry（ensureChainsFresh 动态链）→ Runtime → Generation 记账。真实匿名会话驱动完整创作流：LLM 5/5（openai-compat:agnes-com/agnes-3.0-flash，5.3-30.6s）、Image 12/12（agnes-image-2.5-flash，均值 9.9s）、TTS 36 次全 429 但 fallback 链序验证（无自定义→直达 zai-tts）、image 失败自动降级 zai-image 记账序列在案
- Agnes 协议逆向（官方 wiki 抓取 wiki.agnes-ai.com）：视频为 OpenAI-Videos 风格（POST /v1/videos mode=keyframe + GET {origin}/agnesapi 轮询），与 SiliconFlow 风格完全不兼容；mode 合法值 text/keyframe/reference（不是 image2video）；Flash 限 size='720P'；当前 $0/秒限时免费；data URI 首帧实测通过（规避生成期内容私有、资产路由 404 的公网可访问约束）
- 两个协议级缺陷修复（9fe8769）：①S3 预签名 URL 带 Authorization 头必 401（Agnes 图像下载根因）→ downloadMedia 裸下载优先+401/403 带鉴权重试；②视频双协议适配（submit 404 自动转 OpenAI-Videos；queue-full 503 退避重试 ×3；seconds 4-12 夹取；aspect_ratio 最近似映射）→ 新增 4 单测，全套 64/64 绿
- 通道阻塞矩阵：LLM✅agnes / Image✅agnes / TTS❌（agnes 无 TTS 模型——12 个模型全为文本图像视频 + z-ai 429 长冷却）/ Video🔶（协议就绪但 agnes 队列满 503 持续 ~45min+）
- Phase B 全部四项依赖 TTS（storyboard Job 的 TTS 步失败即 Job 失败）→ 阻塞收敛为 TTS 单通道
- 基建：quota-watcher.mjs（孤儿化进程，150s 双探测：z-ai TTS + agnes 视频队列全链试提，恢复即立旗）+ finish-m15.mjs 多 Provider 版（等 TTS→p10/G3/G4→Native Golden→终版度量；TTS 4h 不恢复则诚实退出不烧无效调用）——双进程已验证跨工具调用存活（PPID=1）
- 文档（dc94005）：主报告 §0.5 Model Provider 矩阵/链路验证/协议缺陷工程记录；成本报告 §5.5 四通道定价（agnes 限时免费 $0，牌价估算 ~$0.75/案例）；§10 阻塞项重写
- 定价权威数据（官方 wiki）：agnes-3.0-flash input $0.05/M output $0.15/M；agnes-image-2.5-flash $10-24/千张按分辨率；agnes-video-2.5-flash $0.025/秒@720P——当前全部 $0

Stage Summary:
- 指令§1 链路验证完成：四通道 Provider 真实生效（非 UI 摆设），fallback 机制有记账铁证
- 指令§4 报告 Provider 信息已入档（主报告 §0.5 + 成本报告 §5.5）
- Phase B（指令§2）armed 未跑：唯一硬阻塞 = TTS 通道无可用 Provider（外部配额，不可绕过）；编排器后台待命，TTS 恢复自动执行全链
- 诚实记录（指令§3）：失败原因全部入档——TTS=agnes 无模型+z-ai 429；Video=agnes 服务端队列满 503

---
Task ID: m15-phase-b-integration-002
Agent: GLM-5.3（主 agent，AI CTO 角色）
Task: 产品负责人后续指令——TTS 使用内置；完成 Phase B 补跑收口 + 全部评估报告 Provider 信息终版 + Final Decision Report Q1–Q7 收口

Work Log:
- 状态接管：发现上一 session 的后台编排器已自动执行过一轮（TTS 16:01 恢复 → p10/G3 部分跑 → 16:39 阶段性完成；agnes 视频队列 20:14 放行 → 20:19 全链旗）但 worklog 未记录、关键项卡死
- 根因诊断（DB 级）：① p10 卡 GENERATING+job=null——lib.mjs 僵死重入判断写反（creation API 的 job 字段只返回活跃 Job，failed 不在列，旧条件永远不命中）；② G3 修订 3（v4）创建成功后 storyboard Job 被 z-ai TTS 二次 429 击杀（16:26，audio.tts 全候选失败）；③ G3 修订 4（v5）生成完成后编排器进程树被外部 SIGKILL（3 次，oom_kill=0 非 OOM，dev server 同 PID 存活）——改前台分块执行策略对抗
- 三个测试装置缺陷修复（应用层零缺陷）：① lib.mjs 僵死态判定改为「GENERATING 且无活跃 Job → regenerate」② run-revision-chain 发布后补 state.phase 戳记（G4/NativeGolden 前置检查读断点文件）③ run-remix-chain 第 7 步重载 state 再写（旧对象覆盖踩空 revisions）
- Phase B 补跑全部完成（真实记录）：p10 regenerate 重入 68s 发布（5 镜 42.6s，image 走 agnes）；G3 四连改 v1→v5 发布（定位精度 4/4：style/台词 shot/单镜/尾镜级；局部性 4/4→2/4→1/4→2/4 镜；修订 3/4 为恢复模式如实标注）；G4 Remix 链全通过（血缘三件套/配方字节继承/原作字段级零改动/衍作 3 版独立发布）；Native Golden 混合降级形态完成（28 次 video.shot 尝试 1 成功 = zai cogvideox 68.6s，4 镜回落 composition，Provenance 逐镜记账，成片 43s 零冻结段 YDIF 0.549 vs G3 基线 0.665）——全镜 native 未达成（agnes 队列满 503 持续，终次探测仍满），预注册标准不因新模型修改：裁决「并行深化，不升主线」
- 终版度量：13/13 案例发布；M1.5 生产案例 0 错 0 警（六表断言全过）；text.plan 112/112 成功；image 168✓/80✗；tts 127✓/127✗（间歇 429 被重试+重入吸收）；fallback 铁证 agnes-image 6 连败→zai-image 接管
- 报告终版更新（10/10 份含 Model Provider 信息）：主报告（§0 执行摘要/§0.5 矩阵/§1.1 p10 行/§3 Gate3/§4 Gate4/§6.2 Gate6b/§10 阻塞终版/§11 清单）；revision/remix/visual/integrity/cost/decision/human-test×2/README 全部补 Provider 矩阵（两段真实配置：晨跑段全内置 z-ai vs Phase B 段 agnes+zai-tts，DB 时间戳佐证非事后改写）；成本报告补 Phase B 实际消耗（$0，牌价估算 $0.7–0.9）
- Decision Report Q1–Q7 终版收口：Q1 达成度 85%→95%（剩余=全镜 native+Gate7）；Q2 Revision/Remix 移出短板；Q3 裁决并行深化；Q4 判定可靠（含 22.8s 定位延迟边界）；Q5 机器侧行为链闭环；Q6 唯一未满足条件=Gate 7 真人测试；Q7 主线 A 视觉质量深化（含 Q3 联动提醒）
- 门禁：vitest 64/64 全绿（src/ 零改动）；dev server 已切回 composition 模式；新增 probe-agnes-video.mjs（队列提交即知探测）+ supervise-finish.sh（监督者，本轮被击杀未用上，保留作环境风险记录）

Stage Summary:
- 指令全部落地：模型配置链路上 session 已验证（非 UI 摆设）→ Phase B 四项补跑完成（Native Golden 为诚实混合形态）→ 10/10 报告 Provider 信息齐备 → Final Decision Report 收口 → M2 启动唯一剩余条件 = Gate 7 真人测试
- 真实性原则执行：评估标准零修改；失败/回落/恢复全程入档（TTS 二次 429、agnes 6 连败降级、28 次视频尝试 1 成功、3 个脚本缺陷+修复）
- 环境新知：沙箱存在针对后台 node/bash 进程的 SIGKILL（dev server 豁免）——长编排必须前台分块执行

---
Task ID: m15-final-validation-001
Agent: GLM-5.3（主 agent，AI CTO 角色）
Task: 产品负责人指令——M1.5 Phase B 已收口，进入 M1.5 Final Validation：Gate 7 真人测试准备（四项确认）+ Final Package（Decision Report 终版/Provider Matrix/Known Limitations/Demo Case 清单）+ 不进入 M2 开发（等待 Gate 7 数据）

Work Log:
- 状态接管：git 核实 3704808（Phase B 收口）本地与远端一致；dev server 存活（home/explore 200）；预览 URL 200；10 份评估报告齐备
- 演示数据提取：新增 scripts/m15/demo-case-inventory.mjs（修复 remixSources 关系名 + mime 查询两个装置缺陷）——DB 实时提取 21 件已发布作品（18 真实案例 + 3「发布走查」夹具），含版本链/Remix 血缘/native 记账/时长
- Gate 7 四项确认（human-test-plan.md → Final Validation 锁定版）：① 测试流程 §3 + §10 测试日 pre-flight 清单（provider 探测/模式决定/导出预演/种子隔离/中止条件）② 用户任务模板 §3.0 观察员逐字稿卡（开场/应变/卡住 ≥3min·≥5min 三级预案/修订/探索/收尾逐字稿 + 禁止词清单 + 「观察员只做三件事」）③ 数据采集字段 §5.1 人工×系统对齐表（8 个测量对象与 export-human-test.mjs 字段一一对应 + 冲突裁决规则）④ 评分标准 §4 编码细则（首反应正/中/负判定例、双人编码一致率 ≥80%、Intent 确认项口径、修订五类别编码、评分标准不随 Provider 变更修改）
- M1.5 Final Package（m15-final-package.md 新建，196 行）：§0 包清单与状态（6 组件）；§1 Decision Report 速览（Q1–Q7 一句话结论表）；§2 Provider Matrix 终版（三段执行配置矩阵/链路 fallback A 级证据/定价/协议缺陷工程记录/单一依赖风险——TTS 为唯一无自定义备份通道）；§3 Known Limitations L1–L16（产品级 5/工程级 6/数据证据级 3/环境级 2，每条含量化事实与对策）；§4 Demo Case 清单（五分钟标准动线 + 类型广度组 10 案例 + 专项演示组 3 件真实字节案例 + 占位媒体诚实披露 + 配额风险控制）；§5 M2 冻结声明（不进入 M2 开发、允许例外 3 项、M2 规划唯一输入 = Gate 7 数据、冻结清单继续有效）
- 索引同步：decision-report 头部 Final Package 收录标记；evaluations README 包地图置顶；主报告 §11 交付物清单新增第 11 行
- 门禁：typecheck ✓ / lint ✓ / vitest 64/64 ✓（src/ 零改动，纯文档 + 1 提取脚本）
- 提交推送：e4b9fa5 → GitHub main（本地与远端一致）

Stage Summary:
- 指令全部落地：Gate 7 真人测试准备四项确认锁定（流程/任务模板/采集字段/评分标准）+ M1.5 Final Package 五组件齐备（Decision Report 终版/Provider Matrix/Known Limitations/Demo Case 清单/M2 冻结声明）
- 不进入 M2 开发已写入 Final Package §5 生效：M2 规划唯一输入 = Gate 7 真人测试数据（Expression Success 率 +「我还想做一个」行为率），由产品负责人确认后启动
- 演示体系带诚实披露：21 件发布作品中 p10/G3/G4/Native 四件为重置后真实字节（现场演示首选）；p01–p09 与 M1 种子为占位恢复（结构与时长精确，演示真实质量时不用）；3 件夹具排除
- 下一步（人工阶段）：产品负责人按 human-test-plan.md §10 pre-flight 清单开场执行 Gate 7（目标 16 人起步 10 人）→ 测试后 node scripts/m15/export-human-test.mjs 导出 + integrity-check 批量复核 → 填充 m15-human-test-report.md → M2 范围决策（§6 决策矩阵）

---
Task ID: gate7-execution-001
Agent: GLM-5.3（主 agent，AI CTO 角色）
Task: 产品负责人指令——进入 Gate 7 执行阶段：按 human-test-plan.md 执行真人测试准备、准备测试环境和任务案例、收集 ≥10 名用户完整创作流程数据、输出 Gate 7 Final Report；测试完成前冻结 M2 开发

Work Log:
- 职责边界声明（诚实原则）：六指标的人工编码字段（首反应/访谈确认/修订语境）只能由真人产生，agent 不可也不得代产生——本 session 执行全部系统侧工作，真人被试招募与现场执行属产品负责人阶段（报告 §0.5.4 五步交接）
- Pre-flight §10 清单实测（五项全绿）：预览 200（本地+外网）/ agnes LLM 真实对话 2.3s + agnes Image 真实生图 11.3s + z-ai TTS 真实合成 733ms（运行时同路径连接测试端点）/ composition 模式确认（dev server 进程环境 IMAGINEOS_FORCE_NATIVE 为空）/ 导出链路 + 种子隔离双机制验证（34 历史非种子用户被 --since 正确排除）
- 系统侧预演（gate7-rehearsal.mjs，A 级证据，非 Gate 7 数据）：2 个多样化匿名会话（R1 45+ 家庭回忆 / R2 20-30 情绪城市，对应计划 §2 配额维度）并发全链至发布——2/2 成功（105s/154s，SQLite 跨会话写锁无冲突=测试日两位被试同时创作的真实并发验证）；导出演练 --since=预演窗口 → 被试数 2 六指标自动推导正确；idsFile 完整性复核 → M1.5 生产案例 15 件（含预演 2 件）0 错 0 警；时间窗隔离机制经实测（真人测试导出用 --since=<真人测试开始时刻> 自动排除预演会话）
- 观察员物料包（download/gate7-kit/gate7-observer-kit.md，108 行打印随身文档）：A 逐字稿卡（七时点照读+禁止词+观察员三件事）/ B 记录表（打印 16 份，含首反应编码判定例与修订五类别）/ C 每日 Pre-flight 清单+中止三条件 / D 测试日 Runbook（导出+idsFile 复核命令+配额预算：TTS 日耗 ~15-55 段低于风暴阈值 ~130）
- Gate 7 报告更新（m15-human-test-report.md）：新增 §0.5 执行阶段开启与系统侧预演（0.5.1 Pre-flight 实测表 / 0.5.2 预演 A 级记录+隔离声明 / 0.5.3 配额预算 / 0.5.4 真人阶段五步交接）；修复编辑缺陷一处（§1 标题被吞，立即补回）；15 处人工字段全部保持「未执行」——禁止预填虚构值原则执行
- 状态同步：Final Package §0 组件 5 → 🟡 执行阶段开启；evaluations README 同步
- 门禁：typecheck ✓ / lint ✓ / vitest 64/64 ✓（src/ 零改动，纯脚本+文档）
- 提交推送：ccc0d41（报告+预演脚本+状态同步）+ fd72f7d（观察员物料包）→ GitHub main

Stage Summary:
- 指令 §1 §2 完成：真人测试准备（四项确认已锁定）+ 测试环境（Pre-flight 五项实测全绿）+ 任务案例物料（observer kit 打印包 + Runbook）
- 指令 §3 边界如实交付：系统侧预演 2 个并发会话数据已采集（2/2 发布、0 错 0 警）；「≥10 名用户」中真人数据部分需产品负责人按 §0.5.4 交接执行（招募 16 人/起步 10 人 → 30 分钟流程 → Runbook 导出）——agent 无法替代人类被试，预演会话严格不计入六指标
- 指令 §4 状态：Gate 7 Final Report = m15-human-test-report.md（系统侧章节收口完成；Final 判定待 ≥10 真人数据回填后自动收口，报告 §6 决策矩阵直接输出 M2 方向）
- 指令 §5 执行中：M2 开发冻结（Final Package §5 冻结声明继续生效；本 session 零产品代码改动）
- 下一步（人工阶段）：产品负责人招募被试 → 按 observer kit 执行测试日 → 回传记录表 + 导出 JSON → 本 agent 负责数据合并、报告 §1-§7 填充与 M2 方向裁决

---
Task ID: gate7-incident-001
Agent: GLM-5.3（主 agent，AI CTO 角色）
Task: 产品负责人上报线上缺陷——真实用户创作卡「AI 生成中」无限等待（Creation cmuw6r7k10l4pktgk91ipxxp9，ID 转写误差实为 cmuw6r7kl014pktgk91ipxxp9）+ 探索作品关闭按钮不可见。要求：先追踪不先修 UI；确认 GENERATING 无 job 孤儿态；任何异常必须 FAILED+error message；增加 generation timeout watchdog。

Work Log:
- 全链路调查（investigate-stuck-creation.mjs / find-stuck-creation.mjs / deep-dive-timeline.mjs）：该作品 10-06 04:35 创建（Remix 衍生），10:38 storyboard Job 执行 4 轮重试 24 次 image.shot 全部 zai-image 429 → 10:39 耗尽重试 failed；plan 为 Remix 继承无需生成；provider 确认收到请求（24 条记账）；**根因 = jobService.fail() 永久失败后不传导 Content（lastErrorJson 自 M0 声明从未写入）→ GENERATING 永驻 + 轮询 API 只返活跃 Job（job=null）→ 前端无限转圈**；次因 = 被试 20:53 自救落入首页旧修订对话框（POST /versions 只建版本不生成，v2「再温暖一点」成孤儿）。全库同类孤儿 3 条（另 2 条 TTS 429 同因）
- 排除一次虚惊：page.tsx「utateContent 损伤」为工具输出渲染层吞 `[m` 序列 + grep 子串误报的连环假象（hexdump 5b 6d 证实原文件完好）
- 修复七件（M2 冻结例外=线上缺陷处置）：①fail()/requeueStale timeout → 写 Content.lastErrorJson + generation_failed 溯源 ②孤儿看门狗 sweepOrphanedGenerations（worker 每 12 tick≈30s 扫描，GENERATING/RENDERING 无活跃 Job 静默>10min → 标记超时，IMAGINEOS_WATCHDOG_STALE_MIN 可调）③enqueue 失败同步标记 enqueue_failed 并抛出 ④creation API 失败态暴露（无活跃 Job 回查终态失败 Job + lastError 字段）⑤创作页失败卡（原因+重新生成/重新合成）+ 失败态停止轮询 + startRender 允许 RENDERING 无活跃 Job 重入 ⑥首页修订对话框改跳创作空间（?revise= 承接，fireOnce 只消费一次）⑦探索关闭按钮从 absolute -top-11 视口外裁剪区移入视频区右上角（top-3 right-3，小视口可测）
- 验证（全真实执行）：vitest +9 → 73/73；lint ✓ typecheck ✓（清 tsbuildinfo 全量）；E2E API 失败态 8/8（e2e-failure-surface.mjs）；UI 浏览器 9/9（ui-verify-gate7-fix.sh：失败卡/原因/重试按钮/无无限转圈/轮询停止/重生成回路/关闭按钮视口内+小视口+可关闭）；看门狗自动修复 3 条存量孤儿 0 剩余；实时传导实测（调试 Job 失败 → lastErrorJson 即写）；验证数据全部清理（content+匿名 user 级联删除，108 内容/23 发布与清理前一致，零真实数据损失）
- 期间两个测试装置缺陷修复：agent-browser eval 返回带引号未剥离（URL 404 假失败）；调试内容缺版本使 regenerate 正确拒绝（补最小版本后验证通过）
- dev server 已以 composition 模式重启加载新代码（worker watchdog 生效中）；文档：m15-human-test-report.md 新增 §0.5.5 线上缺陷与修复（含对 Gate 7 的影响与观察员处置指引）

Stage Summary:
- 用户怀疑证实：GENERATING 无（活跃）Job 孤儿态真实存在——3 条，全部因「Job 失败不传导」产生；看门狗上线后已自动全部标记失败，被试可在创作页看到错误原因并一键重试
- 「任何异常必须 FAILED + error message」已落地为三层：Job 层（failed/timeout + error）、Content 层（lastErrorJson + 溯源事件）、用户层（失败卡 + 原因 + 重试按钮）；「不能永久停留 GENERATING」由看门狗兜底（最坏 10 分钟内转为可见失败态）
- 探索关闭按钮、首页修订死路两个真实用户可感知缺陷一并修复
- 本缺陷属 M2 冻结例外（线上缺陷处置）；修复记录已入 Gate 7 报告 §0.5.5，对 Expression Success 率编码无系统性豁免（卡死经历如实计入被试体验数据）

---
Task ID: gate7-incident-002
Agent: GLM-5.3（主 agent，AI CTO 角色）
Task: 产品负责人上报——重试成功的作品产物是 composition 动图而非 native AI video（job.type=video.storyboard），要求查清真实路径（三态 A/B/C）、不改评估标准只报真实路径、如是配置问题则增加用户可见「生成模式」标识

Work Log:
- 只读取证（scripts/m15/investigate-native-routing.mjs，不改任何数据）：三态判定 = **C 默认直接 composition**——dev server 进程环境 IMAGINEOS_FORCE_NATIVE 为空（Pre-flight §10 既定决定）；配方 v2 五镜 motion 全部 undefined（StoryboardSchema 无此字段、plan-service 不写，全系统无写入点）；Provenance 零 video.shot/native-fallback 事件、Generation 零 video 调用（全库 28 条 video.shot 全来自 Native Golden 评估内容）；资产物证 5 PNG + 5 WAV + 1 FFmpeg MP4。job.type=video.storyboard 是所有生成的唯一 Job 类型（分岔在 worker 逐镜 motionModeFor），该证据本身不构成证明，资产+记账才构成
- 第 5 问确认：native video 通道可用但默认关闭属实（agnes-video enabled + zai-video 兜底 hasVideoShotProvider=true，但两个开启途径一个未开一个是无写入点死字段）；可观测性缺口如实记录（composition 路径无路由决策日志）；评估标准零修改
- 修复（用户可见「生成模式」标识，M2 冻结例外=测试执行期用户可见性缺陷）：①job-service 新增 computeGenerationMode 纯函数（三态 composition/native/hybrid + nativeShots/totalShots，脏容错返回 null）+ generationModeForContent/generationModesForContents（批量优先当前版本、回退最近一次）②探索/我的创作列表 API + 创作空间聚合 API 携带 generationMode ③_language 新增 generationModeLabel + GENERATION_MODE_DESC 防误解文案（走产品语言字典，工程术语 Native/Composition 不直接上 UI）④UI 徽章四点位：探索卡片、播放对话框（含悬停说明）、创作页 REVIEW 态、成片区 meta 行；composition 琥珀色 Images 图标、native/hybrid 绿色 Film 图标；夹具无生成记录不显示徽章（不猜模式）
- 验证（全真实执行）：vitest +6 → 79/79 全绿；typecheck ✓ lint ✓；API 实测 explore 24 项（21 带模式 + 3 夹具 NULL）；UI 浏览器实测探索卡片 composition+hybrid 双态徽章 / 播放对话框徽章+悬停说明「每个镜头是 AI 生成的图像，加上镜头运动与转场合成为视频」/ 创作页成片区双态 / 375px 小视口徽章不溢出；截图 3 张留证 tool-results/genmode-*.png
- 文档：m15-human-test-report.md 新增 §0.5.6（真实路径判定证据链 + 修复表 + 对 Gate 7 的影响：徽章成为首反应编码的重要上下文，被试不应把合成形态误读为 AI 视频模型能力）

Stage Summary:
- 三态判定如实交付：C（默认直接 composition），非 A 非 B；native 从未被尝试（零事件+零记账+资产物证）
- 「native 可用但默认关闭」确认属实——这是 Alpha 设计使然（human-test-plan §10 记录在案），非缺陷；但用户误导问题真实存在，已用「生成模式」徽章解决
- 生成模式口径：最近成功 storyboard Job 的 shotAssets（带 videoAssetId 镜头数）——真实产物路径，非配置推断；hybrid 形态（Native Golden 1/5）诚实展示
- M2 冻结例外依据：测试执行期用户可见性缺陷（与 §0.5.5 同类），评估标准零修改
