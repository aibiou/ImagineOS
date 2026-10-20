# packages/database 映射（ADR-001）
Prisma schema: prisma/schema.prisma；Client 入口: @/lib/db。
仅 src/server/** 与 src/lib/db.ts 可引用 client；UI 一律经 API。SQLite 纪律：schema 保持 PostgreSQL 可迁移（禁 SQLite 方言依赖）。
