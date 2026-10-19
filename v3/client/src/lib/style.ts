/**
 * 文风复刻（用户粘贴参考文字 → LLM 提炼文风画像 → 存作品 settings.styleGuide）
 *
 * - buildStyleAnalysisPrompt：分析提示词（明确「只提炼写法，不复述内容」硬约束）
 * - analyzeStyle：POST /api/llm/generate 非流式调用（仿 hooks/context-plan summarizeDropped）
 * - cleanStyleProfile：剥 LLM 输出可能混入的代码栅栏 / 整段引号包裹 / 前言客套行
 * 画像只描述写法（人称视角/句式节奏/对话描写占比/词汇色彩/基调/修辞/禁忌），
 * 不含情节与人名；置空 styleGuide 即回到默认文风。
 */
import type { LlmPrefs } from '../stores/settings';

import { apiFetch } from '../api/client';

/** 参考文字建议最小字数（低于此值 UI 提示「过短」，不硬拦截） */
export const MIN_SAMPLE_CHARS = 200;

/** 画像长度上限（提示词约束：≤300 字紧凑中文条目） */
export const STYLE_GUIDE_MAX_CHARS = 300;

/** 参考文字在 user 提示词中的定界符（隔离样本文本，防提示注入式混淆） */
const SAMPLE_DELIM = '<<<';

/**
 * 构造文风分析提示词。
 * 硬约束写死在 system 与 user 双处：只提炼写法、不复述内容、不提情节与人名。
 */
export function buildStyleAnalysisPrompt(sample: string): { system: string; user: string } {
  const system =
    '你是资深中文小说编辑，擅长从文字样本中提炼写作风格。' +
    '你只描述「怎么写」（文风写法），绝不复述「写了什么」（情节内容）。';
  const user = [
    '请分析下面这段参考文字的文风，产出一份可直接交给写作 AI 执行的文风指令。',
    '',
    '硬性要求：',
    '- 只提炼写法，不复述内容：不得提及原文的情节、人物名与具体事件',
    '- 输出为紧凑的中文条目（总长不超过 300 字），逐条覆盖：',
    '  1. 叙事人称与视角',
    '  2. 句式节奏（长短句、排比等）',
    '  3. 对话与描写占比',
    '  4. 词汇色彩（书面 / 口语 / 古风 / 现代）',
    '  5. 情绪基调',
    '  6. 修辞偏好',
    '  7. 禁忌（如：不用感叹号、不写大段心理独白）',
    '- 直接输出条目本身，不要任何前言、解释或结语',
    '',
    `参考文字：`,
    SAMPLE_DELIM,
    sample,
    SAMPLE_DELIM,
  ].join('\n');
  return { system, user };
}

/** 成对引号（剥整段包裹用）：闭引号 → 对应开引号 */
const QUOTE_CLOSE_TO_OPEN: Record<string, string> = {
  '"': '"',
  '”': '“',
  '」': '「',
  '』': '『',
};

/** 剥整段引号包裹（首字符为开引号且末字符为配对闭引号才剥，循环剥多层） */
function stripQuoteWrap(text: string): string {
  let t = text;
  for (;;) {
    if (t.length < 2) break;
    const expectedOpen = QUOTE_CLOSE_TO_OPEN[t[t.length - 1]];
    if (!expectedOpen || t[0] !== expectedOpen) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

/** 剥 markdown 代码栅栏（``` 或 ```lang 包裹） */
function stripCodeFence(text: string): string {
  const m = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?\s*```$/.exec(text);
  return m ? m[1].trim() : text;
}

/** 前言行：客套开头（好的/当然…） */
const COURTESY_LINE = /^(?:好的|当然|明白|收到|没问题|OK)[，,！!。.\s]/;
/** 前言行：引入语收尾（以下是…：/文风画像：等） */
const INTRO_LINE = /(?:以下是|下面是|这是|此为|文风画像|文风分析|文风指令|分析结果)[^：:]{0,12}[:：]\s*$/;
/** 尾行：多余收尾客套 */
const TRAILER_LINE = /^(?:希望|以上就是|如需|若需要)/;

/** 剥头部前言行与尾部客套行（循环，容忍空行夹杂） */
function stripPreamble(text: string): string {
  const lines = text.split('\n');
  while (lines.length > 0) {
    const head = lines[0].trim();
    if (head === '' || COURTESY_LINE.test(head) || INTRO_LINE.test(head)) {
      lines.shift();
      continue;
    }
    break;
  }
  while (lines.length > 0) {
    const tail = lines[lines.length - 1].trim();
    if (tail === '' || TRAILER_LINE.test(tail)) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join('\n').trim();
}

/** 画像文本清洗：代码栅栏 → 整段引号包裹 → 前言/客套行 → trim */
export function cleanStyleProfile(raw: string): string {
  return stripPreamble(stripQuoteWrap(stripCodeFence(raw.trim())));
}

/**
 * 分析文风：调 LLM 提炼画像（非流式，走作品当前 llmPrefs 通道）。
 * 空参考文字直接拒绝；返回空画像视为失败（不静默返回空串）。
 */
export async function analyzeStyle(prefs: LlmPrefs, sample: string): Promise<string> {
  const trimmed = sample.trim();
  if (!trimmed) throw new Error('请先粘贴一段参考文字');
  const { system, user } = buildStyleAnalysisPrompt(trimmed);
  const out = (await apiFetch<{ text?: string }>('/api/llm/generate', {
    method: 'POST',
    body: JSON.stringify({
      source: prefs.source,
      model: prefs.model || undefined,
      stream: false,
      params: { max_tokens: 700, temperature: 0.3 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  }));
  const text = cleanStyleProfile(out.text ?? '');
  if (!text) throw new Error('文风分析返回为空，请重试');
  return text;
}
