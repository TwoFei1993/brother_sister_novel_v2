/**
 * 聊天式创作向导的 LLM 协议层（纯函数，可测）
 *
 * 协议：模型每次回复输出严格 JSON
 *   { "reply": "给用户的话", "questions": ["反问"], "title": "书名",
 *     "genre": "题材", "outline": ExtractedOutline 形状 }
 * - reply/questions 渲染为聊天气泡；outline 非空 → 更新策划案卡片
 * - 解析失败（纯闲聊/格式坏）→ 仅作为讨论文本显示，策划案保持不变
 * 导入复用向导既有编排：importAllAssets（建卡+世界书）→ createWork（携带 ids 与章节大纲）
 */
import type { VolumeOutlineItem } from '@shared/work';

import { mergeProposalUpdate, type ExtractedOutline } from '../../lib/outline/wizard';
import { toChapterOutlineItems } from '../../lib/outline/chapters';

export interface PlannerProposal {
  title: string;
  genre: string;
  extracted: ExtractedOutline;
}

/** 反问条目：问题 + 可点选的候选项（含一个自由填写提示；superpowers 式确认） */
export interface PlannerQuestion {
  q: string;
  options: string[];
}

export interface ParsedPlannerReply {
  reply: string;
  questions: PlannerQuestion[];
  proposal: PlannerProposal | null;
}

/**
 * 章节大纲归一化（缺 index 修复）：LLM 输出的 chapters 条目可能缺 index（卷规划条目、
 * 截断尾条、忘记编号）——undefined 进 Math.max 得 NaN，JSON.stringify(NaN) 序列化为 null，
 * 被 settings 校验（desiredChapterCount/chapterOutlines.index 均为正整数）以
 * 「Expected number, received null」拒之门外。统一在此补序号兜底 + 字段字符串化，
 * 所有消费方（向导一键开书 / 书内应用资料）拿到的 index 保证为正整数。
 * 迭代轮「只输出变动部分」协议：unchanged:true 且无 title/plot 的占位条目保留标记，
 * 由 mergeProposalUpdate 回填或丢弃（有实质内容的条目即使带 unchanged 也视为完整输出）。
 */
export function normalizeOutlineChapters(
  chapters: ReadonlyArray<{ index?: unknown; title?: unknown; plot?: unknown; unchanged?: unknown; deleted?: unknown }>,
): Array<{ index: number; title: string; plot: string; unchanged?: boolean; deleted?: boolean }> {
  return chapters.map((c, i) => {
    const raw = Number(c.index);
    const title = String(c.title ?? '');
    const plot = String(c.plot ?? '');
    const unchanged = c.unchanged === true && title.trim() === '' && plot.trim() === '';
    const deleted = c.deleted === true && title.trim() === '' && plot.trim() === '' && !unchanged;
    return {
      index: Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : i + 1,
      title,
      plot,
      ...(unchanged ? { unchanged: true } : {}),
      ...(deleted ? { deleted: true } : {}),
    };
  });
}

