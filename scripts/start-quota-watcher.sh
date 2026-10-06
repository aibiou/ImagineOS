#!/bin/bash
# 启动配额守望器（孤儿化模式——与 restart-dev.sh 同款已验证存活模式）
cd /home/z/my-project
pkill -f "quota-watcher.mjs" 2>/dev/null
sleep 1
nohup node scripts/quota-watcher.mjs > /tmp/quota-watcher-out.log 2>&1 < /dev/null &
LAUNCHER=$!
# 等待首轮探测完成（证据：日志出现「守望器启动」）
for i in $(seq 1 15); do
  if grep -q "守望器启动" scripts/m15/state/quota-watch.log 2>/dev/null; then
    echo "✓ 守望器已启动（launcher=$LAUNCHER）"
    exit 0
  fi
  sleep 2
done
echo "✗ 守望器启动异常（查看 /tmp/quota-watcher-out.log）"
exit 1
