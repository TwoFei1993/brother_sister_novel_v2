/**
 * 输出净化器（设计 §5.3 质量治理：从 postprocess.ts 迁出）
 *
 * 职责：与正则脚本/状态块/标题解析无关的纯文本净化——
 * 内置卫生层（思考块/名字前缀/嵌套标题/自定义标签）→ 无标签思维流剥离 →
 * 尾部元信息剥离 → 提纲分离 → 展示净化组合。
 * postprocess.ts 的 postprocessMessage 总入口仍按原顺序调用本模块。
 */
import { stripChatPreamble } from './novel/chat-preamble';

/** 正文中的后续标题行（模型自拟的嵌套小标题，如 `## 卷一`）——连同行尾换行一并移除 */
const HEADING_LINE_RE = /^#{1,6}[ \t]+\S.*\n?/gm;

/** 提纲/要点的标记词（标题行或引导行含其一即判定为提纲块开始） */
const OUTLINE_MARKERS = ['要点', '提纲', '大纲', '思路', '剧情走向', '本章梗概', 'outline'];

/** 正文开始标记行（社区预设 COT 输出约定）：独立成行的 --- 分隔线 / 【正文】 / 最终正文： 等。
 *  「正文」前允许 ≤6 字前缀（如「最终」），后必须紧跟冒号/星号/空白（前瞻）——叙述行不匹配。 */
const BODY_MARKER_RE =
  /^[ \t]*(?:[-*_]{3,}[ \t]*|【正文】|\*{0,2}(?:.{0,6})?正文\*{0,2}(?:[：：]|(?=[\s])))[ \t]*\n?/gm;

/** 元信息残章占位提示（presentable 清空后的引导文案；useGenerate 以此前缀判定自动重试） */
export const META_ONLY_PLACEHOLDER = '（本章只剩元信息，没有正文——建议 🎲 重新生成本章或切换候选。）';

/** 规划段关键词：命中其一即视作思考流段落（对照实测泄露样本归纳） */
const PLANNING_RE =
  /(让我|我需要|我应该|这意味着|剧情指引|场景回顾|性格分析|场景设定|场景设计|对话设计|写作风格|情感基调|输出格式|字数要求|回复选项|剧情摘要|思维链|构思|梳理|分析一下|正文开始|开始写正文|正式写作)/;

/** 选项行：`A. xxx` / `B、xxx`（Sudachi 多回复选项格式，≥2 行连续构成选项块） */
const OPTION_LINE_RE = /^[ \t]*[A-H][.、．][ \t]*\S/;

/** 单行是否为列表项（短横线/星号/圆点/数字编号起始） */
const LIST_ITEM_RE = /^\s*(?:[-*•·]|\d+[.、)]|[（(]\d+[)])\s+/;

/** 思考块提取产物：thinking=剥离出的思维流（无则 null）；content=去掉思考块的正文 */
export interface ThinkingSplit {
  thinking: string | null;
  content: string;
}

/**
 * 思考块提取（用户反馈⑨：思维流不再直接丢弃，捕获后折叠展示供排查生成问题）：
 * 成对 `<think>…</think>` / `<thinking>…</thinking>` 与流中断产生的未闭合尾部思考块
 * 的**内容**被收集（标签本身不保留；多个块按序以空行拼接），其余正文原样返回。
 * sanitizeOutput 复用本函数保持剥离行为——内容去哪由调用方决定（extra.rawThinking）。
 */
export function extractThinking(raw: string): ThinkingSplit {
  const parts: string[] = [];
  let content = raw.replace(
    /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi,
    (_m, inner: string) => {
      const t = inner.trim();
      if (t) parts.push(t);
      return '';
    },
  );
  const open = content.match(/<think(?:ing)?>([\s\S]*)$/i);
  if (open) {
    const t = (open[1] ?? '').trim();
    if (t) parts.push(t);
    content = content.slice(0, open.index);
  }
  return { thinking: parts.length ? parts.join('\n\n') : null, content };
}

