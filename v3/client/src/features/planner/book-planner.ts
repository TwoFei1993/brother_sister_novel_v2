/**
 * 书内「全书策划对话」协议与存储（反馈：毫无头绪也能先聊大纲——零章节即可开聊，
 * 独立于通用向导的每书独立会话；确认后一键应用到「资料」，应用记录保留历史可回滚）。
 *
 * - 协议复用 planner-llm（严格 JSON：reply/questions/proposal），多选组件直接复用 PlannerQuestions
 * - 会话与历史按 workId 独立持久化（localStorage），跨页面切换上下文不丢
 */
import type { ExtractedOutline } from '../../lib/outline/wizard';
import type { PlannerProposal, PlannerQuestion } from './planner-llm';

export interface BookTurn {
  role: 'user' | 'assistant';
  text: string;
  questions?: PlannerQuestion[];
  interrupted?: boolean;
}

export interface BookChatState {
  turns: BookTurn[];
  proposal: PlannerProposal | null;
}

export interface AppliedVersion {
  at: number;
  label: string;
  /** 应用到 settings 的资料切片（回滚即恢复此切片） */
  slice: {
    chapterOutlines: Array<{ index: number; title: string; plot: string }>;
    desiredChapterCount: number;
    backgroundNote: string;
    coreConflict: string;
    factions: string;
  };
  proposal: PlannerProposal;
}

export type { ExtractedOutline };

const chatKey = (workId: string): string => `v3-book-outline-chat-${workId}`;
const histKey = (workId: string): string => `v3-book-outline-hist-${workId}`;

export function loadChat(workId: string): BookChatState {
  try {
    const raw = localStorage.getItem(chatKey(workId));
    if (raw) {
      const d = JSON.parse(raw) as BookChatState;
      if (Array.isArray(d.turns) && d.turns.length > 0) return d;
    }
  } catch {
    /* 坏存储重建 */
  }
  return {
    turns: [
      {
        role: 'assistant',
        text: '我们来一起把这本书的世界观、主角、势力和大纲聊出来。你可以毫无头绪——把任何想法（哪怕一个词）告诉我，我来帮你发散；也可以点下面的选项。聊清楚了我会出策划案，你确认后一键写入「资料」。',
      },
    ],
    proposal: null,
  };
}

export function saveChat(workId: string, s: BookChatState): void {
  try {
    localStorage.setItem(chatKey(workId), JSON.stringify(s));
  } catch {
    /* 静默 */
  }
}

export function loadHistory(workId: string): AppliedVersion[] {
  try {
    const raw = localStorage.getItem(histKey(workId));
    if (raw) {
      const d = JSON.parse(raw) as AppliedVersion[];
      if (Array.isArray(d)) return d;
    }
  } catch {
    /* 静默 */
  }
  return [];
}

export function pushHistory(workId: string, version: AppliedVersion): AppliedVersion[] {
  const list = [...loadHistory(workId), version];
  try {
    localStorage.setItem(histKey(workId), JSON.stringify(list));
  } catch {
    /* 静默 */
  }
  return list;
}

/** 书内策划系统提示词（注入本书既有上下文；长纲分卷规则防断流） */
export function bookPlannerSystem(input: {
  title: string;
  genre: string;
  settingsBits: string;
  chapterCount: number;
  chapterTail: string;
}): string {
  return `你是小说《${input.title}》的策划编辑（这本书已存在${input.chapterCount > 0 ? `，已有 ${input.chapterCount} 章` : '，尚未写正文'}）。
用户可能毫无头绪——你的职责是帮用户从零发散：世界观、主角与兄妹核心关系、势力、主要冲突、总章数与分卷大纲。
每次回复输出严格 JSON（无其他文字）：
{"reply":"给用户的话","questions":[{"q":"问题","options":["候选项一","候选项二","候选项三"]}],"title":"书名","genre":"题材","outline":{...}或null}
理解规则：每轮 reply 第一句先复述你对当前进度的理解；用户原话中的设定（书名/人名/数量/跨度）严格照用；拿不准才问、已确认绝不重复问；用户说「你决定/都行」时你直接替用户拍板并说明理由，不要再反问。
questions 规则：每题 2-3 个具体候选项；无问题传空数组。
阶段流程：想法发散（多轮问答，outline=null）→ 关键点齐了出完整策划案（outline 填全）→ 用户提修改则只改对应部分并输出完整最新版 → 纯闲聊 outline=null。
outline 结构：
{"characters":[{"name":"姓名","role":"身份","traits":["特质"]}],"background":"世界观与背景（200-400字）","abilities":["金手指/特殊能力"],"factions":["势力"],"conflict":"核心矛盾一句话","chapters":[{"index":1,"title":"第1章 标题","plot":"要点80-150字"}]}
大纲规模规则：用户要求总章数 > 30 时，chapters 只输出卷规划（每卷一段）+ 第一卷前 12-15 章细纲，reply 说明「后续按卷续出」；默认首轮 8-12 章。
${input.settingsBits ? `\n【本书既有设定】\n${input.settingsBits}` : ''}${input.chapterTail ? `\n【已有正文（最新章尾部）】\n${input.chapterTail}` : ''}`;
}

/** 组装消息（system + 近 12 轮历史 + 当前策划案基准） */
export function bookPlannerMessages(
  system: string,
  history: readonly BookTurn[],
  userText: string,
  proposal: PlannerProposal | null,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const base = [{ role: 'system' as const, content: system }, ...history.slice(-12).map((t) => ({ role: t.role, content: t.text }))];
  if (!proposal) return [...base, { role: 'user' as const, content: userText }];
  return [
    ...base,
    { role: 'user' as const, content: userText },
    { role: 'user' as const, content: `（当前策划案基准 JSON，修改时继承未提及部分）\n${JSON.stringify({ title: proposal.title, genre: proposal.genre, ...proposal.extracted })}` },
  ];
}

/** 应用策划案 → 资料 settings 切片（updateWork 与历史快照共用） */
export function proposalToSlice(
  proposal: PlannerProposal,
  base: { desiredChapterCount?: number },
): AppliedVersion['slice'] {
  const chapters = proposal.extracted.chapters ?? [];
  const desired = Math.max(
    chapters.reduce((mx, c) => Math.max(mx, c.index), 0),
    base.desiredChapterCount ?? 0,
    1,
  );
  return {
    chapterOutlines: chapters.map((c) => ({ index: c.index, title: c.title, plot: c.plot })),
    desiredChapterCount: desired,
    backgroundNote: proposal.extracted.background,
    coreConflict: proposal.extracted.conflict,
    factions: proposal.extracted.factions.join('、'),
  };
}
