#!/bin/bash
# supervise-e2e-share.sh —— E2E 分享链路监督者（同 supervise-g6-native.sh 模式）
# 背景：本环境会外部 SIGKILL 后台进程树（supervise-g6-native.sh 已记录）。
# 策略：循环重启 e2e-share-driver（断点续跑：状态+cookie 落 /tmp/e2e-share-state.json），
# 退出码 0（完成）即停。生成 Job 由 next-server 内 worker 执行，驱动只轮询——
# 驱动被杀不影响服务端生成进度。
LOG=/home/z/my-project/scripts/m15/state/e2e-share-run.log
mkdir -p /home/z/my-project/scripts/m15/state
cd /home/z/my-project
for i in $(seq 1 60); do
  echo "[supervisor] 第 $i 轮启动 e2e-share-driver ($(date '+%m-%d %H:%M:%S'))" >> "$LOG"
  node scripts/m15/e2e-share-driver.mjs >> "$LOG" 2>&1
  code=$?
  echo "[supervisor] driver 退出码 $code ($(date '+%m-%d %H:%M:%S'))" >> "$LOG"
  if [ $code -eq 0 ]; then
    echo "[supervisor] E2E 分享链路验证完成，监督者退出" >> "$LOG"
    break
  fi
  sleep 10
done
