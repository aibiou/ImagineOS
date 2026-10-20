#!/bin/bash
# UI 全链验证：获取模型列表 → 下拉选择 → 保存 → 测试验证（真实验证）→ 清理
# 单次调用内完成（mock 进程无法跨工具调用存活）
set -u
cd /home/z/my-project

# 1) 起 mock
node scripts/mock-provider-server.mjs > /tmp/mock-provider.log 2>&1 &
MOCK_PID=$!
sleep 1
curl -s -m 3 http://127.0.0.1:9998/v1/models -H "Authorization: Bearer sk-good-key-123456" -o /dev/null -w "mock:%{http_code}\n"

# 2) 打开页面（刷新清掉旧表单状态）
agent-browser open "https://preview-chat-b15437ca-c5ff-4f2b-b971-7ae3748bcf4b.space-z.ai/settings/models" >/dev/null
agent-browser wait --load networkidle >/dev/null
agent-browser wait 800 >/dev/null

# 3) 展开 LLM 通道添加表单（第一个「添加自定义服务」按钮）
agent-browser find role button click --name "添加自定义服务" >/dev/null 2>&1
agent-browser wait 600 >/dev/null

# 4) 填表单
agent-browser find label "显示名" fill "UI验证-mock" >/dev/null 2>&1
agent-browser find label "接口地址（Endpoint）" fill "http://127.0.0.1:9998/v1" >/dev/null 2>&1
agent-browser find label "密钥（API Key）" fill "sk-good-key-123456" >/dev/null 2>&1
agent-browser wait 300 >/dev/null

# 5) 点击「获取模型列表」
agent-browser find role button click --name "获取模型列表" >/dev/null 2>&1
agent-browser wait 1500 >/dev/null

# 6) 断言：下拉出现 + 推荐分组正确 + 提示消息
echo "--- [断言1] 模型列表下拉与分组 ---"
agent-browser eval "(() => {
  const s = document.querySelector('select[aria-label=\"从可用模型列表中选择\"]');
  if (!s) return 'FAIL: select 未出现';
  const groups = Array.from(s.querySelectorAll('optgroup')).map(g => g.label);
  const rec = Array.from(s.querySelectorAll('optgroup')[0]?.options || []).map(o => o.value);
  return JSON.stringify({ groups, recommended: rec });
})()"

echo "--- [断言2] 获取提示消息 ---"
agent-browser eval "(() => { const el = Array.from(document.querySelectorAll('p')).find(p => p.textContent.includes('获取到')); return el ? el.textContent : 'FAIL: 未找到提示' })()"

# 7) 下拉选择 mock-llm-1
agent-browser eval "(() => {
  const s = document.querySelector('select[aria-label=\"从可用模型列表中选择\"]');
  if (!s) return 'FAIL: no select';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(s, 'mock-llm-1');
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return 'selected';
})()"
agent-browser wait 300 >/dev/null

echo "--- [断言3] 模型名已填入输入框 ---"
agent-browser eval "(() => { const i = document.querySelector('input[id^=\"model-add-\"]'); return i ? i.value : 'FAIL' })()"

# 8) 保存
agent-browser find role button click --name "保存并加入候选链" >/dev/null 2>&1
agent-browser wait 1500 >/dev/null

# 9) 找到测试配置卡片的「测试验证」按钮（按显示名定位最后保存的卡）并点击
echo "--- [断言4] 卡片已生成 ---"
agent-browser eval "(() => { const cards = Array.from(document.querySelectorAll('.space-y-3.rounded-xl.border')); const hit = cards.find(c => c.textContent.includes('UI验证-mock')); return hit ? 'OK: 卡片存在' : 'FAIL: 卡片未找到' })()"

agent-browser eval "(() => {
  const cards = Array.from(document.querySelectorAll('.space-y-3.rounded-xl.border'));
  const card = cards.find(c => c.textContent.includes('UI验证-mock'));
  if (!card) return 'FAIL: 卡片未找到';
  const btn = Array.from(card.querySelectorAll('button')).find(b => b.textContent.includes('测试验证'));
  if (!btn) return 'FAIL: no test button';
  btn.click();
  return 'clicked';
})()"
agent-browser wait 3000 >/dev/null

echo "--- [断言5] 测试验证结果（真实调用，查卡片内消息） ---"
agent-browser eval "(() => {
  const cards = Array.from(document.querySelectorAll('.space-y-3.rounded-xl.border'));
  const card = cards.find(c => c.textContent.includes('UI验证-mock'));
  if (!card) return 'FAIL: 卡片不存在';
  const msg = card.textContent;
  const ok = msg.includes('验证通过') && msg.includes('真实对话成功');
  return ok ? msg.slice(msg.indexOf('连接成功'), msg.indexOf('连接成功') + 160) : 'FAIL: ' + msg.slice(0, 200);
})()"

# 10) 清理：删除测试配置（DB 直删最稳）
ID=$(curl -s http://localhost:3000/api/settings/model-providers | python3 -c "import json,sys; items=[i for i in json.load(sys.stdin)['items'] if i['label']=='UI验证-mock']; print(items[0]['id'] if items else '')")
if [ -n "$ID" ]; then
  curl -s -X DELETE "http://localhost:3000/api/settings/model-providers/$ID" -o /dev/null -w "cleanup-delete:%{http_code}\n"
fi

# 11) 确认用户原有配置未受影响
echo "--- [确认] 用户配置完好 ---"
curl -s http://localhost:3000/api/settings/model-providers | python3 -c "
import json,sys
items = json.load(sys.stdin)['items']
for i in items: print(f\"  {i['channel']:6} {i['label']:16} {i['modelName']}\")"

kill $MOCK_PID 2>/dev/null
agent-browser console 2>&1 | grep -iE "error" | grep -v "Fast Refresh" | head -3
echo "done"
