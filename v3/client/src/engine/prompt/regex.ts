/**
 * 正则双轨引擎（设计 §5.1②）
 *
 * 语义锚点：酒馆 public/scripts/extensions/regex/engine.js
 * - getRegexedString（:334）：时点过滤三分支——(markdownOnly&&isMarkdown) ||
 *   (promptOnly&&isPrompt) || (双 false 且非 markdown 非 prompt)；isEdit 时要求
 *   runOnEdit；深度过滤仅在显式提供 depth 时参与（:362-372）。
 * - runRegexScript（:391）：disabled/空 findRegex 跳过；substituteRegex RAW=1
 *   宏注入 findRegex 原文、ESCAPED=2 注入并转义元字符；{{match}}→$0（:421）；
 *   $N/$<name> 手工展开且逐捕获组剥离 trimStrings（:422-441）；替换结果末尾
 *   再过一次 substituteParams（:444）。
 * - placement 数值枚举（:281）：USER_INPUT=1、AI_OUTPUT=2、SLASH_COMMAND=3、
 *   WORLD_INFO=5、REASONING=6（MD_DISPLAY=0 已废弃，不承接）。
 *
 * 双轨含义：同一脚本可在"生成轨"（isPrompt，注入模型上下文前）与
 * "渲染轨"（isMarkdown，显示消息前）分别应用，脚本用 markdownOnly/promptOnly
 * 声明作用轨；两者皆 false 表示全时（除渲染轨——源历史应已提前改好，见 ：353 注释）。
 */
import type { TavernRegexScript } from '@shared/tavern';

import { substituteParams } from './macros';
import type { MacroEnv } from '../types';

/** 应用位置（字符串名），对应酒馆 regex_placement 数值 1/2/3/5/6 */
export type RegexPlacement =
  | 'user_input'
  | 'ai_output'
  | 'slash_command'
  | 'world_info'
  | 'reasoning';

/** placement 字符串 → 酒馆数值枚举（engine.js:281 regex_placement） */
const PLACEMENT_CODES: Record<RegexPlacement, number> = {
  user_input: 1,
  ai_output: 2,
  slash_command: 3,
  world_info: 5,
  reasoning: 6,
};

/** 脚本 placement 数组是否覆盖该位置（酒馆 script.placement.includes(placement)） */
export function placementMatches(scriptPlacement: number[], placement: RegexPlacement): boolean {
  return scriptPlacement.includes(PLACEMENT_CODES[placement]);
}

/** runRegexScript 运行上下文；isMarkdown/isPrompt/depth 供前置过滤，macroEnv 供宏注入 */
export interface RegexRunContext {
  /** 渲染轨：消息显示前 */
  isMarkdown: boolean;
  /** 生成轨：注入模型上下文前 */
  isPrompt: boolean;
  /** 编辑场景（配合 script.runOnEdit 过滤，过滤在 getRegexedString） */
  isEdit?: boolean;
  /** 当前消息深度（0=最新）；未提供时不做深度过滤（酒馆 :362 语义） */
  depth?: number;
  /** 宏环境；缺省时 findRegex 宏不展开（等效 substituteRegex=NONE） */
  macroEnv?: MacroEnv;
}

/** getRegexedString 选项：透传给每个脚本的前置过滤 */
export interface RegexStringOpts {
  isMarkdown?: boolean;
  isPrompt?: boolean;
  isEdit?: boolean;
  depth?: number;
  macroEnv?: MacroEnv;
}

/** substitute_find_regex（engine.js:298）：NONE=0、RAW=1、ESCAPED=2 */
const SUBSTITUTE_NONE = 0;
const SUBSTITUTE_RAW = 1;
const SUBSTITUTE_ESCAPED = 2;

/**
 * ESCAPED 模式：宏展开值中的正则元字符转义为字面（酒馆 sanitizeRegexMacro，:304）。
 * 差异说明：酒馆在 substituteParamsExtended 内部对展开值后处理（支持嵌套宏）；
 * 我们用非嵌套宏扫描近似——简单 {{...}} 逐个展开+转义，嵌套宏退化为 RAW 行为。
 */
function sanitizeRegexMacro(x: string): string {
  return x.replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/g, (s) => {
    switch (s) {
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      case '\v':
        return '\\v';
      case '\f':
        return '\\f';
      case '\0':
        return '\\0';
      default:
        return `\\${s}`;
    }
  });
}

/**
 * findRegex 宏注入（酒馆 getRegexString，:397-409）：
 * RAW=1 展开宏（宏值按正则语法参与编译）；ESCAPED=2 展开并转义（宏值按字面匹配）；
 * NONE=0 / 未知值 / 无 macroEnv 时原样返回。
 */
