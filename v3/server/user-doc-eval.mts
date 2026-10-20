// 真实用户文档实测：【原创短剧】穿成嫡出大小姐的日常.docx
// 用法：cd v3/server && node --import tsx user-doc-eval.mts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const clientSrc = join(dirname(fileURLToPath(import.meta.url)), '../client/src');
const mod = async (rel: string) =>
  (await import(pathToFileURL(join(clientSrc, rel)).href)) as Record<string, any>;
const { extractFromOutline } = (await mod('lib/outline-wizard.ts')) as any;
const { parseCharacterSheet } = (await mod('lib/outline-sheet.ts')) as any;
const {
  buildCharacterSheetPrompt,
  buildOutlinePrompt,
} = (await mod('lib/llm-extract.ts')) as any;

const text = readFileSync('D:/ClaudeCache/Temp/docx-test/extracted.txt', 'utf8');
console.log(`文档字数: ${text.length} | 行数: ${text.split('\n').length}`);

// ---------- 规则路径 ----------
let aChars = 0, aBg = false, bN = 0;
try {
  const a = extractFromOutline(text) as { characters?: unknown[]; background?: string };
  aChars = a.characters?.length ?? 0;
  aBg = Boolean(a.background);
} catch (e) {
  console.log('A 路径异常:', String(e).slice(0, 60));
}
try {
  const b = parseCharacterSheet(text) as unknown[];
  bN = Array.isArray(b) ? b.length : 0;
} catch { bN = 0; }
console.log(`规则A: 人物${aChars} 背景${aBg ? '✓' : '✗'} | 规则B(展板): ${bN} 条`);
console.log(`shouldFallbackToLLM 预期: ${aChars === 0 && text.length > 500 ? '触发 AI 兜底 ✓' : '不触发'}`);

// ---------- AI 兜底（真实 MiniMax，走 dev 栈） ----------
const base = 'http://localhost:3001';
const login = await fetch(base + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'dev123' }),
});
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
const llm = async (system: string, user: string): Promise<string> => {
  const res = await fetch(base + '/api/llm/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      source: 'claude',
      model: 'MiniMax-M3',
      stream: false,
      params: { max_tokens: 4000, temperature: 0.2 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  return ((await res.json()) as { text?: string }).text ?? '';
};

// 路径1：人设展板 prompt（抽角色）
const sheet = buildCharacterSheetPrompt(text);
const sheetRaw = await llm(sheet.system, sheet.user);
try {
  const s = sheetRaw.indexOf('{');
  const e = sheetRaw.lastIndexOf('}');
  const j = JSON.parse(sheetRaw.slice(s, e + 1)) as { characters?: { name?: string; identity?: string; description?: string }[] };
  const list = j.characters ?? [];
  console.log(`\n【AI 展板抽取】角色数: ${list.length}`);
  list.slice(0, 5).forEach((c) =>
    console.log(`  - ${c.name}｜${c.identity ?? ''}｜描述${(c.description ?? '').length}字`),
  );
} catch (e) {
  console.log('\n【AI 展板抽取】JSON 解析失败，原始返回前 300 字:\n', sheetRaw.slice(0, 300));
}

// 路径2：普通大纲 prompt（抽背景/势力/矛盾/人物）
const outline = buildOutlinePrompt(text);
const outlineRaw = await llm(outline.system, outline.user);
try {
  const s = outlineRaw.indexOf('{');
  const e = outlineRaw.lastIndexOf('}');
  const j = JSON.parse(outlineRaw.slice(s, e + 1)) as {
    characters?: { name?: string }[];
    background?: string;
    factions?: string;
    conflict?: string;
  };
  console.log(`\n【AI 大纲抽取】人物: ${(j.characters ?? []).map((c) => c.name).join('/') || '无'}`);
  console.log('背景:', (j.background ?? '').slice(0, 100));
  console.log('矛盾:', (j.conflict ?? '').slice(0, 80));
  console.log('势力:', (j.factions ?? '').slice(0, 80));
} catch (e) {
  console.log('\n【AI 大纲抽取】JSON 解析失败，原始返回前 300 字:\n', outlineRaw.slice(0, 300));
}
