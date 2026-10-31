/**
 * 对话大纲·迭代阶段协议层（安卓 app Phase2 P2.3，共识 D5：同一会话创建→迭代）
 *
 * 纯函数可测，不触网。两条链路：
 * - 迭代对话：书章目录 + 作者消息 → 严格 JSON {reply, chapterIndex, rewriteBrief}
 *   （reply 需提示关键词时必须原文含 ITER_KEYWORD；chapterIndex=作者想改的章）
 * - 新版本生成：锁定章的当前激活版本全文 + 对话累积的修改要点 → 重写正文（纯文本输出）
 * 关键词触发由前端规范化字符串匹配（高危动作不用 LLM 判断）；UI 另给确认按钮等价发送。
 */
import type { GenerateMessage } from '../../api/llm';

/** 触发新版本生成的魔法关键词（原文精确匹配，去空格后比对） */
export const ITER_KEYWORD = '我确定要给本书这一章节增加新的版本';

/** 关键词命中判定：去空白后包含即命中（容错手滑空格，不改字序） */
export function hitsIterKeyword(text: string): boolean {
  return text.replace(/\s+/g, '').includes(ITER_KEYWORD);
}

export interface IterChapterRef {
  index: number;
  title: string;
  /** 当前激活版本正文（截断到 1200 字供目录理解，重写时用全文） */
  excerpt: string;
}

export interface IterReply {
  /** 给作者的话（自然语言确认/追问） */
  reply: string;
  /** 作者想改的章号（对话中锁定；未明确=null） */
  chapterIndex: number | null;
  /** 已确认的修改要点（chapterIndex 锁定后累积） */
  rewriteBrief: string | null;
}

const ITER_SYSTEM = `你是小说《BOOK_TITLE》的创作助手（对话大纲·迭代阶段）。作者会用自然语言说某一章想怎么改（如"第2章太平淡，想要一场雨夜追逐"）。
你的任务：
1. 理解作者想改哪一章（chapterIndex=章号数字，没说清=null）。
2. 修改要点不清楚时用 reply 追问（一次只问一个关键问题）；要点清楚时在 rewriteBrief 里用第三人称一句话总结「怎么改」。
3. reply 里需要请作者确认时，必须原文写出这句话：` + ITER_KEYWORD + `。
只输出严格 JSON（不要代码块不要解释）：{"reply":"给作者的话","chapterIndex":N或null,"rewriteBrief":"要点或null"}`;

/** 迭代对话消息组装：目录（章号+标题+摘要）+ 预读取的书籍资料（角色卡/世界书）让模型真正「读过这本书」 */
export function buildIterChatMessages(input: {
  workTitle: string;
  chapters: readonly IterChapterRef[];
  history: readonly { role: 'user' | 'assistant'; content: string }[];
  userText: string;
  /** 预读取的书籍资料（角色卡人设/世界书要点/设定），缺省时不注入 */
  bookBrief?: string;
}): GenerateMessage[] {
  const catalog = input.chapters
    .map((c) => `第${c.index}章《${c.title}》：${c.excerpt.slice(0, 200)}…`)
    .join('\n');
  const brief = input.bookBrief ? `\n\n【本书资料（已预读取）】\n${input.bookBrief}` : '';
  return [
    { role: 'system', content: ITER_SYSTEM.replaceAll('BOOK_TITLE', input.workTitle) + brief + `\n\n【当前章节目录】\n${catalog || '（暂无章节）'}` },
    ...input.history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: input.userText },
  ];
}

/** 解析迭代回复：严格 JSON；解析失败（纯闲聊/格式坏）→ null（调用方把原文当 reply 显示） */
export function parseIterReply(text: string): IterReply | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const reply = typeof raw.reply === 'string' ? raw.reply : '';
    if (!reply) return null;
    const chapterIndex = typeof raw.chapterIndex === 'number' && Number.isInteger(raw.chapterIndex) ? raw.chapterIndex : null;
    const rewriteBrief = typeof raw.rewriteBrief === 'string' && raw.rewriteBrief.trim() ? raw.rewriteBrief.trim() : null;
    return { reply, chapterIndex, rewriteBrief };
  } catch {
    return null;
  }
}

/** 新版本重写消息：保留情节骨架 + 按要点重写 + 全文输出（不输出解释）；bookBrief 让重写贴合全书设定（review #6：无资料时不引用不存在的内容） */
export function buildRewriteMessages(input: {
  workTitle: string;
  chapter: { index: number; title: string; content: string };
  brief: string;
  /** 预读取的书籍资料（角色卡/世界书），缺省时不注入也不提及 */
  bookBrief?: string;
}): GenerateMessage[] {
  const briefBlock = input.bookBrief
    ? `\n\n【本书资料（已预读取）——人物言行必须严格符合以下角色与世界设定】\n${input.bookBrief}`
    : '';
  return [
    {
      role: 'system',
      content:
        '你是资深小说改稿写手。根据「修改要点」重写整章：保留原文情节骨架与关键转折，按要点调整/增删场景；' +
        '字数硬性要求：不少于 2500 字（与原文相当或更长），写足内容再收尾，禁止提前收束；' +
        '只输出重写后的正文全文，禁止任何解释、标题或元信息；全程使用简体中文。' +
        briefBlock,
    },
    {
      role: 'user',
      content:
        `【书名】${input.workTitle}\n【要重写的章节】第${input.chapter.index}章 ${input.chapter.title}\n` +
        `【修改要点】${input.brief}\n\n【原文全文】\n${input.chapter.content}`,
    },
  ];
}

/** 提取模型纯文本输出（generate 非流式响应 text 字段，容错剥 <think>） */
export function extractRewriteText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .trim();
}
