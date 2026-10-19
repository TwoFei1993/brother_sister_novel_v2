/**
 * 后处理管道（设计 §5.1⑥ / §5.3 COT 状态栏）
 *
 * 串联顺序：getRegexedString（ai_output 双 false 全时轨道，显示清理）→
 * parseStatusBlock（尾部 ```status 块解析 + 剥离）→ parseChapterTitle（首行标题剥离 + 兜底）。
 *
 * 正则三轨分工（§5.1②，review 修复后生效）：
 * - promptOnly 生成轨：assemble.ts 装配时对静态块/深度注入项应用（isPrompt）
 * - markdownOnly 渲染轨：渲染管道（lib/markdown.ts applyDisplayRegex）显示前应用（isMarkdown）
 * - 双 false 全时轨：本管道入库时清理（本文件职责）
 */
import type { TavernRegexScript } from '@shared/tavern';

import type { MacroEnv } from '../types';
import { getRegexedString } from './regex';

/** 首行标题行：`# 第N章 xxx` 或 `# xxx`（# 后须有内容，防误伤空行） */
const TITLE_LINE_RE = /^#[ \t]*(\S[^\n]*)/;

/** 正文中的后续标题行（模型自拟的嵌套小标题，如 `## 卷一`）——连同行尾换行一并移除 */
const HEADING_LINE_RE = /^#{1,6}[ \t]+\S.*\n?/gm;

/** 尾部状态块：```status 开头、``` 收尾（允许尾部尾随空白） */
const STATUS_BLOCK_RE = /```status[^\n]*\n([\s\S]*?)```\s*$/;

/** 数值字面量：仅普通整数/小数（防 '0x10'、'1e5' 之类被误转） */
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/**
 * 内置卫生层（不依赖用户绑定正则，所有生成共用）：
 * 1. 思考块剥离：成对 `<think>/<thinking>…</…>` 与流中断产生的未闭合尾部思考块；
 * 2. 名字前缀剥离：模型模仿对话格式在正文开头写「名字：」；
 * 3. 嵌套标题行清理：首行章节标题之外的 `#` 标题行。
 */
export function sanitizeOutput(raw: string, speakerName?: string): string {
  let out = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  out = out.replace(/<think(?:ing)?>[\s\S]*$/i, '');
  if (speakerName) {
    const escaped = speakerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`^\\s*${escaped}\\s*[:：]\\s*`), '');
  }
  out = out.replace(/^\s*(?:小说家|旁白|系统)\s*[:：]\s*/, '');
  // 首行若是「正文」标记头（## 正文 / **正文** / 正文： 等）则剥离——它是 COT 边界标记而非章节标题
  out = out.replace(/^[ \t]*(?:#{1,6}|\*{0,2}|-)[ \t]*正文[ \t]*[:：]?[ \t]*\*{0,2}[ \t]*\n/, '');
  // 社区预设的标签化元信息（质检T4 实测）：HTML 注释提示 / <reply> 选项块 / <S-summary> 摘要块
  // 各含未闭合分支（生成流在标签中间被截断的场景）
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<!--[\s\S]*$/g, '');
  out = out.replace(/<reply>[\s\S]*?<\/reply>/gi, '');
  out = out.replace(/<reply>[\s\S]*$/i, '');
  out = out.replace(/<S-\w+>[\s\S]*?<\/S-\w+>/g, '');
  out = out.replace(/<S-\w+>[\s\S]*$/i, '');
  // 嵌套标题清理：首行若为章节标题（parseChapterTitle 的输入）则豁免，只清理其后的标题行
  const firstBreak = out.indexOf('\n');
  const head = firstBreak === -1 ? out : out.slice(0, firstBreak);
  const rest = firstBreak === -1 ? '' : out.slice(firstBreak + 1).replace(HEADING_LINE_RE, '');
  out = rest ? `${head}\n${rest}` : head;
  return out.replace(/^\n+/, '').trim();
}

export interface ParsedChapter {
  title: string;
  content: string;
}

export interface ParsedStatus {
  statusSnapshot?: Record<string, string | number>;
  content: string;
}

/**
 * 章节标题解析：
 * 1. 首行 `# 第N章 xxx` / `# xxx` → 剥离该行，剩余为正文；
 * 2. 无标记 → directive 首句截 20 字兜底；
 * 3. 再兜底 `第{chapterIndex + 1}章`。
 */
export function parseChapterTitle(
  raw: string,
  directive?: string,
  chapterIndex = 0,
): ParsedChapter {
  const probe = raw.trimStart();
  const matched = TITLE_LINE_RE.exec(probe);
  if (matched) {
    return {
      title: matched[1].trim(),
      content: probe.slice(matched[0].length).replace(/^\s+/, ''),
    };
  }

  if (directive && directive.trim()) {
    // 首句：按句末标点/换行切分取第一段，截 20 字
    const firstSentence = directive.split(/(?<=[。！？!?\n])/)[0] ?? directive;
    return { title: firstSentence.trim().slice(0, 20), content: raw };
  }
  return { title: `第${chapterIndex + 1}章`, content: raw };
}

/**
 * COT 状态块解析：尾部 ```status\nkey: value``` 代码块 →
 * statusSnapshot（值尝试转 number，非数值保留字符串）+ 从显示内容中剥离。
 * 无匹配块时原样返回（statusSnapshot 为 undefined）。
 */
