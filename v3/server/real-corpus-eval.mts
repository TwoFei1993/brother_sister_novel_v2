// 真实网络语料 58 份全量评测：规则双路径 + AI 兜底（规则失败的文档才走 AI，上限 30 次调用）
// 用法：cd v3/server && node --import tsx real-corpus-eval.mts
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
let aiUsed = 0;
const AI_CAP = 30;

async function llm(system: string, user: string): Promise<string> {
  if (aiUsed >= AI_CAP) return '（超出评测上限，未调用）';
  aiUsed += 1;
  const res = await fetch(base + '/api/llm/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      source: 'claude',
      model: 'MiniMax-M3',
      stream: false,
      params: { max_tokens: 2500, temperature: 0.2 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  return ((await res.json()) as { text?: string }).text ?? '';
}

const dir = join(clientSrc, 'lib/__tests__/fixtures/real');
const files = readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();
const rows: string[] = [];
let ruleOk = 0;
let aiTried = 0;
let aiOkCount = 0;
let aiEmpty = 0;

for (const f of files) {
  const text = readFileSync(join(dir, f), 'utf8');
  let aN = -1, aBg = false, bN = -1, aErr = '', bErr = '';
  try {
    const a = extractFromOutline(text) as { characters?: unknown[]; background?: string };
    aN = a.characters?.length ?? 0;
    aBg = Boolean(a.background);
  } catch (e) { aErr = String(e).slice(0, 30); }
  try {
    const b = parseCharacterSheet(text) as unknown[];
    bN = Array.isArray(b) ? b.length : 0;
  } catch (e) { bErr = String(e).slice(0, 30); }

  const ruleHit = aN >= 1 || bN >= 1;
  if (ruleHit) {
    ruleOk += 1;
    rows.push(`${f.replace('.txt', '')} | ${text.length}字 | 规则✓ A:${aN}人${aBg ? '+背景' : ''}${aErr ? ' ERR' : ''} B:${bN}条${bErr ? ' ERR' : ''}`);
    continue;
  }
  // 规则失败 → AI 兜底（超长文档截断 12000 字控制消耗）
  if (aiUsed < AI_CAP) {
    aiTried += 1;
    const clipped = text.length > 12000 ? text.slice(0, 12000) : text;
    const { system, user } = buildCharacterSheetPrompt(clipped);
    const raw = await llm(system, user);
    let names: string[] = [];
    let parsedOk = false;
    try {
      const s = raw.indexOf('{');
      const e = raw.lastIndexOf('}');
      const j = JSON.parse(raw.slice(s, e + 1)) as { characters?: { name?: string }[] };
      names = (j.characters ?? []).map((c) => c.name ?? '?').filter(Boolean);
      parsedOk = true;
      if (names.length > 0) aiOkCount += 1;
      else aiEmpty += 1;
    } catch { /* JSON 坏 */ }
    const verdict = !parsedOk ? 'AI:JSON坏 ✗' : names.length === 0 ? 'AI:正确判空（文档无角色）' : `AI:${names.length}人(${names.slice(0, 3).join('/')}) ✓`;
    rows.push(`${f.replace('.txt', '')} | ${text.length}字 | 规则✗ | ${verdict}`);
  } else {
    rows.push(`${f.replace('.txt', '')} | ${text.length}字 | 规则✗ | AI:超出上限未调用`);
  }
}
console.log(rows.join('\n'));
console.log(`\n总计 ${files.length} 份 | 规则命中 ${ruleOk} | AI 兜底尝试 ${aiTried}（成功 ${aiOkCount} / 正确判空 ${aiEmpty} / 失败 ${aiTried - aiOkCount - aiEmpty}）`);
