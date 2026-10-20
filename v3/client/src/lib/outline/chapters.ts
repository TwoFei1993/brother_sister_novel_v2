/**
 * 章节大纲解析（Word 导入实测反馈）：从粘贴/导入的大纲文本识别「第N章」结构，
 * 提取每章 标题/剧情/看点/小冲突（+所属卷），供两条链路共用：
 * 1) 向导「创建作品并导入大纲」（settings.chapterOutlines，直接创作闭环）；
 * 2) 生成联动（scanAndAssemble 按章号把本章要点追加进 directive）。
 *
 * 实测文档形态：巨型段落内「第N章」行内出现（段落以 U+FEFF 分隔、非行首）、
 * 「剧情/看点/小冲突」标记可能独立成行也可能行内出现、同一文档含多份大纲草稿
 * （章号重复，取首次出现）。
 */

// ---------- 类型 ----------

/** 解析出的单章大纲（规则路径全字段；入库时经 toChapterOutlineItems 裁剪为三字段） */
export interface ChapterOutline {
  index: number;
  title: string;
  /** 剧情要点（缺「剧情」标记时为标题后的整段内容） */
  plot: string;
  highlight?: string;
  conflict?: string;
  /** 所属卷（「第X卷：名称」归入其后最近的章节） */
  volume?: string;
}

// ---------- 内部正则 ----------

/**
 * 章节头：第N章（阿拉伯数字）。章后必须紧跟分隔/标记字符——排除「第198号书架」
 * （无「章」字）与「在第3章里」（章后直连正文）等正文叙述误切。
 */
const CHAPTER_HEAD = /第(\d{1,4})章(?=[\s：:、.．，,\-—–·|]|(?:剧情|看点|爽点|小冲突|梗概)|$)/g;

/** 卷标记：第X卷：名称（中文章号为主）；名称取到行尾（最长 40 字） */
const VOLUME_MARK = /第[一二三四五六七八九十百\d]{1,3}卷[：:｜|\-—]\s*([^\n]{1,40})/g;

/** 段内标记（行内/独立成行均命中）：剧情（任务）/梗概、看点/爽点、小冲突/冲突 */
const PLOT_MARK = /(?:剧情(?:任务)?|梗概)[：:]?/;
const HIGHLIGHT_MARK = /看点[：:]?|爽点[：:]?/;
const CONFLICT_MARK = /小冲突[：:]?|冲突[：:]?/;

/**
 * 段内卷标记位置探测（真实 docx 实测：末章缺「小冲突」时字段取文会一路吞到下一段
 * 开头的「第二卷：…」——卷标记是结构性边界，所有字段取文须在此截断）。
 * VOLUME_MARK 带 g 供全局扫描；此处用非全局副本做单段位置探测。
 */
const VOLUME_MARK_LOCAL = /第[一二三四五六七八九十百\d]{1,3}卷[：:｜|\-—]/;

/** 标题/剧情等内容最短门槛：过短视为正文叙述误切（如「见第3章：历史」类提及） */
const MIN_CONTENT = 4;
/** 单字段长度上限（防无标记长段撑爆 settings 与 directive） */
const FIELD_MAX = { title: 60, plot: 500, extra: 200 } as const;

/** 预处理：U+FEFF 分隔符与 \r 统一为 \n（Word 巨型段落实测形态） */
function normalizeInput(text: string): string {
  return text.replace(/\uFEFF/g, '\n').replace(/\r\n?/g, '\n');
}

function trimField(text: string, max: number): string {
  return text.trim().slice(0, max).trim();
}

/** 标题清理：剥去章号后残留的分隔符与「剧情」等标记前导碎屑 */
function cleanTitle(raw: string): string {
  return trimField(raw.replace(/^[\s：:、.．，,\-—–·|]+/, ''), FIELD_MAX.title);
}

// ---------- 单段解析 ----------

interface SegmentFields {
  title: string;
  plot: string;
  highlight?: string;
  conflict?: string;
}

