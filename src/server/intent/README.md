# packages/intent — Intent Engine
NL → 结构化 Intent Object（zod 校验，user_specified vs ai_default 全标记）。
依赖方向：db/env、ai（经 Model Router 调 LLM）。禁止 import planner/jobs/media/content。
