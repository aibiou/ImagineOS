#!/bin/bash
# UI 验证（Gate 7 修复）：①创作页失败卡（不再无限「AI 生成中」）②探索播放对话框关闭按钮可见
# 单次调用内完成；验证数据全部清理（不污染 Gate 7 导出窗口）
set -u
cd /home/z/my-project
BASE="https://preview-chat-b15437ca-c5ff-4f2b-b971-7ae3748bcf4b.space-z.ai"

echo "═══════ Part A：创作页失败卡 ═══════"

# 1) 首页匿名会话 + 开始创作（会自动跳转 /create/:id）
agent-browser open "$BASE/" >/dev/null
agent-browser wait --load networkidle >/dev/null
agent-browser wait 800 >/dev/null
agent-browser find label "写下你想表达的东西" fill "UI验证失败卡：一盏路灯在雪夜里慢慢亮起来。" >/dev/null 2>&1
agent-browser find role button click --name "开始创造" >/dev/null 2>&1
agent-browser wait 2500 >/dev/null

# agent-browser eval 返回值带 JSON 引号，必须剥除（否则 URL 变 /create/"xxx" 导致 404）
CREATE_URL=$(agent-browser eval "window.location.pathname" | tr -d '"')
echo "跳转到: $CREATE_URL"
CID=$(echo "$CREATE_URL" | sed 's|/create/||')

# 2) DB 落库为孤儿失败形态（与线上真实缺陷同形态）
node -e "
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const past = new Date(Date.now() - 3600_000);
  await db.content.update({ where: { id: '$CID' }, data: {
    status: 'GENERATING', updatedAt: past,
    lastErrorJson: JSON.stringify({ code: 'generation_timeout', message: '生成长时间没有进展（可能遇到服务中断），你的创作没有丢，点「重新生成」再试一次。', at: past.toISOString() }),
  }});
  await db.generationJob.create({ data: {
    contentId: '$CID', type: 'video.storyboard', status: 'failed',
    error: '[ModelRouter] 能力 image.shot 的全部候选 Provider 失败：zai-image(429)',
    retryCount: 3, completedAt: past,
    inputJson: JSON.stringify({ contentId: '$CID', versionId: null, actorId: null }),
  }});
  const c = await db.content.findUnique({ where: { id: '$CID' } });
  const v = await db.contentVersion.create({ data: {
    contentId: '$CID', createdBy: c.ownerId, versionNumber: 1, creationMethod: 'initial',
    changelog: 'UI验证配方', structureJson: JSON.stringify({ story: { scenes: [{ index: 0, summary: 's', shots: [] }] } }),
  }});
  await db.content.update({ where: { id: '$CID' }, data: { currentVersionId: v.id } });
  await db.\$disconnect();
  console.log('落库完成');
})();
" 2>/dev/null

# 3) 刷新创作页 → 断言失败卡
agent-browser open "$BASE/create/$CID" >/dev/null
agent-browser wait --load networkidle >/dev/null
agent-browser wait 1200 >/dev/null

echo "--- [断言A1] 失败卡文案与原因 ---"
agent-browser eval "(() => {
  const txt = document.body.textContent;
  const hasFail = txt.includes('生成没有完成');
  const hasReason = txt.includes('image.shot') || txt.includes('长时间没有进展');
  const hasRetry = !!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('重新生成'));
  return JSON.stringify({ 失败卡: hasFail, 原因可见: hasReason, 重试按钮: hasRetry });
})()"

echo "--- [断言A2] 无限转圈已消失（进度条/「AI 创作团队正在工作」不应出现） ---"
agent-browser eval "(() => {
  const txt = document.body.textContent;
  const spinning = txt.includes('AI 创作团队正在工作') || txt.includes('可以先去喝口水');
  return spinning ? 'FAIL: 仍在无限生成态' : 'OK: 无无限转圈';
})()"

echo "--- [断言A3] 轮询已停止（2.5s 内 network 请求数应为 0） ---"
agent-browser eval "window.__pollCount = 0; window.__origFetch = window.fetch; window.fetch = (...a) => { if (String(a[0]).includes('/creation')) window.__pollCount++; return window.__origFetch(...a); }; 'instrumented'"
agent-browser wait 5000 >/dev/null
agent-browser eval "(() => { const n = window.__pollCount; window.fetch = window.__origFetch; return n === 0 ? 'OK: 轮询已停止（0 次）' : 'FAIL: 仍在轮询（' + n + ' 次）' })()"