export const PLANNER_SYSTEM = `你是网文创作向导。用户描述创作想法后，你负责**先问清楚、再产出**一份可直接开书的策划案（像资深编辑的选题面谈，不要自顾自脑补）。
每次回复输出严格 JSON（无其他文字）：
{"reply":"给用户的话（口语化）","questions":[{"q":"需要用户拍板的问题","options":["候选项一","候选项二","候选项三"]}],"title":"书名","genre":"题材","outline":{...}或null}
questions 规则：每个问题必须带 2-3 个具体候选项；无问题则 questions 传空数组。**每组 questions 的最后一题固定为「你有什么建议和想法？」**——候选项给 2-3 个你的专业建议方向（如「妹妹的异能觉醒放在第1章结尾更抓人」），用户可以直接选，也可以完全自由输入自己的想法。
理解规则（反馈③：先复述、再提问，防止理解跑偏）：
- 每轮 reply 的第一句先用你的话**复述你对需求的理解**（要写什么、时间跨度/主角/总章数等关键点各是什么）；复述错了用户会纠正你。
- 严格以用户原话中的实体与设定为准（书名、人名、总章数、时间跨度都按原话采用），不得自行增删；拿不准的点放进 questions（一次最多 3 问），已明确的绝不重复问。
- 用户给了总章数就按该总数规划节奏；数量庞大时首轮只出「分卷规划（volumes）+ 首批章细纲（chapters）」（见大纲规模规则）。
交互协议（grill 式面谈，严格按阶段走）：
- **提问上限：全程最多 3 轮 questions**。第 3 轮用户回答后必须直接出案（questions 空数组、outline 填全）——界面会在用户回答后自动触发直接生成。
- 问题只问**影响大纲走向的关键拍板点**，每轮 2-3 问，按优先级排：①题材基调与目标读者口味 ②主角核心设定（身份/金手指/性格底色）③核心冲突与对手 ④结局倾向（HE/BE/开放）⑤体量与节奏（总章数/单章字数）。**禁止琐碎问题**（配角姓名、具体日期地名、章节标题偏好等由你按题材合理设定，不问用户）。
- 剩余的小分歧不再提问——由你按已回答的口味倾向直接拍板写入策划案，并在 reply 里用一句话说明你的取舍，用户不满意可在迭代阶段修改。
- 阶段一·提问（默认）：想法尚浅时**只提问、不产出策划案**（outline=null）。等用户回答；用户若说「直接生成」，跳过剩余提问立即出案。
- 阶段二·出案：关键问题已被回答后，一次性产出完整策划案（outline 填全），reply 用几句话概括亮点。
- 阶段三·迭代（策划案生成后的**自由调整模式**，用户反馈：要能反复用自己的话继续沟通调整）：策划案出来后，用户可以反复用任意口语化的话提调整——大改结构、小改细节、增删人物/物品/章节、调整文风基调都行；你听懂意图后**只改对应部分**，其余继承当前策划案，reply 说明改了什么。此阶段不设轮次上限，用户随时可以直接开书。
- **调整轮输出分量控制（极重要）**：迭代轮只输出**发生变动的部分**，禁止重发整份大纲——未变更的章节**不用输出**（系统自动保留）；被修改的章输出完整条目；要删除的章输出 {"index":N,"deleted":true}；characters/background/abilities/factions/conflict/volumes/items 未变动时**整个字段省略**（系统继承基准值）；只有用户要求全盘重写时才输出完整版。这样调整轮输出保持很小，不会截断。
- 纯闲聊/问答（无策划变更）→ outline 传 null，reply 正常聊天。
outline 结构：
{"characters":[{"name":"姓名","role":"身份（哥哥/妹妹/反派等）","traits":["特质"]}],"background":"世界观与背景（200-400字）","abilities":["金手指/特殊能力"],"factions":["势力"],"conflict":"核心矛盾一句话","items":[{"name":"物品名","summary":"一句话：这是什么、特殊在哪（外观/功能/情感意义，会建成物品资料卡）"}],"volumes":[{"index":1,"title":"卷名","summary":"本卷主线概述150-300字（本卷起止事件与主线推进）","startChapter":1}],"chapters":[{"index":1,"title":"第1章 标题","plot":"本章剧情要点80-150字，具体到可直接写成文"}]}
items 规则：只列**对剧情有实际作用的特殊物品/道具**（金手指载体、信物、关键武器等），普通日常物品不列；2-6 条为宜，没有就传空数组。
大纲规模规则（反馈⑥：超长大纲一次输出会截断断流；用户反馈：卷大纲与章细纲严格分层）：
- 卷与章分层：**volumes 放卷规划**（每卷一条：卷名 + 本卷主线概述 + startChapter 起始章号，默认每卷约 12 章）；**chapters 只放逐章细纲**，禁止把卷规划混进 chapters。
- 默认首轮规划 8-12 章细纲；用户要求总章数 > 30 时，先出全部分卷规划（volumes 填全），chapters 只给第一卷的前 12-15 章细纲，并在 reply 里说明「后续各卷细纲按卷续出」。
- characters 至少 2 名，兄妹核心关系优先；连续多轮续出细纲时，下一轮从上次输出的最后章号 +1 继续（新开的卷同步在 volumes 追加条目）。`;

/**
 * 从模型原始输出解析。推理模型（MiniMax-M3 等）常见两类污染：
 * 1. <think> 块（内含大括号会干扰朴素正则）——先剥离
 * 2. ```json 围栏——剥离
 * 之后用**括号平衡扫描**逐个候选 {…} 尝试解析（贪婪 [\s\S]* 会被思考中的 { 提前截断）；
 * 全部失败 → null（当纯讨论处理）。
 */
/**
 * 从模型原始输出解析。
 * baseline（迭代轮「只输出变动部分」协议）：传入当前策划案后，outline 只需包含**任一变动字段**
 * （chapters/volumes/items/characters/background…）即视为合法的部分更新——解析后经
 * mergeProposalUpdate 回填合并（占位条目→基准原文；缺失字段→继承基准）；title/genre 缺省
 * 时继承基准。首轮出案（无 baseline）保持原严格校验（characters 非空 + background 必填）。
 */
