#!/bin/bash
# scripts/m15/supervise-finish.sh —— 编排器监督者
# 背景：2026-10-06T20:52 finish-m15 进程树被外部 SIGKILL 击杀（无 FATAL 输出）。
# 策略：循环重启编排器（全部子脚本断点续跑幂等），成功（退出码 0）即停。
LOG=/tmp/m15-finish3.log
cd /home/z/my-project
for i in $(seq 1 12); do
  echo "[supervisor] 第 $i 轮启动 finish-m15 ($(date '+%m-%d %H:%M:%S'))" >> "$LOG"
  node scripts/m15/finish-m15.mjs >> "$LOG" 2>&1
  code=$?
  echo "[supervisor] finish-m15 退出码 $code ($(date '+%m-%d %H:%M:%S'))" >> "$LOG"
  if [ $code -eq 0 ]; then
    echo "[supervisor] 编排器成功完成，监督者退出" >> "$LOG"
    break
  fi
  sleep 15
done
