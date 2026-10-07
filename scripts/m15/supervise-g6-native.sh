#!/bin/bash
# supervise-g6-native.sh —— Native Golden Case 监督者（同 supervise-finish.sh 模式）
# 背景：本环境会外部 SIGKILL 后台进程树（2026-10-06T20:52 首次记录；12:13-12:16 守望器+golden 双杀）。
# 策略：循环重启 run-native-golden（driveCase 断点续跑幂等），退出码 0（完成）即停。
LOG=/home/z/my-project/scripts/m15/state/g6-native-run.log
cd /home/z/my-project
for i in $(seq 1 12); do
  echo "[supervisor] 第 $i 轮启动 run-native-golden ($(date '+%m-%d %H:%M:%S'))" >> "$LOG"
  node scripts/m15/run-native-golden.mjs >> "$LOG" 2>&1
  code=$?
  echo "[supervisor] run-native-golden 退出码 $code ($(date '+%m-%d %H:%M:%S'))" >> "$LOG"
  if [ $code -eq 0 ]; then
    echo "[supervisor] Golden Case 完成，监督者退出（下一步：restart-dev.sh composition 恢复 Gate 7 默认）" >> "$LOG"
    break
  fi
  sleep 15
done