export function parsePlannerReply(raw: string, baseline?: PlannerProposal | null): ParsedPlannerReply | null {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/```(?:json)?/gi, '');
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth += 1; continue; }
    if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) candidates.push(cleaned.slice(start, i + 1));
    }
  }
  for (const candidate of candidates) {
    const parsed = tryParseReply(candidate, baseline ?? null);
    if (parsed) return parsed;
  }
  return null;
}

/** outline 是否携带至少一个变动字段（部分更新合法性判据——迭代轮协议；与基准等值的字段不算变动） */
function hasAnyOutlineUpdate(o: Partial<ExtractedOutline> | null | undefined, baseline: PlannerProposal | null): boolean {
  if (o === null || typeof o !== 'object') return false;
  const b = baseline?.extracted;
  const changedStr = (v: string | undefined, base: string | undefined): boolean =>
    typeof v === 'string' && v.trim() !== '' && v.trim() !== (base ?? '').trim();
  const changedArr = (v: unknown[] | undefined, base: unknown[] | undefined): boolean =>
    Array.isArray(v) && v.length > 0 && JSON.stringify(v) !== JSON.stringify(base ?? []);
  // chapters：有非占位条目才算变动（全占位 = 全继承）
  const chaptersChanged =
    Array.isArray(o.chapters) &&
    o.chapters.some((c) => !(c?.unchanged === true && !String(c.title ?? '').trim() && !String(c.plot ?? '').trim()));
  return (
    chaptersChanged ||
    changedArr(o.volumes, b?.volumes) ||
    changedArr(o.items, b?.items) ||
    changedArr(o.characters, b?.characters) ||
    changedArr(o.factions, b?.factions) ||
    changedArr(o.abilities, b?.abilities) ||
    changedStr(o.background, b?.background) ||
    changedStr(o.conflict, b?.conflict)
  );
}

/** 单个 JSON 候选的结构化校验 */
function tryParseReply(candidate: string, baseline: PlannerProposal | null): ParsedPlannerReply | null {
  try {
    const j = JSON.parse(candidate) as {
      reply?: unknown;
      questions?: unknown;
      title?: unknown;
      genre?: unknown;
      outline?: unknown;
    };
    const reply = typeof j.reply === 'string' ? j.reply : '';
    const questions: PlannerQuestion[] = Array.isArray(j.questions)
      ? j.questions
          .map((item) => {
            if (typeof item === 'string') return { q: item, options: [] as string[] }; // 旧格式容错
            if (typeof item !== 'object' || item === null) return null;
            const rec = item as { q?: unknown; options?: unknown };
            const q = typeof rec.q === 'string' ? rec.q.trim() : '';
            if (!q) return null;
            const options = Array.isArray(rec.options) ? rec.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '') : [];
            return { q, options };
          })
          .filter((x): x is PlannerQuestion => x !== null)
      : [];
    const o = j.outline as Partial<ExtractedOutline> | null | undefined;
    const validOutline =
      o !== null &&
      typeof o === 'object' &&
      (baseline
        ? hasAnyOutlineUpdate(o, baseline)
        : Array.isArray(o.characters) &&
          o.characters.length > 0 &&
          typeof o.background === 'string');
    if (!validOutline || o === null || typeof o !== 'object') {
      return { reply, questions, proposal: null };
    }
    // 字段归一化（宽容：迭代轮部分更新时缺失字段交给 mergeProposalUpdate 继承基准）
    const normalized: ExtractedOutline = {
      characters: Array.isArray(o.characters)
        ? o.characters.map((c) => ({
            name: String(c?.name ?? ''),
            role: String(c?.role ?? ''),
            traits: Array.isArray(c?.traits) ? c.traits.map(String) : [],
          }))
        : [],
      background: typeof o.background === 'string' ? o.background : '',
      abilities: Array.isArray(o.abilities) ? o.abilities.map(String) : [],
      ability: typeof o.ability === 'string' ? o.ability : undefined,
      factions: Array.isArray(o.factions) ? o.factions.map(String) : [],
      conflict: typeof o.conflict === 'string' ? o.conflict : '',
      chapters: Array.isArray(o.chapters) ? normalizeOutlineChapters(o.chapters) : undefined,
      // 卷规划层（用户反馈：卷大纲与章细纲分开）：缺 index 按数组序补号，与章细纲同层容错
      volumes: o.volumes === undefined ? undefined : normalizeOutlineVolumes(o.volumes),
      // 特殊物品清单（用户需求：物品道具资料卡）：名字非空的条目才收
      items: o.items === undefined ? undefined : normalizeOutlineItems(o.items),
    };
    // 迭代轮：带基准 → 占位回填 + 缺失字段继承（含 title/genre 缺省继承）；首轮出案原样收下
    const mergedExtracted = baseline ? mergeProposalUpdate(baseline.extracted, normalized) : normalized;
    const fallbackTitle = baseline?.title ?? '未命名作品';
    const fallbackGenre = baseline?.genre ?? '未分类';
    const proposal: PlannerProposal = {
      title: typeof j.title === 'string' && j.title.trim() && j.title.trim() !== '未命名作品' ? j.title.trim() : fallbackTitle,
      genre: typeof j.genre === 'string' && j.genre.trim() && j.genre.trim() !== '未分类' ? j.genre.trim() : fallbackGenre,
      extracted: mergedExtracted,
    };
    return { reply, questions, proposal };
  } catch {
    return null;
  }
}

/** 卷规划归一化（与 normalizeOutlineChapters 同思路）：缺 index 按数组序补正整数、字段字符串化、
 *  startChapter 非正数丢弃；title 与 summary 全空的条目剔除 */
export function normalizeOutlineVolumes(
  volumes: ReadonlyArray<{ index?: unknown; title?: unknown; summary?: unknown; startChapter?: unknown }> | undefined,
): VolumeOutlineItem[] {
  if (!Array.isArray(volumes)) return [];
  return volumes
    .map((v, i) => {
      const raw = Number(v.index);
      const sc = Number(v.startChapter);
      return {
        index: Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : i + 1,
        title: String(v.title ?? '').trim(),
        summary: String(v.summary ?? '').trim(),
        ...(Number.isFinite(sc) && sc > 0 ? { startChapter: Math.floor(sc) } : {}),
      };
    })
    .filter((v) => v.title !== '' || v.summary !== '');
}

/** 特殊物品清单归一化：name/summary 字符串化 + 去空白名条目（物品资料卡的数据源） */
export function normalizeOutlineItems(
  items: ReadonlyArray<{ name?: unknown; summary?: unknown }> | undefined,
): Array<{ name: string; summary: string }> {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => ({ name: String(it.name ?? '').trim(), summary: String(it.summary ?? '').trim() }))
    .filter((it) => it.name !== '');
}

/**
 * 历史 assistant 消息瘦身：迭代轮每改一次就会在历史里囤一整份大纲 JSON，prompt 随迭代
 * 线性膨胀——实测大 prompt 会被中转通道静默截断/空回（反馈②「大纲后没法继续沟通」的根因
 * 之一）。最新基准消息已带全量策划案，历史 JSON 是纯冗余，超长 JSON 压成一行占位说明。
 */
function slimHistoryText(text: string): string {
  return text.replace(/\{[\s\S]{400,}\}/g, '（该轮策划案 JSON 已略——以末尾最新基准为准）');
}

/**
 * 基准消息瘦身：章节只带 index+title。迭代轮协议下模型只需标题判断改动点（未变更章节
 * 写占位、系统回填全文），plot 不进 prompt——12 章+分卷的大纲基准从上万字缩到千字级。
 */
function compactBaseline(p: PlannerProposal): string {
  const chapters = (p.extracted.chapters ?? [])
    .filter((c) => !c.unchanged && !c.deleted)
    .map(({ index, title }) => ({ index, title }));
  return JSON.stringify({ title: p.title, genre: p.genre, ...p.extracted, chapters });
}

/** 组装对话消息（system + 瘦身历史 + 瘦身基准） */
export function plannerMessages(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  proposal: PlannerProposal | null,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const base = [
    { role: 'system' as const, content: PLANNER_SYSTEM },
    ...history.map((t) => ({ role: t.role, content: t.role === 'assistant' ? slimHistoryText(t.content) : t.content })),
  ];
  if (!proposal) return base;
  return [
    ...base,
    {
      role: 'user' as const,
      content: `（当前策划案基准 JSON——章节仅含标题，调整时未变更章节写占位由系统回填标题与要点）\n${compactBaseline(proposal)}`,
    },
  ];
}

/** 策划案 → 作品 settings（章细纲三字段裁剪 + 分卷规划独立层）与目标章数（空大纲兜底 1——校验要求 positive） */
export function proposalToChapterSettings(proposal: PlannerProposal): {
  chapterOutlines: Array<{ index: number; title: string; plot: string }>;
  volumeOutlines: VolumeOutlineItem[];
  desiredChapterCount: number;
} {
  const chapters = normalizeOutlineChapters(proposal.extracted.chapters ?? []);
  const volumes = normalizeOutlineVolumes(proposal.extracted.volumes);
  return {
    chapterOutlines: toChapterOutlineItems(chapters),
    volumeOutlines: volumes,
    desiredChapterCount: Math.max(chapters.reduce((mx, c) => Math.max(mx, c.index), 0), 1),
  };
}
