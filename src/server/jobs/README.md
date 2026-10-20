# workers/generation — Generation Jobs
DB-backed 队列 + 进程内 Worker（接口对齐 BullMQ：enqueue/process/retry/fail）。
依赖方向：content、ai、media、db。禁止 import commands/http。
