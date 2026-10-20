/**
 * 智能抽取 LLM 兜底（规则优先 + LLM 兜底）：outline-wizard / outline-sheet 的
 * 正则抽取效果不佳时，调 LLM 做「结构化信息抽取」（system 明确不创作不改写），
 * 解析严格 JSON 并健壮容错（剥 ```json 围栏 / 前后杂文 / 截取首个 { 到最后一个 }）。
 * 仅做解析与映射，不触碰解析器本身；解析失败返回 null 并保留 raw 供界面排查。
 */
import type { LlmPrefs } from '../stores/settings';

import { apiFetch } from '../api/client';
import type { CharacterSheetEntry } from './outline-sheet';
import type { ExtractedCharacter, ExtractedOutline } from './outline-wizard';

// ---------- 提示词 ----------

/** 原文在 user 提示词中的定界符（隔离文档，防提示注入式混淆） */
const DOC_DELIM = '<<<文档>>>';

/** 展板抽取：LLM 结构化人设条目（保留独有描述，剥离重复模板） */
export function buildCharacterSheetPrompt(text: string): { system: string; user: string } {
  const system =
    '你是严谨的中文文档结构化助手。你只做信息抽取：从原文中提取既有内容整理为字段，' +
    '不创作、不改写、不扩写、不补全原文没有的信息。只输出一个 JSON 对象，不要任何解释。';
  const user = [
    '请从下面的「人设展板」文档中抽取每个角色的条目信息，输出严格 JSON。',
    '',
    '要求：',
    '- 只抽取原文实际存在的信息，不创作、不改写描述原文',
    '- name 取角色名；identity 取身份描述；group 取该条目所属分部标题（文档未分部则为空字符串）',
    '- description 保留该角色独有的描述原文；若原文存在多个角色重复出现的模板句（统一画质、统一版式、固定开头结尾等），不要写入 description',
    '- age 取描述中出现的年龄数字（如「18岁」记为 18）；未提及则省略该字段',
    '- 只输出 JSON：{"characters":[{"name":"…","identity":"…","group":"…","description":"…","age":16}]}',
    '',
    '待抽取文档：',
    DOC_DELIM,
    text,
    DOC_DELIM,
  ].join('\n');
  return { system, user };
}

/** 普通大纲抽取：人物 / 背景 / 势力 / 矛盾 */
export function buildOutlinePrompt(text: string): { system: string; user: string } {
  const system =
    '你是严谨的中文文档结构化助手。你只做信息抽取：从原文中提取既有内容整理为字段，' +
    '不创作、不改写、不扩写、不补全原文没有的信息。只输出一个 JSON 对象，不要任何解释。';
  const user = [
    '请从下面的网文大纲中抽取设定要素，输出严格 JSON。',
    '',
    '要求：',
    '- 只抽取原文实际存在的信息，不创作、不改写',
    '- characters[].name 取人名；role 取身份（如 哥哥/妹妹/男主）；personality 取性格与能力描述原文',
    '- background 取故事/世界背景原文；factions 取势力相关描述原文；conflict 取核心矛盾/冲突描述原文',
    '- 原文未提及的字段输出空字符串，characters 未提及则为空数组',
    '- 只输出 JSON：{"characters":[{"name":"…","role":"…","personality":"…"}],"background":"…","factions":"…","conflict":"…"}',
    '',
    '待抽取大纲：',
    DOC_DELIM,
    text,
    DOC_DELIM,
  ].join('\n');
  return { system, user };
}

// ---------- 健壮 JSON 解析 ----------

/**
 * 容错解析 LLM 返回中的 JSON 对象：剥完整代码围栏 → 截取首个 { 到最后一个 }
 * （容忍前后杂文）→ JSON.parse；任何一步失败返回 null（raw 由调用方保留展示）。
 */