function substituteFindRegex(
  findRegex: string,
  substituteRegex: number | null | undefined,
  env: MacroEnv | undefined,
): string {
  if (!env) return findRegex;
  switch (Number(substituteRegex)) {
    case SUBSTITUTE_RAW:
      return substituteParams(findRegex, env);
    case SUBSTITUTE_ESCAPED:
      return findRegex.replace(/\{\{[^{}]*\}\}/g, (m) => sanitizeRegexMacro(substituteParams(m, env)));
    case SUBSTITUTE_NONE:
    default:
      return findRegex;
  }
}

/** 逐个剥离 trim 串（酒馆 filterString，:457）；trim 串自身支持宏 */
function filterTrimStrings(value: string, trimStrings: string[], env: MacroEnv | undefined): string {
  let out = value;
  for (const trimString of trimStrings) {
    const sub = env ? substituteParams(trimString, env) : trimString;
    if (sub) out = out.replaceAll(sub, '');
  }
  return out;
}

/**
 * 执行单个脚本（酒馆 runRegexScript，:391）：
 * 前置过滤（disabled / markdownOnly / promptOnly / depth）不过则原样返回；
 * 命中则替换并处理捕获组引用、trim 剥离、末尾宏二次替换。
 */
export function runRegexScript(raw: string, script: TavernRegexScript, ctx: RegexRunContext): string {
  // 前置过滤（酒馆 :393 disabled / :350-354 时点 / :362-372 深度）
  if (!raw || !script?.findRegex) return raw;
  if (script.disabled) return raw;
  if (script.markdownOnly && !ctx.isMarkdown) return raw;
  if (script.promptOnly && !ctx.isPrompt) return raw;
  if (typeof ctx.depth === 'number') {
    const { minDepth, maxDepth } = script;
    // -1 表示不限（酒馆条件 minDepth >= -1 && depth < minDepth 在 -1 时恒假，等效不限）
    if (minDepth !== null && minDepth !== undefined && minDepth >= 0 && ctx.depth < minDepth) {
      return raw;
    }
    if (maxDepth !== null && maxDepth !== undefined && maxDepth >= 0 && ctx.depth > maxDepth) {
      return raw;
    }
  }

  const env = ctx.macroEnv;
  const regexString = substituteFindRegex(script.findRegex, script.substituteRegex, env);
  // 全局匹配（酒馆 RegexProvider 缓存语义；纯函数场景直接构造，非法正则兜底原样）
  let find: RegExp;
  try {
    find = new RegExp(regexString, 'g');
  } catch {
    return raw;
  }

  const trimStrings = script.trimStrings ?? [];
  const baseReplace = script.replaceString ?? '';
  return raw.replace(find, (...args: unknown[]) => {
    const groups = args[args.length - 1] as Record<string, string> | undefined;
    // {{match}} → $0 整体匹配（大小写不敏感，酒馆 :421 /{{match}}/gi）
    let replaceString = baseReplace.replace(/\{\{match\}\}/gi, '$0');
    // $N / $<name> 手工展开：便于逐捕获组剥离 trimStrings（原生 replace 做不到，酒馆 :422-441）
    replaceString = replaceString.replace(/\$(\d+)|\$<([^>]+)>/g, (_s, num, groupName) => {
      let picked: string | undefined;
      if (num !== undefined) picked = args[Number(num)] as string | undefined;
      else if (groupName !== undefined) picked = groups?.[groupName];
      // 未参与匹配的组消解为空串（酒馆 :433 !match → ""）
      if (!picked) return '';
      return filterTrimStrings(picked, trimStrings, env);
    });
    // 替换结果再过一次宏（酒馆 :444），使 replaceString 可写 {{user}}/{{getvar}} 等
    return env ? substituteParams(replaceString, env) : replaceString;
  });
}

/**
 * 对文本按序应用全部脚本（酒馆 getRegexedString，:334）：
 * 时点三分支 + isEdit 要求 runOnEdit + placement 匹配，逐个 runRegexScript；
 * 前一脚本输出作为后一脚本输入（链式）。
 */
export function getRegexedString(
  raw: string,
  placement: RegexPlacement,
  opts: RegexStringOpts,
  scripts: TavernRegexScript[],
): string {
  if (!raw) return raw;
  const isMarkdown = opts.isMarkdown ?? false;
  const isPrompt = opts.isPrompt ?? false;
  let finalString = raw;
  for (const script of scripts) {
    // 时点三分支（酒馆 :350-354）；双 false 脚本在渲染轨跳过，避免对已改写的历史二次替换
    const applies =
      (script.markdownOnly && isMarkdown) ||
      (script.promptOnly && isPrompt) ||
      (!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt);
    if (!applies) continue;
    // 编辑场景默认不跑，脚本声明 runOnEdit 才参与（酒馆 :356）
    if (opts.isEdit && !script.runOnEdit) continue;
    if (!placementMatches(script.placement ?? [], placement)) continue;
    finalString = runRegexScript(finalString, script, { ...opts, isMarkdown, isPrompt });
  }
  return finalString;
}