/**
 * 内置卫生层（不依赖用户绑定正则，所有生成共用）：
 * 1. 思考块剥离：成对 `<think>/<thinking>…</…>` 与流中断产生的未闭合尾部思考块
 *    （内容经 extractThinking 可单独取出，本函数只负责从正文剥离）；
 * 2. 名字前缀剥离：模型模仿对话格式在正文开头写「名字：」；
 * 3. 嵌套标题行清理：首行章节标题之外的 `#` 标题行。
 */
export function sanitizeOutput(raw: string, speakerName?: string): string {
  let out = extractThinking(raw).content;
  if (speakerName) {
    const escaped = speakerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`^\\s*${escaped}\\s*[:：]\\s*`), '');
    // 无冒号名字前缀（「哥哥哥哥，你快看」= 前缀+对白）：只剥一层，保留对白里的称呼；
    // 后随要求为重复名或标点引号——「Seraphina 的森林」这类正文用法不误伤
    const bareNameRe = new RegExp('^' + escaped + '(?=' + escaped + "|[「」\"'，。：:—…])");
    out = out.replace(bareNameRe, '');
  }
  out = out.replace(/^\s*(?:小说家|旁白|系统)\s*[:：]\s*/, '');
  // 首行若是「正文」标记头（## 正文 / **正文** / 正文： 等）则剥离——它是 COT 边界标记而非章节标题
  out = out.replace(/^[ \t]*(?:#{1,6}|\*{0,2}|-)[ \t]*正文[ \t]*[:：]?[ \t]*\*{0,2}[ \t]*\n/, '');
  // 社区预设的标签化元信息（质检T4/对话实测）：HTML 注释 / <reply> / <S-summary> / <Aniplex> 等
  // 自定义标签泛化剥离（含未闭合分支）——安全 HTML 排版标签（em/strong 等）豁免不误伤
  const SAFE_HTML = new Set([
    'p', 'em', 'strong', 'b', 'i', 'u', 's', 'br', 'span', 'div', 'hr',
    'blockquote', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'tr', 'td', 'th', 'sub', 'sup', 'small', 'mark',
  ]);
  const isCustomTag = (tag: string): boolean => !SAFE_HTML.has(tag.toLowerCase());
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<!--[\s\S]*$/g, '');
  out = out.replace(/<([A-Za-z][\w-]*)>[\s\S]*?<\/\1>/g, (m, tag: string) => (isCustomTag(tag) ? '' : m));
  // 未闭合标签（流中断常见）：除自定义标签判定外再加两道收紧（防把大半正文当标签体误清）——
  // 标签名 ≥2 字符（单字符形态多为正文残片如「<3」「a<b>」误匹配）且剥后剩余 ≥30%，否则保留原文
  out = out.replace(/<([A-Za-z][\w-]*)>[\s\S]*$/g, (m, tag: string, offset: number) => {
    if (!isCustomTag(tag)) return m;
    if (tag.length < 2) return m;
    return offset >= out.length * 0.3 ? '' : m;
  });
  // 孤立闭合标签开头的复读片段（实测 MiniMax：模型把提示词包裹段复读为「</Aniplex>…指令…</Aniplex>」，
  // 无开标签使上面的成对/未闭合正则都不命中）：仅当文本以孤立闭合标签开头时剥到同名闭合标签；
  // 剥后正文过短则放弃（防误清正常内容）
  const orphan = out.match(/^[ \t]*<\/([A-Za-z][\w-]*)>[\s\S]*?<\/\1>/);
  if (orphan) {
    const body = out.slice(orphan[0].length).replace(/^\n+/, '');
    if (body.length >= Math.min(30, out.length * 0.2)) out = body;
  }
  // 嵌套标题清理：首行若为章节标题（parseChapterTitle 的输入）则豁免，只清理其后的标题行
  const firstBreak = out.indexOf('\n');
  const head = firstBreak === -1 ? out : out.slice(0, firstBreak);
  const rest = firstBreak === -1 ? '' : out.slice(firstBreak + 1).replace(HEADING_LINE_RE, '');
  out = rest ? `${head}\n${rest}` : head;
  return out.replace(/^\n+/, '').trim();
}

/**
 * 剥离「无标签思维流」：模型把思考过程以纯文本形式混在正文里（实测 M3+Sudachi 组合）。
 * 两层策略，均为高置信才动手：
 * 1. 标记行：取最后一个「正文：/【正文】/---」标记行之后的内容（剩余过短则放弃）；
 * 2. 段落启发：开头连续含规划关键词的段落逐段剥离（遇叙述段即停）。
 */
