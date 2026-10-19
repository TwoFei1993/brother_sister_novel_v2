/**
 * 后处理管道（设计 §5.1⑥ / §5.3 COT 状态栏）
 *
 * 本文件保留总入口与解析层：parseChapterTitle（首行标题剥离 + 兜底）、
 * parseStatusBlock（尾部 ```status 块解析 + 剥离）、postprocessMessage（总入口）。
 * 纯文本净化函数（sanitizeOutput/stripLooseThinking/stripTailMeta/presentable/splitOutline）
 * 已迁至 ./sanitize，此处 re-export 保持既有导入路径兼容（调用方零改动）。
 *
 * 正则三轨分工（§5.1②，review 修复后生效）：
 * - promptOnly 生成轨：assemble.ts 装配时对静态块/深度注入项应用（isPrompt）
 * - markdownOnly 渲染轨：渲染管道（lib/markdown.ts applyDisplayRegex）显示前应用（isMarkdown）
 * - 双 false 全时轨：本管道入库时清理（本文件职责）
 */
import type { TavernRegexScript } from '@shared/tavern';

import type { MacroEnv } from '../types';
import { stripChatPreamble } from './novel/chat-preamble';
import { getRegexedString } from './regex';
import { sanitizeOutput } from './sanitize';

// ---- 净化器公开面（迁移兼容 re-export：全部调用方仍从本模块导入）----
export {
  presentable,
  presentableNovel,
  splitOutline,
  sanitizeOutput,
  stripLooseThinking,
  stripTailMeta,
  META_ONLY_PLACEHOLDER,
} from './sanitize';
export { stripChatPreamble, isChatterLine } from './novel/chat-preamble';
export type { SplitOutline } from './sanitize';

/** 首行标题行：`# 第N章 xxx` 或 `# xxx`（# 后须有内容，防误伤空行） */
const TITLE_LINE_RE = /^#[ \t]*(\S[^\n]*)/;

/** 尾部状态块：```status 开头、``` 收尾（允许尾部尾随空白） */
const STATUS_BLOCK_RE = /```status[^\n]*\n([\s\S]*?)```\s*$/;

/** 数值字面量：仅普通整数/小数（防 '0x10'、'1e5' 之类被误转） */
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

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
  /** novel 模式当前指令（标题兜底 + 闲聊回显剥离用） */
  directive?: string;
  /** 章节下标（0 起，兜底 `第N章` 用） */
  chapterIndex?: number;
  /** 正则脚本（仅双 false 全时轨参与显示清理） */
  regexScripts?: TavernRegexScript[];
  /** 宏环境（脚本 findRegex/replaceString 的宏注入） */
  macroEnv?: MacroEnv;
  /** 发言者名（chat 模式为激活角色；用于内置卫生层的名字前缀剥离） */
  speakerName?: string;
  /** novel 入库轨开启闲聊前导剥离（对 System 寒暄/思考结束标记/指令回显等，仅 novel 生成路径置 true） */
  stripChatter?: boolean;
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
  const sanitized = sanitizeOutput(raw, opts.speakerName);
  // novel 入库轨闲聊前导剥离（对 System 寒暄/思考结束标记/指令回显等，见 chat-preamble.ts）
  const hygiened = opts.stripChatter ? stripChatPreamble(sanitized, opts.directive) : sanitized;
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
