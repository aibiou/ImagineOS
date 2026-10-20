# HTTP 绑定层（ADR-002 薄传输）
route handler = 解析 → executeCommand → 序列化。禁止业务逻辑（ESLint 强制：
api 仅可 import @/server/commands/**、@/server/http、@/server/env）。
