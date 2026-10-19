/**
 * 批量人设展板解析（编号文档智能抽取）：识别「01. 名字｜身份」条目、
 * 「第N部分:xxx」分部标题与【全局统一】负面/版式段；跨条目统计剥离出现率
 * ≥60% 的重复头部版式行与重复尾部画质句，只留每个角色独有的描述。
 * 非编号文档返回空 entries，向导回退旧 extractFromOutline 路径。
 */
import type { TavernCardV2, TavernWorldInfoEntry, TavernWorldInfoFile } from '@shared/tavern';

import { constantEntry } from './outline-wizard';

// ---------- 类型 ----------

export interface CharacterSheetEntry {
  name: string;
  /** 身份段（可含括号补充，如「镇北侯府嫡长女（女主，重生者）」） */
  identity: string;
  /** 所属分部标题（第N部分冒号后的文本） */
  group: string;
  /** 模板去重后的独有描述 */
  description: string;
  /** 描述中「N岁」提取的年龄 */
  age?: number;
}

export interface SheetMeta {
  /** 【全局统一】负面提示词（备查，不入角色卡） */
  negative: string;
  /** 【全局统一】固定版式模板（备查，不入角色卡） */
  template: string;
}

export interface SheetDocument {
  entries: CharacterSheetEntry[];
  meta: SheetMeta;
}

// ---------- 行级正则 ----------

const GLOBAL_LINE = /^【[^】]*全局[^】]*】\s*(.*)$/;
const SECTION_LINE = /^第\s*[0-9一二三四五六七八九十百零两]+\s*部分\s*[:：、.．]?\s*(.*)$/;
/**
 * 条目头要求名字与身份以｜分隔，避免普通编号列表（"1. 天玄宗…"）误判；
 * 编号兼容中文数字（B3 回归：「一、墨千秋｜听雨楼楼主」）。
 */
const ENTRY_LINE = /^(?:\d{1,3}|[一二三四五六七八九十]{1,3})[.、．]\s*([^｜|\n]{1,20})[｜|]\s*(.+)$/;
const AGE_RE = /(\d{1,3})\s*岁/;
const POSITIVE_PROMPT_RE = /^(?:正向|正面|positive)\s*prompt\s*[:：]?\s*(.*)$/i;
const NEGATIVE_PROMPT_RE = /^(?:负向|反向|negative)\s*prompt\s*[:：]/i;
/** 空值占位（深度测试 D9：「反向 prompt：无」这类条目原样拼入卡片描述）——视为无内容 */
const EMPTY_PLACEHOLDER_RE = /^(?:无|暂无|没有|none|n\/a)?$/i;

/** 描述是否为空值条目：整体为空，或去标点后仅剩「无/暂无」类占位 */
function isEmptyDescription(description: string): boolean {
  return EMPTY_PLACEHOLDER_RE.test(description.replace(/[\s\p{P}\p{S}]+/gu, ''));
}

/** 重复块判定阈值：某行在 ≥60% 条目中原样出现才视为模板 */
const DUP_RATIO = 0.6;

// ---------- 模板去重 ----------

/** 候选中出现率最高的非空行（达 DUP_RATIO 才返回） */
function majorityLine(candidates: string[], total: number): string | null {
  const count = new Map<string, number>();
  for (const c of candidates) count.set(c, (count.get(c) ?? 0) + 1);
  let best = '';
  let votes = 0;
  for (const [line, n] of count) {
    if (n > votes) {
      best = line;
      votes = n;
    }
  }
  return best.length > 0 && votes >= Math.ceil(total * DUP_RATIO) ? best : null;
}

/** 头部（公共前缀行）或尾部（公共后缀行）多数投票剥离，原地修改 */
function stripEdgeRows(rows: string[][], edge: 'head' | 'tail'): void {
  const take = (r: string[]): string | undefined => (edge === 'head' ? r[0] : r[r.length - 1]);
  const drop = (r: string[]): void => {
    if (edge === 'head') r.shift();
    else r.pop();
  };
  for (let guard = 0; guard < 64; guard += 1) {
    const candidates = rows.map(take).filter((l): l is string => l !== undefined);
    if (candidates.length === 0) return;
    const top = majorityLine(candidates, rows.length);
    if (top === null) return;
    let moved = 0;
    for (const r of rows) {
      if (take(r) === top) {
        drop(r);
        moved += 1;
      }
    }
    if (moved === 0) return;
  }
}

/** 按句末标点或换行切句（句内 trim，保留标点），供尾句级去重 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。；;！!\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 尾部画质词常与独有描述同行：按句从尾向前多数投票剥离 */
function stripTailSentences(bodies: string[]): string[] {
  const parts = bodies.map(splitSentences);
  for (let guard = 0; guard < 32; guard += 1) {
    const candidates = parts.map((p) => p[p.length - 1]).filter((s): s is string => s !== undefined);
    if (candidates.length === 0) break;
    const top = majorityLine(candidates, parts.length);
    if (top === null) break;
    let moved = 0;
    for (const p of parts) {
      if (p[p.length - 1] === top) {
        p.pop();
        moved += 1;
      }
    }
    if (moved === 0) break;
  }
  return parts.map((p) => p.join(''));
}

/**
 * 三步去重：公共前缀行 → 公共尾句（覆盖与描述同行的画质词）→ 公共后缀行。
 * 少于 2 条不参与跨条目统计（单条无重复可言）。
 */