export function parseStatusBlock(raw: string): ParsedStatus {
  const matched = STATUS_BLOCK_RE.exec(raw);
  if (!matched) return { content: raw };

  const snapshot: Record<string, string | number> = {};
  for (const line of matched[1].split('\n')) {
    const sep = line.indexOf(':');
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    const valueText = line.slice(sep + 1).trim();
    if (!key || !valueText) continue;
    snapshot[key] = NUMERIC_RE.test(valueText) ? Number(valueText) : valueText;
  }

  const hasEntries = Object.keys(snapshot).length > 0;
  return {
    statusSnapshot: hasEntries ? snapshot : undefined,
    content: raw.slice(0, matched.index).trimEnd(),
  };
}

export interface PostprocessOpts {
  /** novel 模式当前指令（标题兜底用） */
  directive?: string;
  /** 章节下标（0 起，兜底 `第N章` 用） */
  chapterIndex?: number;
  /** 正则脚本（仅双 false 全时轨参与显示清理） */
  regexScripts?: TavernRegexScript[];
  /** 宏环境（脚本 findRegex/replaceString 的宏注入） */
  macroEnv?: MacroEnv;
  /** 发言者名（chat 模式为激活角色；用于内置卫生层的名字前缀剥离） */
  speakerName?: string;
}

/** 提纲/要点的标记词（标题行或引导行含其一即判定为提纲块开始） */
const OUTLINE_MARKERS = ['要点', '提纲', '大纲', '思路', '剧情走向', '本章梗概', 'outline'];

/** 正文开始标记行（社区预设 COT 输出约定）：独立成行的 --- 分隔线 / 【正文】 / 最终正文： 等。
 *  「正文」前允许 ≤6 字前缀（如「最终」），后必须紧跟冒号/星号/空白（前瞻）——叙述行不匹配。 */
const BODY_MARKER_RE =
  /^[ \t]*(?:[-*_]{3,}[ \t]*|【正文】|\*{0,2}(?:.{0,6})?正文\*{0,2}(?:[：：]|(?=[\s])))[ \t]*\n?/gm;

/** 规划段关键词：命中其一即视作思考流段落（对照实测泄露样本归纳） */
const PLANNING_RE =
  /(让我|我需要|我应该|这意味着|剧情指引|场景回顾|性格分析|场景设定|场景设计|对话设计|写作风格|情感基调|输出格式|字数要求|回复选项|剧情摘要|思维链|构思|梳理|分析一下|正文开始|开始写正文|正式写作)/;

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
    const isPlanning = PLANNING_RE.test(p) && !/[」』]"?$/.test(p);
    if (isPlanning) {
      i += 1;
      continue;
    }
    break;
  }
  if (i >= paras.length) return content; // 整篇都是思考流，保留原样
  const body = paras.slice(i).join('\n\n');
  // 剥后正文过短视为误判（保守：不动原文）
  return i > 0 && body.trim().length >= 50 ? body : content;
}

/** 展示净化组合：思考流剥离 + 尾部元信息剥离 + 内置卫生层（供生成时与显示时共用） */
export function presentable(content: string, speakerName?: string): string {
  const cleaned = sanitizeOutput(stripTailMeta(stripLooseThinking(content)), speakerName);
  // 剥离后一无所有 = 该章只剩元信息（选项/摘要/思考）——给出重roll引导而非空白
  if (!cleaned.trim() && content.length > 200) {
    return '（本章只剩元信息，没有正文——建议 🎲 重新生成本章或切换候选。）';
  }
  return cleaned;
}

/** 选项行：`A. xxx` / `B、xxx`（Sudachi 多回复选项格式，≥2 行连续构成选项块） */
const OPTION_LINE_RE = /^[ \t]*[A-H][.、．][ \t]*\S/;

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

/** 单行是否为列表项（短横线/星号/圆点/数字编号起始） */
const LIST_ITEM_RE = /^\s*(?:[-*•·]|\d+[.、)]|[（(]\d+[)])\s+/;

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

export interface PostprocessResult {
  content: string;
  title: string;
  statusSnapshot?: Record<string, string | number>;
}

/**
 * 后处理总入口（纯函数）：
 * 内置卫生层（思考块/名字前缀/嵌套标题）→ 正则显示清理 → 状态块解析剥离 → 章节标题解析。
 */
export function postprocessMessage(raw: string, opts: PostprocessOpts = {}): PostprocessResult {
  // 内置卫生层：与用户正则无关，所有生成共用（质量测试 T3/T4 发现的思考块与名字前缀残留）
  const hygiened = sanitizeOutput(raw, opts.speakerName);
  // 显示轨清理：ai_output + 双 false 轨道（promptOnly/markdownOnly 脚本均不参与）
  const cleaned = getRegexedString(
    hygiened,
    'ai_output',
    { isMarkdown: false, isPrompt: false, macroEnv: opts.macroEnv },
    opts.regexScripts ?? [],
  );

  const { statusSnapshot, content: withoutStatus } = parseStatusBlock(cleaned);
  const { title, content } = parseChapterTitle(
    withoutStatus,
    opts.directive,
    opts.chapterIndex ?? 0,
  );
  return { content, title, statusSnapshot };
}