/** 单章段内提取：标题（章头后到换行/最早标记前）、plot、highlight、conflict */
function parseSegment(seg: string): SegmentFields | null {
  const plotM = seg.match(PLOT_MARK);
  const highlightM = seg.match(HIGHLIGHT_MARK);
  const conflictM = seg.match(CONFLICT_MARK);
  const volumeM = seg.match(VOLUME_MARK_LOCAL);
  // 卷标记位置（无则段尾）：字段取文的结构性停止边界
  const volPos = volumeM?.index ?? seg.length;
  const markPositions = [plotM, highlightM, conflictM]
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m.index ?? seg.length);

  // 标题：章头后到「首个换行 / 最早标记 / 卷标记」中较早者
  const nlPos = seg.indexOf('\n');
  const firstMarkPos = markPositions.length > 0 ? Math.min(...markPositions) : seg.length;
  const titleEnd = nlPos === -1 ? Math.min(firstMarkPos, volPos) : Math.min(nlPos, firstMarkPos, volPos);
  const title = cleanTitle(seg.slice(0, titleEnd));

  // 标记后的取文：到下一个（更晚出现的）标记、卷标记或段尾
  const after = (mark: RegExpMatchArray | null, stops: number[]): string => {
    if (!mark) return '';
    const from = (mark.index ?? 0) + mark[0].length;
    const later = stops.filter((p) => p > (mark.index ?? 0));
    const to = later.length > 0 ? Math.min(...later) : seg.length;
    return trimField(seg.slice(from, to), FIELD_MAX.extra);
  };
  const hlPos = highlightM?.index ?? seg.length;
  const cfPos = conflictM?.index ?? seg.length;
  const fieldStop = Math.min(hlPos, cfPos, volPos);
  const plot = plotM
    ? trimField(seg.slice((plotM.index ?? 0) + plotM[0].length, fieldStop), FIELD_MAX.plot)
    : trimField(seg.slice(titleEnd, fieldStop), FIELD_MAX.plot); // 缺标记：标题后到最早标记/卷标记即剧情
  const highlight = after(highlightM, [cfPos, volPos]);
  const conflict = after(conflictM, [volPos]);

  if (title.length + plot.length + highlight.length + conflict.length < MIN_CONTENT) return null;
  return {
    title,
    plot,
    ...(highlight ? { highlight } : {}),
    ...(conflict ? { conflict } : {}),
  };
}

/**
 * 卷归属：取章头之前（≤pos）最近出现的卷标记（跨章头继承——真实 docx 为
 * 「第一卷：…」后连排多章，卷名须逐章继承，紧邻判定会丢失第 2 章起的卷名）。
 */
function volumeAt(volumes: { pos: number; name: string }[], pos: number): string | undefined {
  let hit: string | undefined;
  for (const v of volumes) {
    if (v.pos > pos) break;
    hit = v.name;
  }
  return hit;
}

// ---------- 主解析 ----------

/** 从大纲文本解析章节大纲列表；章号重复（多份草稿）取首次出现，按章号升序返回 */
export function parseChapterOutlines(text: string): ChapterOutline[] {
  const normalized = normalizeInput(text);
  if (!normalized.trim()) return [];

  const volumes: { pos: number; name: string }[] = [];
  for (const m of normalized.matchAll(VOLUME_MARK)) {
    const name = (m[1] ?? '').trim();
    if (name) volumes.push({ pos: m.index ?? 0, name });
  }

  const heads = [...normalized.matchAll(CHAPTER_HEAD)];
  const out: ChapterOutline[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i];
    const index = Number(head[1]);
    if (seen.has(index)) continue;
    const headPos = head.index ?? 0;
    const start = headPos + head[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index ?? normalized.length : normalized.length;
    const fields = parseSegment(normalized.slice(start, end));
    if (!fields) continue;
    const volume = volumeAt(volumes, headPos);
    out.push({ index, ...fields, ...(volume ? { volume } : {}) });
    seen.add(index);
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---------- 消费方辅助 ----------

/**
 * 生成联动（scanAndAssemble 用）：第 N 章存在预设大纲时返回追加到 directive 末尾的
 * 提示文本（带前导空行）；无则空串。仅进提示词，入库 directive 保持用户原指令。
 */
export function chapterOutlineDirective(
  outlines: readonly { index: number; title: string; plot: string }[] | undefined,
  chapterIndex: number,
): string {
  const hit = outlines?.find((c) => c.index === chapterIndex);
  if (!hit) return '';
  return `\n\n（本章大纲：标题《${hit.title}》；剧情要点：${hit.plot}）`;
}

/** settings 入库裁剪：ChapterOutline → {index,title,plot}（shared ChapterOutlineItem 形状） */
export function toChapterOutlineItems(chapters: ChapterOutline[]): { index: number; title: string; plot: string }[] {
  return chapters.map(({ index, title, plot }) => ({ index, title, plot }));
}