export function stripLooseThinking(content: string): string {
  // 1) 标记行优先（高置信）
  BODY_MARKER_RE.lastIndex = 0;
  let last: RegExpExecArray | null = null;
  for (let m = BODY_MARKER_RE.exec(content); m !== null; m = BODY_MARKER_RE.exec(content)) {
    last = m;
  }
  if (last) {
    const body = content.slice(last.index + last[0].length).replace(/^\n+/, '');
    if (body.length >= Math.min(200, content.length * 0.15)) return body;
  }
  // 2) 段落启发：开头连续规划段逐段剥离；全部都是规划段时保护性放弃（防清空）
  const paras = content.split(/\n{2,}/);
  let i = 0;
  while (i < paras.length) {
    const p = paras[i].trim();
    if (!p) {
      i += 1;
      continue;
    }
    // 超短无句读残段（如名字前缀剥离后的残留）：仅当其后紧跟规划段时才跳过（防误伤短开篇）
    if (p.length <= 6 && !/[。！？」』]$/.test(p)) {
      const next = paras[i + 1]?.trim() ?? '';
      if (next && PLANNING_RE.test(next)) {
        i += 1;
        continue;
      }
      break;
    }
    const isPlanning = PLANNING_RE.test(p) && !/[」』]"?$/.test(p);
    if (isPlanning) {
      i += 1;
      continue;
    }
    break;
  }
  if (i >= paras.length) return content; // 整篇都是思考流，保留原样
  const body = paras.slice(i).join('\n\n');
  // 剥后正文过短视为误判（保守：不动原文；chat 短对话约 20 字起，取 15）
  return i > 0 && body.trim().length >= 15 ? body : content;
}

/**
 * 剥离尾部元信息块（质检T4 实测：Sudachi 在正文后追加「A./B./C./D. 选项 + 剧情摘要」）。
 * 判定：存在 ≥2 行连续选项行、且位于全文后半段 → 从选项块起点截断到结尾。
 * （选项与随后的摘要段都是交互元信息，不属于小说正文。）
 */
export function stripTailMeta(content: string): string {
  const lines = content.split('\n');
  const tailStart = Math.floor(lines.length * 0.4);
  for (let i = tailStart; i < lines.length - 1; i += 1) {
    if (OPTION_LINE_RE.test(lines[i]) && OPTION_LINE_RE.test(lines[i + 1])) {
      return content
        .slice(0, content.indexOf(lines[i]))
        .replace(/\n+$/, '')
        .trim();
    }
  }
  return content;
}

/** 展示净化组合：内置卫生层先行（名字/标签/注释清理，让段落启发看干净的文本）
 *  → 思考流剥离 → 尾部元信息剥离（供生成时与显示时共用） */
export function presentable(
  content: string,
  speakerName?: string,
  otherNames?: string[],
): string {
  let cleaned = stripTailMeta(stripLooseThinking(sanitizeOutput(content, speakerName)));
  // chat 串名泄露：回复首行误写「其他角色名：」——须带冒号才剥（避免误伤「哥哥，你快看」式对白称呼）
  if (otherNames?.length) {
    const firstBreak = cleaned.indexOf('\n');
    const head = firstBreak === -1 ? cleaned : cleaned.slice(0, firstBreak);
    for (const n of otherNames) {
      if (!n) continue;
      const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('^[ \t]*' + esc + '[ \t]*[:：][ \t]*');
      if (re.test(head)) {
        const rest = head.replace(re, '');
        cleaned = (rest + (firstBreak === -1 ? '' : cleaned.slice(firstBreak))).trim();
        break;
      }
    }
  }
  // 剥离后一无所有 = 该章只剩元信息（选项/摘要/思考）——给出重roll引导而非空白
  if (!cleaned.trim() && content.length > 200) {
    return META_ONLY_PLACEHOLDER;
  }
  return cleaned;
}