export function parseJsonLoose<T = unknown>(raw: string): T | null {
  let t = raw.trim();
  if (!t) return null;
  const fenced = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(t);
  if (fenced?.[1]) t = fenced[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** LLM 非流式抽取：POST /api/llm/generate（与 chat 长度档无关，固定低温度） */
export interface LlmExtractResult<T> {
  parsed: T | null;
  raw: string;
}

/** 调 LLM 做结构化抽取：空文档直接拒绝（不发请求）；解析失败 parsed=null 并保留 raw */
export async function llmExtract<T = unknown>(
  text: string,
  prompt: { system: string; user: string },
  prefs: LlmPrefs,
): Promise<LlmExtractResult<T>> {
  const trimmed = text.trim();
  if (!trimmed) return { parsed: null, raw: '' };
  const out = (await apiFetch<{ text?: string }>('/api/llm/generate', {
    method: 'POST',
    body: JSON.stringify({
      source: prefs.source,
      model: prefs.model || undefined,
      stream: false,
      params: { max_tokens: 4000, temperature: 0.2 },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  }));
  const raw = out.text ?? '';
  return { parsed: parseJsonLoose<T>(raw), raw };
}

// ---------- 兜底启发式 ----------

/**
 * 是否应兜底到 LLM：
 * 1) 规则抽取 0 条目 && 文本 >500 字（散文式文档，正则无从下手）；
 * 2) 展板路径：条目数 <3 && 文本含 ≥3 个「序号+分隔符+｜」疑似条目头（展板变体格式）。
 * 规则成功（≥3 条）或文本过短时不兜底（规则优先原则）。
 */
export function shouldFallbackToLLM(
  ruleCount: number,
  textLength: number,
  suspectHeads = 0,
  /** 普通大纲路径的背景抽取是否成功（真实文档实测：有人物无背景=规则结果贫瘠，也应兜底） */
  backgroundOk = true,
): boolean {
  if (ruleCount === 0 && textLength > 500) return true;
  if (textLength > 500 && !backgroundOk) return true; // 有人物但背景缺失：规则结果贫瘠
  return ruleCount < 3 && suspectHeads >= 3;
}

/** 疑似展板条目头统计：行首序号 + 分隔符，且行内含「｜」（比 ENTRY_LINE 宽松的变体探测） */
export function countSuspectEntryHeads(text: string): number {
  let count = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^(?:\d{1,3}|[一二三四五六七八九十]{1,3})\s*[.、．)）]\s*(.+)$/.exec(line);
    if (m && (m[1]?.length ?? 0) <= 40 && /[｜|]/.test(m[1] ?? '')) count += 1;
  }
  return count;
}

// ---------- LLM 结果 → 既有结构映射 ----------

/** unknown 字段安全取字符串（trim；非字符串为空串） */
function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** personality / 描述文本 → 特质短语（2-24 字，最多 6 条；无法切分时整句截断兜底） */
function splitPhrases(text: string): string[] {
  const parts = text
    .split(/[，,、；;。！？\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 24);
  if (parts.length > 0) return parts.slice(0, 6);
  return text.trim() ? [text.trim().slice(0, 24)] : [];
}

/** LLM 展板 JSON → CharacterSheetEntry[]（缺字段兜底空串，无名条目跳过） */
export function sheetEntriesFromLlm(parsed: unknown): CharacterSheetEntry[] {
  if (typeof parsed !== 'object' || parsed === null) return [];
  const chars = (parsed as { characters?: unknown }).characters;
  if (!Array.isArray(chars)) return [];
  const out: CharacterSheetEntry[] = [];
  for (const item of chars) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const name = asString(rec['name']);
    if (!name) continue;
    const age = rec['age'];
    out.push({
      name,
      identity: asString(rec['identity']),
      group: asString(rec['group']),
      description: asString(rec['description']),
      ...(typeof age === 'number' && Number.isFinite(age) ? { age } : {}),
    });
  }
  return out;
}

/** LLM 大纲 JSON → ExtractedOutline（personality 切特质；factions 整体一条；全空返回 null） */
export function outlineFromLlm(parsed: unknown): ExtractedOutline | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;
  const charsRaw = rec['characters'];
  const characters: ExtractedCharacter[] = [];
  if (Array.isArray(charsRaw)) {
    for (const item of charsRaw) {
      if (typeof item !== 'object' || item === null) continue;
      const c = item as Record<string, unknown>;
      const name = asString(c['name']);
      if (!name) continue;
      characters.push({ name, role: asString(c['role']) || name, traits: splitPhrases(asString(c['personality'])) });
    }
  }
  const background = asString(rec['background']);
  const factionsText = asString(rec['factions']);
  const conflict = asString(rec['conflict']);
  if (characters.length === 0 && !background && !factionsText && !conflict) return null;
  return {
    characters: characters.slice(0, 12),
    background,
    abilities: [],
    factions: factionsText ? [factionsText] : [],
    conflict,
  };
}

/** token 消耗粗估（千 token）：中文约 1 字 ≈ 0.5-1 token，向上取整供 UI 提示 */
export function estimateTokenKilo(textLength: number): number {
  return Math.max(1, Math.round(textLength / 1000));
}
