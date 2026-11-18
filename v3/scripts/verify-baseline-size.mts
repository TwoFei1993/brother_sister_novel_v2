/**
 * 轮 3 失败第二假设对照：输入侧触发——大基准（12章全 plot + 分卷）vs 瘦基准（章节仅标题）
 * 注入 prompt 后调「只输出变动部分」调整，各跑 3 次（flash 弱模型，最严条件）。
 * 判据：返回非空 + JSON 完整闭合。
 */
import { PLANNER_SYSTEM } from '../client/src/features/planner/planner-llm';

const BASE = 'http://localhost:3001';
const MODEL = process.env.EVAL_MODEL ?? 'MiniMax-M3.1-Flash';

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

const IDEA = '写一本都市日常向兄妹小说，哥哥开深夜便利店，妹妹高三，温情治愈，60章。';
const ADJUST = '把第 2 章改成兄妹大吵一架，另外加一个特殊物品「母亲的银锁」。';
const SLIM_RULE =
  '调整轮只输出发生变动的部分：未变更的 chapters 条目写「{"index":N,"unchanged":true}」占位；' +
  'characters/background/factions/conflict/volumes/items 未变动时整个字段省略。';

const chaptersFull = Array.from({ length: 12 }, (_, i) => ({
  index: i + 1,
  title: `第${i + 1}章 夜班${i + 1}`,
  plot: '本章剧情要点：兄妹在便利店夜班中经历一段日常，人物关系推进一小步，情绪落点温暖，留下一个小钩子驱动下一章。约一百字的要点概述，覆盖本章事件与情感变化。',
}));
const baselineFull = JSON.stringify({
  title: '夜灯便利屋', genre: '都市日常',
  characters: [{ name: '沈川', role: '哥哥', traits: ['温和'] }, { name: '沈禾', role: '妹妹', traits: ['懂事'] }],
  background: '哥哥沈川辞职开了深夜便利店，妹妹沈禾高三，两人在夜班里互相扶持。',
  abilities: [], factions: [], conflict: '生计压力与学业陪伴的张力',
  items: [
    { name: '旧座钟', summary: '店里停摆的旧挂钟' },
    { name: '熟客本', summary: '记录深夜熟客喜好的手写本' },
  ],
  volumes: [
    { index: 1, title: '第一卷 开店初记', summary: '辞职开店、兄妹磨合、熟客登场，主线确立。', startChapter: 1 },
    { index: 2, title: '第二卷 深夜百态', summary: '熟客故事展开，兄妹各自成长，学业与店铺的冲突浮现。', startChapter: 13 },
  ],
  chapters: chaptersFull,
});
const baselineSlim = JSON.stringify({
  ...JSON.parse(baselineFull),
  chapters: chaptersFull.map((c) => ({ index: c.index, title: c.title })),
});

const history = [
  { role: 'user' as const, content: IDEA },
  { role: 'assistant' as const, content: '明白，方向很清晰：温情治愈的深夜便利店兄妹日常，60 章体量。' },
  { role: 'user' as const, content: `${ADJUST}\n\n${SLIM_RULE}` },
];

for (const [label, baseline] of [['A-大基准(全plot)', baselineFull], ['B-瘦基准(仅标题)', baselineSlim]] as const) {
  for (let i = 1; i <= 3; i++) {
    const msgs = [
      { role: 'system', content: PLANNER_SYSTEM },
      ...history,
      { role: 'user', content: `（当前策划案基准 JSON，修改时继承未提及部分）\n${baseline}` },
    ];
    try {
      const { text, finish } = await llm(msgs);
      console.log(`${label} 第${i}次: prompt≈${msgs.map((m) => m.content).join('').length}字 返回${text.length}字 finish=${finish} JSON完整=${balanced(text) ? '✅' : '❌'}`);
    } catch (e) {
      console.log(`${label} 第${i}次: 异 ${e instanceof Error ? e.message : e}`);
    }
  }
}
