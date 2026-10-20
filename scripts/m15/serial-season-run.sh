#!/usr/bin/env bash
# serial-season E2E 一体化驱动（静默版）：起 dev server → 跑指定段 → 关服务 → 日志落盘
# 用法：bash scripts/m15/serial-season-run.sh <phase> <timeoutSec> <logfile>
set -u
PHASE="${1:-all}"
TMO="${2:-420}"
LOG="${3:-/home/z/my-project/scripts/m15/state/serial-season-run.log}"
cd /home/z/my-project
mkdir -p "$(dirname "$LOG")"

pkill -f "next dev" 2>/dev/null || true
pkill -f next-server 2>/dev/null || true
sleep 3

./node_modules/.bin/next dev -p 3000 > dev.log 2>&1 &

for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 "http://127.0.0.1:3000/api/contents/xxx/creation" 2>/dev/null)
  if [ "$code" -ge 200 ] 2>/dev/null || [ "$code" = "404" ]; then echo "[run] server ready (http $code, $((i*3))s)" >> "$LOG"; break; fi
  sleep 3
done

RC=0
timeout "$TMO" node "scripts/m15/serial-season-e2e.mjs" "$PHASE" >> "$LOG" 2>&1 || RC=$?

pkill -f "next dev" 2>/dev/null || true
pkill -f next-server 2>/dev/null || true
echo "[run] phase=$PHASE rc=$RC" >> "$LOG"
exit $RC
