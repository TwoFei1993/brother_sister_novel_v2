/**
 * 大纲向导（Task 32）：粘贴网文大纲 → 正则抽取人物/背景/能力/金手指/势力/矛盾 →
 * 卡片与世界书草稿构建见 ./draft。抽取算法移植旧站
 * SettingsPanel.autoFillFromOutline（重写为强类型），并修正其两处已知缺陷：
 * 1) 小节序号后无空格（"二、主要人物"）时旧站切界失败；
 * 2) 人物行（"哥哥：…"）不是小节边界，导致背景/矛盾抽取吞并后续段落。
 */
import type { ChapterOutline } from './chapters';

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
  /** 全作金手指/特殊能力（Word 导入实测：独立「金手指：」字段，非角色专属） */
  ability?: string;
  factions: string[];
  conflict: string;
  /** 章节级大纲（AI 兜底路径抽取；规则路径由 parseChapterOutlines 独立产出） */
  chapters?: ChapterOutline[];
}

// ---------- 正则基建（对照旧站） ----------

/** markdown 装饰剥离：井号标题、加粗/斜体星号、删除线、行首列表符（A6 回归） */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*+/g, '')
    .replace(/_{2,}/g, '')
    .replace(/~{2,}/g, '')
    .replace(/^[-+]\s+/gm, '');
}

/** 预处理：剥 markdown 装饰，并为行内序号/破折号条目补换行，使行级扫描与切界生效 */
function normalizeOutline(text: string): string {
  return stripMarkdown(text)
    .replace(/(?<=[^\n\s])(\s*(?:\d+[.、)）]|[（(]\s*[一二三四五六七八九十\d]+\s*[）)]|[一二三四五六七八九十]+[.、：:])\s)/g, '\n$1')
    .replace(/(?<=[^\n\s])(\s*[-—–─━]\s+(?:[一-鿿]))/g, '\n$1');
}

/**
 * 小节边界：空行 / 标记符号（含【开头的分节行）/ 序号 / 人物行 / 字段行开头，或文本结尾。
 * 在旧站基础上：序号后空白改为可省（"二、主要人物"），新增人物行、【】标记与
 * 常见字段词（核心矛盾/势力格局等——无空行无序号排版的字段行也是小节边界，A8 回归）。
 */
const SECTION_END = String.raw`(?:\n\n|\n(?=\s*[#＃【●★☆►▶◆■□▪▸·•※]|\s*\d+[.、)）]|\s*[-—–─━]\s|\s*[（(]\s*[一二三四五六七八九十\d]+\s*[）)]|\s*[一二三四五六七八九十]+[.、：:]|\s*(?:主要人物|人物设定|人物简介|角色设定|哥哥|妹妹|兄长|男主|女主|主角|核心矛盾|主线冲突|核心冲突|主要矛盾|主要冲突|中心冲突|主线剧情|势力格局|势力分布|势力设定|主要势力|故事背景|时代背景|世界背景|背景说明|金手指|特殊能力|异能|外挂|能力|剧情|看点|爽点|小冲突|梗概))|$)`;

/**
 * 关键字后取一段文本，直到下个小节边界（过短视为未命中）。
 * 长度上限移出正则：先懒惰捕到真实边界，再按 maxLen 截断——否则超长段
 * （无内嵌边界且超过上限）会整体匹配失败而非截断（A8 回归）。
 */
