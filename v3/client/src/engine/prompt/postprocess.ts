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
