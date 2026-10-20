// 乱格式 fixtures 全量评测：规则双路径 + AI 兜底（规则失败/条目不足时）
// 用法：cd v3/server && node --import tsx ../scripts/chaos-eval.mts
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const clientSrc = join(dirname(fileURLToPath(import.meta.url)), '../client/src');
const mod = async (rel: string) => (await import(pathToFileURL(join(clientSrc, rel)).href)) as Record<string, any>;
const { extractFromOutline } = (await mod('lib/outline-wizard.ts')) as any;
const { parseCharacterSheet } = (await mod('lib/outline-sheet.ts')) as any;
const { buildCharacterSheetPrompt } = (await mod('lib/llm-extract.ts')) as any;

const base = 'http://localhost:3001';
const login = await fetch(base + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'dev123' }),
});
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

async function llm(system: string, user: string): Promise<string> {
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
  const out = (await res.json()) as { text?: string };
  return out.text ?? '';
}

const dir = join(clientSrc, 'lib/__tests__/fixtures/chaos');
const rows: string[] = [];
let aiCalls = 0;
let aiOk = 0;

for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt')).sort()) {
  const text = readFileSync(join(dir, f), 'utf8');
  // 规则路径
  let aN = -1, bN = -1;
  try {
    const a = extractFromOutline(text) as { characters?: unknown[] };
    aN = a.characters?.length ?? 0;
  } catch { aN = -1; }
  try {
    const b = parseCharacterSheet(text) as unknown[];
    bN = Array.isArray(b) ? b.length : 0;
  } catch { bN = -1; }

  const ruleOk = aN >= 1 || bN >= 1;
  let aiPart = '—（规则已出结果，不耗token）';
  if (!ruleOk) {
    // AI 兜底：真实调用
    const { system, user } = buildCharacterSheetPrompt(text);
    const raw = await llm(system, user);
    aiCalls += 1;
    let names: string[] = [];
    try {
      const s = raw.indexOf('{');
      const e = raw.lastIndexOf('}');
      const j = JSON.parse(raw.slice(s, e + 1)) as { characters?: { name?: string }[] };
      names = (j.characters ?? []).map((c) => c.name ?? '?');
      if (names.length > 0) aiOk += 1;
    } catch { /* JSON 解析失败 */ }
    aiPart = `AI兜底:${names.length ? names.slice(0, 3).join('/') + (names.length > 3 ? '…' : '') : '解析失败'}${names.length ? ' ✓' : ' ✗'}`;
  }
  rows.push(
    `${f.replace('.txt', '')} | 规则A:${aN === -1 ? 'ERR' : aN + '人'} 规则B:${bN === -1 ? 'ERR' : bN + '条'} | ${aiPart}`,
  );
}
console.log(rows.join('\n'));
console.log(`\n共 ${rows.length} 个 fixture；规则失败触发 AI 兜底 ${aiCalls} 次，AI 成功 ${aiOk} 次`);
