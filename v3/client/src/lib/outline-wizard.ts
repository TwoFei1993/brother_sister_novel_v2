/**
 * 大纲向导（Task 32）：粘贴网文大纲 → 正则抽取人物/背景/能力/势力/矛盾 →
 * 一键生成角色卡（V2）与世界书草稿。抽取算法移植旧站
 * SettingsPanel.autoFillFromOutline（重写为强类型），并修正其两处已知缺陷：
 * 1) 小节序号后无空格（"二、主要人物"）时旧站切界失败；
 * 2) 人物行（"哥哥：…"）不是小节边界，导致背景/矛盾抽取吞并后续段落。
 */
import type { TavernCardV2, TavernWorldInfoEntry, TavernWorldInfoFile } from '@shared/tavern';

// ---------- 类型 ----------

export interface ExtractedCharacter {
  name: string;
  /** 身份（哥哥/妹妹/男主等；无名时与 name 同值兜底） */
  role: string;
  traits: string[];
}

export interface ExtractedOutline {
  characters: ExtractedCharacter[];
  background: string;
  /** 哥哥/妹妹等金手指描述 */
  abilities: string[];
  factions: string[];
  conflict: string;
}

// ---------- 正则基建（对照旧站） ----------

/** 预处理：为行内序号/破折号条目补换行，使行级扫描与切界生效 */
function normalizeOutline(text: string): string {
  return text
    .replace(/(?<=[^\n\s])(\s*(?:\d+[.、)）]|[（(]\s*[一二三四五六七八九十\d]+\s*[）)]|[一二三四五六七八九十]+[.、：:])\s)/g, '\n$1')
    .replace(/(?<=[^\n\s])(\s*[-—–─━]\s+(?:[一-鿿]))/g, '\n$1');
}

/**
 * 小节边界：空行 / 标记符号 / 序号 / 人物行开头，或文本结尾。
 * 在旧站基础上：序号后空白改为可省（"二、主要人物"），新增人物行边界。
 */
const SECTION_END = String.raw`(?:\n\n|\n(?=\s*[#＃●★☆►▶◆■□▪▸·•※]|\s*\d+[.、)）]|\s*[-—–─━]\s|\s*[（(]\s*[一二三四五六七八九十\d]+\s*[）)]|\s*[一二三四五六七八九十]+[.、：:]|\s*(?:主要人物|人物设定|人物简介|角色设定|哥哥|妹妹|兄长|男主|女主))|$)`;

/** 关键字后取一段文本，直到下个小节边界（过短视为未命中） */
function extract(patterns: RegExp[], src: string): string {
  for (const pat of patterns) {
    const m = src.match(new RegExp(pat.source, 'i'));
    if (m?.[1] && m[1].trim().length >= 3) return m[1].trim();
  }
  return '';
}

/** 同模式全局收集（如多条"世界主线"聚合为背景） */
function extractAll(pattern: RegExp, src: string): string[] {
  const results: string[] = [];
  const re = new RegExp(pattern.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[1] && m[1].trim().length >= 3) results.push(m[1].trim());
  }
  return results;
}

// ---------- 人物抽取 ----------

/** 结构词黑名单：命中即视为标题/设定行而非人名 */
const NAME_BLACKLIST = /第|章|节|卷|幕|背景|设定|势力|主线|矛盾|体系|结局|简介|大纲|能力|金手指|备注|说明|世界观/;

/** 身份词（长词在前避免"哥哥"被"哥"截断） */
const ROLES = '哥哥|兄长|男主|妹妹|女主|姐姐|弟弟|兄|哥|妹';

/** 身份行（可带括号名）：哥哥（林昭）：… / 哥哥：… */
const ROLE_LINE = new RegExp(String.raw`^(${ROLES})\s*(?:[（(]\s*([^\s（）()：:，,。]{2,6})\s*[）)])?\s*[：:]\s*(.*)$`);
/** 名字+括号身份行：林昭（哥哥）：… */
const NAME_ROLE_LINE = new RegExp(String.raw`^([^\s（）()：:，,。]{2,6})\s*[（(]\s*(${ROLES})\s*[）)]\s*[：:]?\s*(.*)$`);
/** 普通名字描述行：林昭：天赋异禀… */
const PLAIN_NAME_LINE = /^([^\s（）()：:，,。]{2,4})\s*[：:]\s*(.{4,})$/;