function dedupeBodies(bodies: string[][]): string[][] {
  if (bodies.length < 2) return bodies;
  stripEdgeRows(bodies, 'head');
  const joined = stripTailSentences(bodies.map((b) => b.join('\n')));
  const rows = joined.map((s) => s.split('\n').filter((l) => l.trim().length > 0));
  stripEdgeRows(rows, 'tail');
  return rows;
}

// ---------- 条目正文清洗 ----------

interface RawEntry {
  name: string;
  identity: string;
  group: string;
  body: string[];
}

/** 去掉「正向 prompt:」结构行（同行内容保留），负向/反向段之后整体舍弃；「：无」占位不进正文 */
function cleanBodyLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const pos = line.match(POSITIVE_PROMPT_RE);
    if (pos) {
      if (pos[1]?.trim() && !isEmptyDescription(pos[1].trim())) out.push(pos[1].trim());
      continue;
    }
    if (NEGATIVE_PROMPT_RE.test(line)) break;
    if (line.length > 0) out.push(line);
  }
  return out;
}

// ---------- 主解析 ----------

export function parseSheetDocument(text: string): SheetDocument {
  const meta: SheetMeta = { negative: '', template: '' };
  const raws: RawEntry[] = [];
  const globalBuf: string[] = [];
  let group = '';
  let cur: RawEntry | null = null;

  /** 全局块按首行关键词归类（负面/版式），无法归类则忽略 */
  const flushGlobal = (): void => {
    const body = globalBuf.join('\n').trim();
    if (body) {
      const head = body.split('\n', 1)[0] ?? '';
      if (/负面/.test(head)) meta.negative = meta.negative ? `${meta.negative}\n${body}` : body;
      else if (/版式|模板|展板/.test(head)) meta.template = meta.template ? `${meta.template}\n${body}` : body;
    }
    globalBuf.length = 0;
  };
  const flushEntry = (): void => {
    if (cur) raws.push(cur);
    cur = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const globalM = line.match(GLOBAL_LINE);
    if (globalM) {
      flushEntry();
      flushGlobal();
      globalBuf.push(globalM[1] ?? '');
      continue;
    }
    const sectionM = line.match(SECTION_LINE);
    if (sectionM) {
      flushEntry();
      flushGlobal();
      group = (sectionM[1] ?? '').trim() || line.slice(0, 20);
      continue;
    }
    const entryM = line.match(ENTRY_LINE);
    if (entryM) {
      flushEntry();
      flushGlobal();
      const name = (entryM[1] ?? '').trim();
      if (!name) continue; // 名字缺失跳过
      cur = { name, identity: (entryM[2] ?? '').trim(), group, body: [] };
      continue;
    }
    if (!line) continue;
    if (cur) cur.body.push(line);
    else globalBuf.push(line);
  }
  flushEntry();
  flushGlobal();

  const cleaned = raws.map((r) => cleanBodyLines(r.body));
  const deduped = dedupeBodies(cleaned);
  const entries = raws
    .map((r, i): CharacterSheetEntry => {
      const description = (deduped[i] ?? []).join('\n').trim();
      const ageM = description.match(AGE_RE);
      return {
        name: r.name,
        identity: r.identity,
        group: r.group,
        description,
        ...(ageM ? { age: Number(ageM[1]) } : {}),
      };
    })
    // 空值条目跳过（D9）：description 为空或字面「无」——不进批量导入与卡片描述拼装
    .filter((e) => !isEmptyDescription(e.description));
  return { entries, meta };
}

/** 兼容入口：仅返回条目数组（向导以 ≥3 条判定进入批量导入模式） */
export function parseCharacterSheet(text: string): CharacterSheetEntry[] {
  return parseSheetDocument(text).entries;
}

// ---------- 草稿构建 ----------

/** 展板条目 → 酒馆 V2 角色卡草稿（description 仅独有内容；模板/负面入世界书备查） */
export function buildSheetCardDraft(entry: CharacterSheetEntry): TavernCardV2 {
  const lines: string[] = [];
  if (entry.identity) lines.push(`{{char}}的身份是${entry.identity}。`);
  if (entry.age !== undefined) lines.push(`{{char}}的年龄是${entry.age}岁。`);
  if (entry.description) lines.push(entry.description);
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: entry.name,
      description: lines.join('\n'),
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '由大纲向导批量导入（人设展板）',
      creator: '',
      character_version: '',
      tags: ['outline-sheet'],
      alternate_greetings: [],
      system_prompt: '',
      post_history_instructions: '',
    },
  };
}

/** 分部标题 + 全局负面/版式 → 世界书草稿（全部 constant 条目备查） */
export function buildSheetWorldbookDraft(doc: SheetDocument): { name: string; raw: TavernWorldInfoFile } {
  const entries: TavernWorldInfoEntry[] = [];
  let uid = 0;
  const groups = new Map<string, string[]>();
  for (const e of doc.entries) {
    const list = groups.get(e.group) ?? [];
    list.push(e.name);
    groups.set(e.group, list);
  }
  for (const [grp, names] of groups) {
    const label = grp || '未分组';
    entries.push(constantEntry(uid++, label, `${label}：包含角色 ${names.join('、')}`, [label.slice(0, 6)]));
  }
  if (doc.meta.negative) {
    entries.push(constantEntry(uid++, '通用负面提示词（备查）', doc.meta.negative, ['负面']));
  }
  if (doc.meta.template) {
    entries.push(constantEntry(uid++, '统一版式模板（备查）', doc.meta.template, ['版式', '展板']));
  }
  return {
    name: '人设展板世界书',
    raw: { entries: Object.fromEntries(entries.map((e) => [String(e.uid), e])) },
  };
}
