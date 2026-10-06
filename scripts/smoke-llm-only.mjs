import ZAI from 'z-ai-web-dev-sdk';
async function main() {
  try {
    const zai = await ZAI.create();
    const t0 = Date.now();
    const r = await zai.chat.completions.create({ messages: [{ role: 'user', content: '回复"OK"两个字母即可' }], max_tokens: 8 });
    console.log(`[smoke] LLM OK (${Date.now() - t0}ms):`, r.choices?.[0]?.message?.content?.trim());
  } catch (e) { console.log('[smoke] LLM FAIL:', String(e).slice(0, 120)); }
}
main();