/** 描述切分为特质短语（2-20 字，最多 6 条） */
function splitTraits(desc: string): string[] {
  return desc
    .split(/[，,；;。！？、\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 20)
    .slice(0, 6);
}

function scanCharacters(normalized: string): ExtractedCharacter[] {
  const byName = new Map<string, ExtractedCharacter>();
  const push = (name: string, role: string, desc: string) => {
    const traits = splitTraits(desc);
    if (traits.length === 0) return;
    const existing = byName.get(name);
    if (existing) {
      existing.traits = [...new Set([...existing.traits, ...traits])].slice(0, 6);
      return;
    }
    byName.set(name, { name, role, traits });
  };

  for (const line of normalized.split('\n')) {
    const text = line.trim();
    if (!text) continue;

    const roleM = text.match(ROLE_LINE);
    if (roleM) {
      // 无括号名 → 身份词兜底命名
      push(roleM[2] ?? roleM[1], roleM[1], roleM[3] ?? '');
      continue;
    }
    const nameRoleM = text.match(NAME_ROLE_LINE);
    if (nameRoleM && !NAME_BLACKLIST.test(nameRoleM[1])) {
      push(nameRoleM[1], nameRoleM[2], nameRoleM[3] ?? '');
      continue;
    }
    const plainM = text.match(PLAIN_NAME_LINE);
    if (plainM && !NAME_BLACKLIST.test(plainM[1])) {
      push(plainM[1], plainM[1], plainM[2]);
    }
  }
  return [...byName.values()].slice(0, 6);
}

// ---------- 主抽取 ----------

export function extractFromOutline(text: string): ExtractedOutline {
  if (!text.trim()) {
    return { characters: [], background: '', abilities: [], factions: [], conflict: '' };
  }
  const normalized = normalizeOutline(text);

  // 背景：具名"背景"字段优先，退化为"世界主线"条目聚合
  const background =
    extract(
      [
        new RegExp(String.raw`(?:故事背景|时代背景|背景说明|背景介绍|世界观设定)[：:、，,]?\s*([\s\S]{3,500}?)${SECTION_END}`),
        new RegExp(String.raw`(?:^|\n)\s*(?:背景|世界观)[：:、，,]\s*([\s\S]{3,500}?)${SECTION_END}`),
      ],
      normalized,
    ) ||
    extractAll(/世界主线[：:]\s*(.{3,200}?)(?:\n|$)/, normalized)
      .join('；')
      .slice(0, 300);

  // 能力：哥哥侧与妹妹侧各取一条
  const abilities: string[] = [];
  const bAbility = extract(
    [
      new RegExp(String.raw`(?:哥哥|兄长|男主|兄|哥).{0,20}?(?:能力|金手指|天赋|技能|异能|特殊能力|实力|修为)[：:、，,]?\s*(.{3,200}?)${SECTION_END}`),
      new RegExp(String.raw`(?:能力|金手指|天赋|技能|异能).{0,10}?(?:哥哥|兄长|男主|兄|哥)[：:、，,]?\s*(.{3,200}?)${SECTION_END}`),
    ],
    normalized,
  );
  if (bAbility) abilities.push(bAbility);
  const sAbility = extract(
    [
      new RegExp(String.raw`(?:妹妹|妹|女主|女二).{0,20}?(?:能力|金手指|天赋|技能|异能|特殊能力|实力|修为)[：:、，,]?\s*(.{3,200}?)${SECTION_END}`),
      new RegExp(String.raw`(?:能力|金手指|天赋|技能|异能).{0,10}?(?:妹妹|妹|女主)[：:、，,]?\s*(.{3,200}?)${SECTION_END}`),
    ],
    normalized,
  );
  if (sAbility) abilities.push(sAbility);

  const factionsText = extract(
    [
      new RegExp(String.raw`(?:势力分布|势力格局|阵营分布|主要势力|派系|门派分布)[：:、，,]?\s*(.{3,300}?)${SECTION_END}`),
      new RegExp(String.raw`(?:势力|阵营|组织|家族|帝国)[：:、，,]\s*(.{3,300}?)${SECTION_END}`),
    ],
    normalized,
  );
  const factions = factionsText ? [factionsText.slice(0, 300)] : [];

  // 矛盾：严格要求"矛盾/冲突"字样，避免误吞主线叙述
  const conflict = extract(
    [
      new RegExp(String.raw`(?:核心矛盾|主线冲突|核心冲突|主要矛盾|中心冲突)[：:、，,]?\s*(.{3,300}?)${SECTION_END}`),
      new RegExp(String.raw`(?:主线剧情)[：:、，,]\s*(.{3,300}?)${SECTION_END}`),
    ],
    normalized,
  ).slice(0, 300);

  return { characters: scanCharacters(normalized), background, abilities, factions, conflict };
}

// ---------- 草稿构建 ----------

/** 人物 → 酒馆 V2 角色卡草稿（身份/特质/背景/矛盾拼装进 description） */
export function buildCardDraft(extracted: ExtractedOutline, name: string): TavernCardV2 {
  const ch = extracted.characters.find((c) => c.name === name);
  const role = ch?.role ?? '';
  const traits = ch?.traits ?? [];
  const lines: string[] = [];
  if (role && role !== name) lines.push(`{{char}}的身份是${role}。`);
  if (traits.length > 0) lines.push(`性格与特质：${traits.join('、')}。`);
  if (extracted.background) lines.push(`世界背景：${extracted.background}`);
  if (extracted.conflict) lines.push(`核心矛盾：${extracted.conflict}`);

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: name || '未命名角色',
      description: lines.join('\n'),
      personality: traits.join('；'),
      scenario: extracted.background,
      first_mes: '',
      mes_example: '',
      creator_notes: '由大纲向导自动生成',
      creator: '',
      character_version: '',
      tags: ['outline-wizard'],
      alternate_greetings: [],
      system_prompt: '',
      post_history_instructions: '',
    },
  };
}

