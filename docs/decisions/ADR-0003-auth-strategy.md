# ADR-0003：Alpha 认证 —— 最小会话身份 + 完整 User 实体预留

- 日期：2026-10-05
- 状态：**Accepted**（2026-10-05 产品负责人确认）
- 决策人：产品负责人（确认方）；GLM-5.3（建议方）

## 问题

Alpha 是否需要完整注册登录体系？

## 背景

Alpha 验证的是创作链路（Intent → Content Object → Publish → Remix），不是账号体系。但 §47 要求 User / Identity 实体从第一版建立。

## 方案 A：完整认证（邮箱/手机号 + NextAuth）

- 优点：接近生产形态
- 缺点：Alpha 用户多一步注册流失；NextAuth provider 配置与本环境无 SMTP/短信服务冲突

## 方案 B（采纳）：设备级匿名会话 + 完整实体预留

- `User` / `Identity` 表按完整体系建立（Identity.type 预留 `session` 之外的 `email`/`oauth` 类型）
- 首次交互（调用任何写 API）自动创建匿名用户：生成昵称（如"旅人-3f2a"）+ `session` 型 Identity（httpOnly cookie 存 token）
- 无密码、无注册墙；未来接入正式认证 = 给 Identity 表加新 type，User 不动

## 影响

- Remix / 作品归属 / Permissions 全部从第一版就有真实 userId 支撑
- 匿名用户可在 Profile 自助改名/设头像，平滑升级为正式账号（未来）

## 替代方案（为何不选）

方案 A：注册墙直接伤害 Alpha 核心指标 Expression Success Rate 的测量（用户没开始创作就流失了）。
