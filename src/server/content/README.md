# packages/content — Content Object 域层
作品 = 可继续创造的状态树（charter §7 红线）。版本记录 append-only 不可变（ADR-002）。
依赖方向：仅 db/env。禁止 import intent/planner/jobs/media/ai/commands（这些是上层）。