/** 世界书条目骨架（constant 恒注入，酒馆 newWorldInfoEntry 惯例字段） */
function constantEntry(uid: number, comment: string, content: string, keys: string[]): TavernWorldInfoEntry {
  return {
    uid,
    key: keys,
    keysecondary: [],
    comment,
    content,
    constant: true,
    vectorized: false,
    selective: false,
    selectiveLogic: 0,
    addMemo: true,
    order: 100,
    position: 0,
    disable: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    probability: 100,
    useProbability: true,
    depth: 4,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    automationId: '',
    role: null,
    sticky: 0,
    cooldown: 0,
    delay: 0,
  };
}

/** 势力文本切分为词级 key（2-6 字短语） */
function factionKeys(text: string): string[] {
  return text
    .split(/[，,、。；;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 6)
    .slice(0, 8);
}

/** 背景/势力/矛盾 → 世界书草稿（全部 constant 条目） */
export function buildWorldbookDraft(extracted: ExtractedOutline): { name: string; raw: TavernWorldInfoFile } {
  const entries: TavernWorldInfoEntry[] = [];
  let uid = 0;
  if (extracted.background) {
    entries.push(constantEntry(uid++, '世界背景', extracted.background, ['世界', '背景', '大陆', '王朝']));
  }
  for (const faction of extracted.factions) {
    entries.push(constantEntry(uid++, '势力', faction, factionKeys(faction).length > 0 ? factionKeys(faction) : ['势力']));
  }
  if (extracted.conflict) {
    entries.push(constantEntry(uid++, '核心矛盾', extracted.conflict, ['矛盾', '冲突', '阴谋']));
  }
  return {
    name: '大纲世界书',
    raw: { entries: Object.fromEntries(entries.map((e) => [String(e.uid), e])) },
  };
}
