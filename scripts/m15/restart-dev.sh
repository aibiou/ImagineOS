#!/bin/bash
# scripts/m15/restart-dev.sh —— 以指定运动模式重启 dev server（孤儿化以跨工具调用存活）
# 用法：bash scripts/m15/restart-dev.sh [product|native|composition]
#   product     → 不设任何开关（产品默认：native-first，视频失败诚实报错，绝不降级）
#   native      → IMAGINEOS_FORCE_NATIVE=1（全镜强制 native，评估/对照用）
#   composition → IMAGINEOS_FORCE_COMPOSITION=1（运维逃生阀：⚠️ 输出为动态图片而非 AI 视频）
#                 ⚠️ 2026-10-20 产品负责人红线：composition 仅限运维/评估，需产品负责人明示批准；
#                 产品与种子流程一律 product 模式——「要真AI视频，生成不了就报错，不要欺骗用户」
set -u
MODE="${1:-product}"

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
export IMAGINEOS_FORCE_COMPOSITION="$([ "$MODE" = "composition" ] && echo 1 || echo '')"
nohup ./node_modules/.bin/next dev -p 3000 > /tmp/m15-dev-$MODE.log 2>&1 < /dev/null &
LAUNCHER=$!

# 逃生阀显式警告（composition 输出动态图片，非真 AI 视频）
if [ "$MODE" = "composition" ]; then
  echo "⚠️  警告：composition 模式输出【动态图片】而非真实 AI 视频。仅限运维/评估用途。"
  echo "⚠️  产品负责人红线（2026-10-20）：产品与种子流程禁止使用本模式，除非产品负责人明示批准。"
fi

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
