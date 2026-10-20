#!/usr/bin/env bash
# restore-demo-after-reset.sh —— 平台沙箱重置后的一键演示恢复（2026-10-20 事故响应）
# 背景：平台自动重启只保留 git 跟踪文件；db/、storage/（gitignore）被洗掉。
# 本脚本幂等：每步可独立重跑；seed 自带断点续跑（按标题查重 + Job drain）。
set -x
cd /home/z/my-project
LOG=.zscripts/restore-demo.log
: > "$LOG"

echo "[1/5] 停 dev server（释放 SQLite 锁）" | tee -a "$LOG"
kill "$(cat .zscripts/dev.pid 2>/dev/null)" 2>/dev/null
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
sleep 3

echo "[2/5] 重建 schema（清掉平台模板残留库——仅 User/Post 空表，无价值数据）" | tee -a "$LOG"
rm -f db/custom.db
bunx prisma db push --force-reset --accept-data-loss >> "$LOG" 2>&1 || { echo "db push 失败" | tee -a "$LOG"; exit 1; }

echo "[3/5] 恢复供给配置（agnes 三通道 priority=10 + ant-ling priority=5）" | tee -a "$LOG"
node scripts/m15/restore-provider-config.mjs >> "$LOG" 2>&1 || { echo "供给配置失败" | tee -a "$LOG"; exit 1; }

echo "[4/5] 拉起 dev server（composition 模式——native 视频 503 期间的诚实基线）" | tee -a "$LOG"
bash scripts/m15/restart-dev.sh composition >> "$LOG" 2>&1
sleep 12
curl -s -o /dev/null -w "dev server: HTTP %{http_code}\n" http://localhost:3000 >> "$LOG"

echo "[5/5] 种子真实管线（§63 全链 + 2 探索作品 + 1 Remix；最多 8 轮×700s 续跑）" | tee -a "$LOG"
for i in 1 2 3 4 5 6 7 8; do
  echo "--- seed 轮次 $i ---" >> "$LOG"
  IMAGINEOS_FORCE_COMPOSITION=1 timeout 700 bun run db:seed >> "$LOG" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then echo "seed 干净完成于轮次 $i" >> "$LOG"; break; fi
  echo "seed 轮次 $i 退出码 $rc（timeout=124 则断点续跑）" >> "$LOG"
done
node scripts/check-seed.mjs >> "$LOG" 2>&1
echo "===恢复流程结束===" >> "$LOG"