/**
 * novel 模式展示净化组合（在 presentable 基础上多一层闲聊前导剥离）。
 * chat 模式不可用本函数：星号/括号动作在角色扮演里是合法内容，
 * 闲聊剥离（stripChatPreamble）只针对 novel 的「与 System 寒暄后写正文」泄露形态。
 */
export function presentableNovel(content: string, directive?: string): string {
  const cleaned = stripTailMeta(
    stripLooseThinking(stripChatPreamble(sanitizeOutput(content), directive)),
  );
  if (!cleaned.trim() && content.length > 200) {
    return META_ONLY_PLACEHOLDER;
  }
  return cleaned;
}

/** 单行是否像「提纲引导行」（含标记词，或以【】/**包裹的短标签且以冒号结尾） */
function isOutlineLead(line: string): boolean {
  if (OUTLINE_MARKERS.some((m) => line.includes(m))) return true;
  return /^\s*(?:【[^】]{1,12}】|\*\*[^*]{1,12}\*\*)\s*[:：]?\s*$/.test(line);
}

export interface SplitOutline {
  /** 提纲块文本（含引导行；无提纲时为 undefined） */
  outline?: string;
  /** 正文（提纲之后的全部内容；无提纲时与输入相同） */
  body: string;
}

/**
 * 从章节正文头部分离「要点提纲」块（用户需求：显示时默认折叠、朗读跳过）。
 * 判定：从首行开始连续匹配——提纲引导行 / 列表项 / 短行（≤30 字且非叙述段）；
 * 一旦遇到长叙述行即停止。整块 ≥1 行且不超过 20 行才认定为提纲，否则视为正文。
 */
export function splitOutline(content: string): SplitOutline {
  const lines = content.split('\n');
  let i = 0;
  let sawMarker = false;
  while (i < lines.length && i < 20) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    if (isOutlineLead(trimmed)) {
      sawMarker = true;
      i += 1;
      continue;
    }
    if (LIST_ITEM_RE.test(line)) {
      i += 1;
      continue;
    }
    // 短行：可能是提纲的散文条目；长叙述行：正文开始
    if (trimmed.length <= 30 && !/[。！？」』"']$/.test(trimmed)) {
      i += 1;
      continue;
    }
    break;
  }
  const rest = lines.slice(i).join('\n').replace(/^\n+/, '');
  // 必须见到明确标记词/引导行才算提纲（纯列表开头可能是正文手法），且正文确实存在
  if (sawMarker && rest.trim()) {
    return { outline: lines.slice(0, i).join('\n').trim(), body: rest };
  }
  return { body: content };
}

/** 系统指令块剥离：续写/重试指令被模型复述进正文时整块剥除（未闭合容错：剥到文尾）。
 *  标签由 generation-flow 的 buildContinueDirective/重试后缀写入（「（系统续写指令：…）」等）。 */
export function stripSystemDirectiveBlocks(content: string): string {
  let out = content.replace(/（系统(?:续写|重试)指令：[\s\S]*?（系统(?:续写|重试)指令结束）\s*/g, '');
  out = out.replace(/（系统(?:续写|重试)指令：[\s\S]*$/g, '');
  return out;
}

/** 英文句剥离（后处理安全网）：推理模型英文自我纠错/英文独白渗入正文的句子整句剥除。
 *  判定：一个「句子」（英文标点收尾）完全由英文字母/数字/空格/常用英文标点构成、
 *  含 ≥6 个英文字母且无中文字符。合法残留（AI、OK 等极短词）不剥。 */
export function stripEnglishSentences(content: string): string {
  const parts = content.split(/(?<=[.!?。！？；])(\s+)/);
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = parts[i] ?? '';
    const sep = parts[i + 1] ?? '';
    if (isLeakedEnglishSentence(sentence)) continue; // 剥句（连同其后分隔符）
    kept.push(sentence + sep);
  }
  return kept.join('');
}

/** 纯英文泄漏句判定：≥6 个英文字母、无中文字符（混中文句子保留防误杀） */
function isLeakedEnglishSentence(sentence: string): boolean {
  if (!/[A-Za-z]{2,}/.test(sentence)) return false;
  if (/[一-龥]/.test(sentence)) return false;
  return (sentence.match(/[A-Za-z]/g) ?? []).length >= 6;
}
