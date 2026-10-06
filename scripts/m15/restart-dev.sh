#!/bin/bash
# scripts/m15/restart-dev.sh —— 以指定运动模式重启 dev server（孤儿化以跨工具调用存活）
# 用法：bash scripts/m15/restart-dev.sh [native|composition]
#   native      → IMAGINEOS_FORCE_NATIVE=1（Gate 6b Golden Case 专用）
#   composition → 默认路径（其余全部流程）
set -u
MODE="${1:-composition}"

cd /home/z/my-project

# 1) 停掉现有 dev server（next dev 包装进程 + next-server）
pkill -f "next dev -p 3000" 2>/dev/null
pkill -f "next-server" 2>/dev/null
sleep 2

# 2) 等待端口释放
for i in $(seq 1 10); do
  if ! (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null; then break; fi
  sleep 1
done

# 3) 以新模式启动（后台 + 脱离会话；启动包装进程自行退出，next-server 被 init 接管长期存活）
export IMAGINEOS_FORCE_NATIVE="$([ "$MODE" = "native" ] && echo 1 || echo '')"
nohup ./node_modules/.bin/next dev -p 3000 > /tmp/m15-dev-$MODE.log 2>&1 < /dev/null &
LAUNCHER=$!

# 4) 等待就绪
for i in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 2 http://localhost:3000/ 2>/dev/null; then
    echo "✓ dev server 已以 $MODE 模式启动（launcher=$LAUNCHER）"
    exit 0
  fi
  sleep 2
done
echo "✗ dev server 启动超时（查看 /tmp/m15-dev-$MODE.log）"
exit 1
