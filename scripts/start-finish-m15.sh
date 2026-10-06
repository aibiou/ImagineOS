#!/bin/bash
# 启动 Phase B 编排器（孤儿化模式，日志 /tmp/m15-finish.log）
cd /home/z/my-project
pkill -f "finish-m15.mjs" 2>/dev/null
sleep 1
nohup node scripts/m15/finish-m15.mjs > /tmp/m15-finish.log 2>&1 < /dev/null &
LAUNCHER=$!
sleep 3
if kill -0 $LAUNCHER 2>/dev/null && grep -q "编排器启动" /tmp/m15-finish.log 2>/dev/null; then
  echo "✓ Phase B 编排器已启动（launcher=$LAUNCHER，等待 TTS 恢复后自动补跑）"
  tail -5 /tmp/m15-finish.log
else
  echo "✗ 编排器启动异常："
  tail -10 /tmp/m15-finish.log
  exit 1
fi
