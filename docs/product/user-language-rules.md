# ImagineOS 用户语言规则（User Language Rules）

> 文档地位：UI 文案唯一规范 · GitHub 主事实源
> 落地实现：`src/app/_language/index.ts`（产品语言字典——UI 唯一文案规范源）
> 定稿：2026-10-06（GitHub 阶段升格）

## 1. 总原则

> **复杂性留给 ImagineOS，简单留给用户。**

- 技术语言留在代码和开发文档。
- 用户界面必须使用自然、直白的中文。
- 底层技术模型不得直接成为用户界面语言。
- 工程术语只允许出现在：内部元数据、Debug/Admin 界面、开发文档。

## 2. 核心映射表

| 内部概念 | 用户语言 | 禁止出现 |
|----------|----------|----------|
| Intent / Intent Engine | 理解我的想法 / 我听到了这些 | Intent、意图引擎 |
| Content Object | 作品 | Content Object、内容对象 |
| Remix | **从这里开始创作** | Remix、二创、Remix 这个作品 |
| Version (v1/v2) | 初稿 / 第 2 版 / 共 X 版 | V0/V1/V2、版本号 |
| Generation / Pipeline | AI 创作 / AI 创作团队 | Generation、Pipeline、Provider |
| Provenance | 内容来源 / 每一件作品都带着它的完整来路 | Provenance、溯源 |
| Creative Plan / Direction | 创作方向 / 挑选方向 | Creative Plan、Concept |
| Storyboard | 分镜（确认） | Storyboard、shot 列表 |
| cameraMotion | 缓缓推近 / 缓缓拉远 / 向左移动 / 向右移动 / 静静注视 | zoom_in、pan_left |
| render / compose | 渲染成片 / 满意，渲染成片 | render、FFmpeg、合成管线 |
| regenerate | 换一批画面 | regenerate、重试生成 |
| restore version | 回到这一版 | restore、回滚 |
| publish | 发布作品 | publish、上线 |

## 3. 版本与修订语言

- 「初稿」：第 1 版（不再显示 V0/V1）
- 「第 2 版 · 共 3 版」：多版本时
- 修订动作：「你想怎么改？」「继续修改」「就这样改，重新生成」
- 修订承诺：「旧版本随时可以在版本历史里找回」

## 4. Remix 语言（2026-10-06 修订）

普通用户界面**禁止直接显示 Remix**。默认显示：

> **从这里开始创作**

- 卡片入口：「从这里开始创作」
- 发布提示：「已发布 · 别人可以从这里开始他们的创作」「任何人都能从这里开始自己的创作」
- 血缘展示：「从《xxx》开始」（作品从哪里来）
- 技术内部继续使用 Remix（代码、数据库、API、开发文档），没有问题。

> 历史备注：M1 曾用「从这里开始我的版本」；GitHub 阶段统一为「从这里开始创作」——"创作"比"我的版本"更贴合 Creation Loop 的产品叙事，且更短。

## 5. 状态与进度语言

| 状态机值 | 用户语言 |
|----------|----------|
| IDEA | 理解你的表达 |
| INTENT / PLANNING | 挑选创作方向 |
| STORY / STORYBOARD | 展开故事 / 分镜确认 |
| GENERATING | AI 生成中（正在绘制镜头画面 n/m… 正在为镜头配音 n/m…） |
| REVIEW | 预览与调整 |
| RENDERING | 渲染成片 |
| READY | 就绪 |
| PUBLISHED | 已发布 |

失败与重试：「有点小波折，正在重试——你的创作不会丢。」

## 6. 核心入口语言（禁改）

> **"你想表达什么？"**

首页英雄区唯一核心入口。不得改为"请输入 Prompt""描述你想要的视频"等任何工程化表述。

## 7. 执行机制

- 所有 UI 文案改动先改 `src/app/_language/index.ts`（单一规范源），再改页面引用；
- 新增界面文案必须经过本表对照，映射表中没有的内部概念不得直接上屏；
- 每个里程碑验收时对本文件做一次全站扫描（M1.5 已执行：扫描证据见 Expression Quality Report 的 UX 语言章节）。
