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

export interface ParsedPlannerReply {
  reply: string;
  questions: string[];
  proposal: PlannerProposal | null;
}

export const PLANNER_SYSTEM = `你是网文创作向导。用户描述创作想法后，你负责产出并迭代一份可直接开书的策划案。
每次回复输出严格 JSON（无其他文字）：
{"reply":"给用户的话（口语化：确认要点/说明改了什么/1-3 个反问）","questions":["需要用户拍板的问题"],"title":"书名","genre":"题材","outline":{"characters":[{"name":"姓名","role":"身份（哥哥/妹妹/反派等）","traits":["特质"]}],"background":"世界观与背景（200-400字）","abilities":["金手指/特殊能力"],"factions":["势力"],"conflict":"核心矛盾一句话","chapters":[{"index":1,"title":"第1章 标题","plot":"本章剧情要点80-150字，具体到可直接写成文"}]}}
规则：
- 首轮规划 8-12 章：第 1-2 章立设定与核心冲突，中段推进，每章末尾留钩子
- 用户提出修改 → 只改对应部分，其余继承当前策划案，reply 说明改了什么
- 信息不足：先基于合理脑补给完整策划案，再在 questions 里列出需要用户确认的点（别只反问不出活）
- 纯闲聊/问答（无策划变更）→ outline 传 null，reply 正常聊天
- characters 至少 2 名，兄妹核心关系优先`;

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
    const questions = Array.isArray(j.questions) ? j.questions.filter((q): q is string => typeof q === 'string') : [];
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