function extract(patterns: RegExp[], src: string, maxLen = 500): string {
  for (const pat of patterns) {
    const m = src.match(new RegExp(pat.source, 'i'));
    if (m?.[1] && m[1].trim().length >= 3) return m[1].trim().slice(0, maxLen);
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
/**
 * 散文式人物句（A2 回归）：无冒号段落内嵌「身份+人名+性格类关键词」，
 * 如「兄长萧北冥性格冷峻寡言」。人名 2-3 字并过黑名单，特质取关键词后至句读。
 */
const PROSE_ROLE_LINE = new RegExp(
  String.raw`(${ROLES})([一-鿿]{2,3})(?:性格|心思|天生|身怀|为人|一手|修炼)([^，,。！？;；\n]{2,20})`,
  'g',
);

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
      continue;
    }
    for (const proseM of text.matchAll(PROSE_ROLE_LINE)) {
      const name = proseM[2] ?? '';
      if (name && !NAME_BLACKLIST.test(name)) push(name, proseM[1] ?? name, proseM[3] ?? '');
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
        new RegExp(String.raw`(?:故事背景|时代背景|背景说明|背景介绍|世界观设定)[：:、，,]?\s*([\s\S]{3,}?)${SECTION_END}`),
        // 兼容【背景】/「一、背景：」形态：右括号纳入必选分隔（A1 回归）
        new RegExp(
          String.raw`(?:^|\n)\s*(?:[（(]?[\d一二三四五六七八九十]{1,3}[）)]?[、.．：:])?\s*[【\[]?\s*(?:背景|世界观)\s*(?:[】\]]|[：:、，,])\s*([\s\S]{3,}?)${SECTION_END}`,
        ),
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
      new RegExp(String.raw`(?:哥哥|兄长|男主|兄|哥).{0,20}?(?:能力|金手指|天赋|技能|异能|特殊能力|实力|修为)[：:、，,]?\s*(.{3,}?)${SECTION_END}`),
      new RegExp(String.raw`(?:能力|金手指|天赋|技能|异能).{0,10}?(?:哥哥|兄长|男主|兄|哥)[：:、，,]?\s*(.{3,}?)${SECTION_END}`),
    ],
    normalized,
    200,
  );
  if (bAbility) abilities.push(bAbility);
  const sAbility = extract(
    [
      new RegExp(String.raw`(?:妹妹|妹|女主|女二).{0,20}?(?:能力|金手指|天赋|技能|异能|特殊能力|实力|修为)[：:、，,]?\s*(.{3,}?)${SECTION_END}`),
      new RegExp(String.raw`(?:能力|金手指|天赋|技能|异能).{0,10}?(?:妹妹|妹|女主)[：:、，,]?\s*(.{3,}?)${SECTION_END}`),
    ],
    normalized,
    200,
  );
  if (sAbility) abilities.push(sAbility);

  // 全作金手指/特殊能力（Word 导入实测补充）：字段名贴近行首锚定，防「隐藏金手指」等正文提及误截
  const ability = extract(
    [
      new RegExp(String.raw`(?:^|\n)\s*[【\[]?\s*(?:金手指|特殊能力|异能|外挂)\s*(?:[】\]]|[：:、，,])\s*([\s\S]{3,}?)${SECTION_END}`),
    ],
    normalized,
    200,
  );

  const factionsText = extract(
    [
      new RegExp(String.raw`(?:势力分布|势力格局|阵营分布|主要势力|派系|门派分布)[：:、，,]?\s*(.{3,}?)${SECTION_END}`),
      // 字段名须贴近行首（锚定行首 + 编号类短前缀），防止正文中
      // 「……刺客组织，总部位置成谜」被误当「组织：」字段截取
      new RegExp(String.raw`(?:^|\n)\s*(?:[（(]?[\d一二三四五六七八九十]{1,3}[）)]?[、.．：:]|\S{0,4}?)\s*(?:势力|阵营|组织|家族|帝国)(?:设定|分布|简介)?(?:[】\]]|[：:、，])\s*(.{3,}?)${SECTION_END}`),
    ],
    normalized,
    300,
  );
  const factions = factionsText ? [factionsText] : [];

  // 矛盾：严格要求"矛盾/冲突"字样，避免误吞主线叙述
  const conflict = extract(
    [
      // 捕获用 [\s\S] 允许跨行（无后续边界时吞到文尾由 maxLen 截断，A8 回归）
      new RegExp(String.raw`(?:核心矛盾|主线冲突|核心冲突|主要矛盾|主要冲突|中心冲突)[：:、，,】]?\s*([\s\S]{3,}?)${SECTION_END}`),
      new RegExp(String.raw`(?:主线剧情)[：:、，,]\s*([\s\S]{3,}?)${SECTION_END}`),
    ],
    normalized,
    300,
  );

  return { characters: scanCharacters(normalized), background, abilities, ...(ability ? { ability } : {}), factions, conflict };
}
