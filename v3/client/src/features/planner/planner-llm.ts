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
import type { ExtractedOutline } from '../../lib/outline/wizard';
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

export const PLANNER_SYSTEM = `你是网文创作向导。用户描述创作想法后，你负责**先问清楚、再产出**一份可直接开书的策划案（像资深编辑的选题面谈，不要自顾自脑补）。
每次回复输出严格 JSON（无其他文字）：
{"reply":"给用户的话（口语化）","questions":[{"q":"需要用户拍板的问题","options":["候选项一","候选项二","候选项三"]}],"title":"书名","genre":"题材","outline":{...}或null}
questions 规则：每个问题必须带 2-3 个具体候选项；无问题则 questions 传空数组。
理解规则（反馈③：先复述、再提问，防止理解跑偏）：
- 每轮 reply 的第一句先用你的话**复述你对需求的理解**（要写什么、时间跨度/主角/总章数等关键点各是什么）；复述错了用户会纠正你。
- 严格以用户原话中的实体与设定为准（书名、人名、总章数、时间跨度都按原话采用），不得自行增删；拿不准的点放进 questions（一次最多 3 问），已明确的绝不重复问。
- 用户给了总章数就按该总数规划节奏；数量庞大时首轮只出「卷规划 + 首批细纲」（见大纲规模规则）。
交互协议（grill 式面谈，严格按阶段走）：
- 阶段一·提问（默认）：想法尚浅时**只提问、不产出策划案**（outline=null）。每轮 questions 问 2-3 个最关键的拍板问题，等用户回答。禁止在问题未回答前就输出完整策划案。
- 阶段二·出案：关键问题已被回答后，一次性产出完整策划案（outline 填全），reply 用几句话概括亮点；仍有小分歧可在 questions 里列出（1-2 个），但策划案必须完整给出。
- 阶段三·迭代：用户对策划案提修改 → 只改对应部分，其余继承当前策划案，reply 说明改了什么；改完 outline 输出**完整最新版**（不是只输出改动片段）。
- 纯闲聊/问答（无策划变更）→ outline 传 null，reply 正常聊天。
outline 结构：
{"characters":[{"name":"姓名","role":"身份（哥哥/妹妹/反派等）","traits":["特质"]}],"background":"世界观与背景（200-400字）","abilities":["金手指/特殊能力"],"factions":["势力"],"conflict":"核心矛盾一句话","chapters":[{"index":1,"title":"第1章 标题","plot":"本章剧情要点80-150字，具体到可直接写成文"}]}
大纲规模规则（反馈⑥：超长大纲一次输出会截断断流）：
- 默认首轮规划 8-12 章；用户要求总章数 > 30 时，chapters 只输出**卷规划（每卷一段 plot 概述该卷起止与主线）+ 第一卷的前 12-15 章细纲**，并在 reply 里说明「后续各卷细纲按卷续出」。
- characters 至少 2 名，兄妹核心关系优先；连续多轮续出细纲时，下一轮从上次输出的最后章号 +1 继续。`;

/**
 * 从模型原始输出解析。推理模型（MiniMax-M3 等）常见两类污染：
 * 1. <think> 块（内含大括号会干扰朴素正则）——先剥离
 * 2. ```json 围栏——剥离
 * 之后用**括号平衡扫描**逐个候选 {…} 尝试解析（贪婪 [\s\S]* 会被思考中的 { 提前截断）；
 * 全部失败 → null（当纯讨论处理）。
 */
export function parsePlannerReply(raw: string): ParsedPlannerReply | null {
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
    const parsed = tryParseReply(candidate);
    if (parsed) return parsed;
  }
  return null;
}

/** 单个 JSON 候选的结构化校验 */
function tryParseReply(candidate: string): ParsedPlannerReply | null {
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
    const o = j.outline as ExtractedOutline | null | undefined;
    const validOutline =
      o !== null &&
      typeof o === 'object' &&
      Array.isArray(o.characters) &&
      o.characters.length > 0 &&
      typeof o.background === 'string';
    const proposal: PlannerProposal | null = validOutline
      ? {
          title: typeof j.title === 'string' && j.title.trim() ? j.title.trim() : '未命名作品',
          genre: typeof j.genre === 'string' && j.genre.trim() ? j.genre.trim() : '未分类',
          extracted: {
            characters: o.characters.map((c) => ({
              name: String(c?.name ?? ''),
              role: String(c?.role ?? ''),
              traits: Array.isArray(c?.traits) ? c.traits.map(String) : [],
            })),
            background: o.background,
            abilities: Array.isArray(o.abilities) ? o.abilities.map(String) : [],
            ability: typeof o.ability === 'string' ? o.ability : undefined,
            factions: Array.isArray(o.factions) ? o.factions.map(String) : [],
            conflict: typeof o.conflict === 'string' ? o.conflict : '',
            chapters: Array.isArray(o.chapters) ? o.chapters : [],
          },
        }
      : null;
    return { reply, questions, proposal };
  } catch {
    return null;
  }
}

/** 组装对话消息（system + 历史 + 当前策划案基准） */
export function plannerMessages(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  proposal: PlannerProposal | null,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const base = [{ role: 'system' as const, content: PLANNER_SYSTEM }, ...history];
  if (!proposal) return base;
  return [
    ...base,
    {
      role: 'user' as const,
      content: `（当前策划案基准 JSON，修改时继承未提及部分）\n${JSON.stringify({ title: proposal.title, genre: proposal.genre, ...proposal.extracted })}`,
    },
  ];
}

/** 策划案 → 作品 settings.chapterOutlines（三字段裁剪）与目标章数 */
export function proposalToChapterSettings(proposal: PlannerProposal): {
  chapterOutlines: Array<{ index: number; title: string; plot: string }>;
  desiredChapterCount: number;
} {
  const chapters = proposal.extracted.chapters ?? [];
  return {
    chapterOutlines: toChapterOutlineItems(chapters),
    desiredChapterCount: chapters.reduce((mx, c) => Math.max(mx, c.index), 0),
  };
}
