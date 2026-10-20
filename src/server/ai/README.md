# packages/ai + model-router（Brief §27/§28）
分层：orchestrator → router → adapters → 外部模型。业务层禁止出现 provider 名字与 `if provider ==` 判断；
z-ai-web-dev-sdk 仅允许出现在 ai/adapters/**（ESLint 强制）。
