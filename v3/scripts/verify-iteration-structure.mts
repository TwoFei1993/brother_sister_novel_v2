/**
 * 轮 3（迭代轮）失败根因对照实验：plannerMessages 在有策划案时把「基准 JSON」
 * 作为第二条连续 user 消息追加在末尾——假设该结构导致上游空回复/JSON 截断。
 *
 * 变体 A（现状）：[...history, user:调整, user:基准JSON]（两条连续 user）
 * 变体 B（合并）：[...history, user:调整 + '\n\n' + 基准JSON]（单条收尾）
 * 各跑 2 次，比较「非空 + JSON 完整闭合」成功率。用紧凑迷你基准控制变量。
 */
import { PLANNER_SYSTEM } from '../client/src/features/planner/planner-llm';

const BASE = 'http://localhost:3001';
const MODEL = process.env.EVAL_MODEL ?? 'claude-sonnet-4-5-20250929';

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: process.env.ACCESS_PASSWORD ?? 'dev123' }),
});
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
const H = { 'Content-Type': 'application/json', Cookie: cookie };

async function llm(messages: Array<{ role: string; content: string }>): Promise<{ text: string; finish: string }> {
  const res = await fetch(`${BASE}/api/llm/generate`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ source: 'claude', model: MODEL, stream: true, params: { max_tokens: 32000, temperature: 0.8 }, messages }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = '';
  let text = '';
  let finish = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (;;) {
      const idx = buf.indexOf('\n\n');
      if (idx === -1) break;
      const frame = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (!frame.startsWith('data:')) continue;
      const payload = frame.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const ev = JSON.parse(payload) as { text?: string; finish?: string };
        if (ev.text) text += ev.text;
        if (ev.finish) finish = ev.finish;
      } catch { /* 半帧 */ }
    }
  }
  return { text, finish };
}

/** JSON 完整性：是否存在从头到尾括号平衡的顶层候选 */
function balanced(text: string): boolean {
  const s = text.indexOf('{');
  if (s === -1) return false;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = s; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return true;
    }
  }
  return false;
}

const SYSTEM = PLANNER_SYSTEM;
const IDEA = '写一本都市日常向兄妹小说，哥哥开深夜便利店，妹妹高三，温情治愈，60章。';
const MINI_BASELINE = JSON.stringify({
  title: '夜灯便利屋',
  genre: '都市日常',
  characters: [{ name: '沈川', role: '哥哥', traits: ['温和'] }, { name: '沈禾', role: '妹妹', traits: ['懂事'] }],
  background: '哥哥辞职开了深夜便利店，妹妹高三。',
  abilities: [], factions: [], conflict: '生计压力与学业陪伴的张力',
  items: [{ name: '旧座钟', summary: '店里停摆的旧挂钟' }],
  chapters: Array.from({ length: 8 }, (_, i) => ({ index: i + 1, title: `第${i + 1}章 夜班${i + 1}`, plot: '要点概述，足够长度以贴近真实形态。' })),
});
const ADJUST = '把第 2 章改成兄妹大吵一架，另外加一个特殊物品「母亲的银锁」。';
const BASELINE_NOTE = '（当前策划案基准 JSON，修改时继承未提及部分）\n';

const history = [
  { role: 'user' as const, content: IDEA },
  { role: 'assistant' as const, content: '好的，我明白你的想法了。' },
];

for (const variant of ['A-两条连续user（现状）', 'B-基准并入末条user'] as const) {
  const msgs =
    variant.startsWith('A')
      ? [...history, { role: 'user' as const, content: ADJUST }, { role: 'user' as const, content: `${BASELINE_NOTE}${MINI_BASELINE}` }]
      : [...history, { role: 'user' as const, content: `${ADJUST}\n\n${BASELINE_NOTE}${MINI_BASELINE}` }];
  for (let i = 1; i <= 2; i++) {
    const { text, finish } = await llm(msgs as Array<{ role: string; content: string }>);
    console.log(`${variant} 第${i}次: len=${text.length} finish=${finish} JSON完整=${balanced(text) ? '✅' : '❌'} 首40字=${text.slice(0, 40).replace(/\n/g, ' ')}`);
  }
}