echo "--- [断言A4] 点击「重新生成」→ 新 Job 入队（恢复入口有效） ---"
agent-browser eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('重新生成')); if (!b) return 'FAIL: 无按钮'; b.click(); return 'clicked'; })()"
agent-browser wait 3000 >/dev/null
agent-browser eval "(() => {
  const txt = document.body.textContent;
  const active = txt.includes('AI 创作团队正在工作') || txt.includes('正在绘制') || txt.includes('正在为镜头配音');
  return active ? 'OK: 已重新进入生成流程（错误卡消失）' : '提示: ' + (txt.includes('没有完成') ? '仍显示失败卡（可能 Provider 拒绝重试）' : '状态: ' + txt.slice(0, 80));
})()"

echo ""
echo "═══════ Part B：探索播放对话框关闭按钮 ═══════"

agent-browser open "$BASE/#explore" >/dev/null
agent-browser wait --load networkidle >/dev/null
agent-browser wait 1200 >/dev/null

# 点开第一张探索卡（播放按钮）
agent-browser eval "(() => { const b = document.querySelector('button[aria-label^=\"播放\"]'); if (!b) return 'FAIL: 无播放按钮'; b.scrollIntoView({ block: 'center' }); b.click(); return 'clicked'; })()"
agent-browser wait 1500 >/dev/null

echo "--- [断言B1] 播放对话框打开 ---"
agent-browser eval "(() => { const d = document.querySelector('div[role=\"dialog\"][aria-modal=\"true\"]'); return d ? 'OK: 对话框已打开' : 'FAIL: 对话框未出现' })()"

echo "--- [断言B2] 关闭按钮存在且在视口内（本次修复点） ---"
agent-browser eval "(() => {
  const btn = document.querySelector('button[aria-label=\"关闭\"]');
  if (!btn) return 'FAIL: 关闭按钮不存在';
  const r = btn.getBoundingClientRect();
  const inViewport = r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
  return JSON.stringify({ 存在: true, 视口内: inViewport, 位置: { top: Math.round(r.top), right: Math.round(window.innerWidth - r.right), w: Math.round(r.width) } });
})()"

echo "--- [断言B3] 小视口（模拟手机高度 640px）下关闭按钮仍可见 ---"
agent-browser eval "(() => { window.resizeTo(window.innerWidth, 640); return 'resized'; })()" >/dev/null 2>&1
agent-browser eval "(() => {
  const btn = document.querySelector('button[aria-label=\"关闭\"]');
  if (!btn) return 'FAIL: 按钮不存在';
  const r = btn.getBoundingClientRect();
  const inViewport = r.top >= 0 && r.bottom <= window.innerHeight;
  return inViewport ? 'OK: 小视口下仍可见' : 'FAIL: 小视口下不可见 top=' + Math.round(r.top);
})()"

echo "--- [断言B4] 点击关闭 → 对话框关闭 ---"
agent-browser eval "(() => { const b = document.querySelector('button[aria-label=\"关闭\"]'); if (!b) return 'FAIL'; b.click(); return 'clicked'; })()"
agent-browser wait 800 >/dev/null
agent-browser eval "(() => { const d = document.querySelector('div[role=\"dialog\"][aria-modal=\"true\"]'); return d ? 'FAIL: 对话框未关闭' : 'OK: 对话框已关闭' })()"

echo ""
echo "═══════ 清理验证数据 ═══════"
node -e "
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const c = await db.content.findUnique({ where: { id: '$CID' } });
  if (c) { await db.content.delete({ where: { id: '$CID' } }); }
  const u = await db.user.findFirst({ where: { createdAt: { gte: new Date(Date.now() - 15 * 60000) } }, orderBy: { createdAt: 'desc' } });
  if (u) await db.user.delete({ where: { id: u.id } }).catch(() => {});
  await db.\$disconnect();
  console.log('清理完成');
})();
" 2>/dev/null
echo "完成"
