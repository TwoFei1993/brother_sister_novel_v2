/**
 * 真实生成质量测试基础设施 — 环境/组装/入库（quality.slow.test.ts 专用，默认跳过不进 CI）
 *
 * 不走 client/src/api（其 fetch 为同源相对路径）——直接以 Node fetch 调
 * http://localhost:3001 绝对地址：登录拿 cookie → 作品 CRUD → SSE 生成 → 幂等入库。
 * 提示词组装复用 engine 纯函数（scanWorldInfo + assemblePrompt + postprocessMessage），
 * 语义对齐 hooks/generation-pipeline.ts 的 scanAndAssemble（同一扫描池 + EMPTY_PRESET 兜底）。
 * 断言记录器与报告见 quality-assert.ts（自本模块单向导入 SseUsage/MODEL）。
 */
import type { Message, MessageExtra } from '@shared/message';
import { defaultNovelSettings, type NovelSettings } from '@shared/work';
import type { TavernCardV2, TavernPreset, TavernRegexScript } from '@shared/tavern';
import type { WorldbookAsset } from '@shared/worldbook';

import type { MacroEnv } from '../types';
import { assemblePrompt } from '../prompt/assemble';
import { postprocessMessage, parseStatusBlock } from '../prompt/postprocess';
import { getRegexedString } from '../prompt/regex';
import { scanWorldInfo, type ScanSettings } from '../worldbook';

export const BASE = 'http://localhost:3001';
export const SOURCE = 'claude' as const;
export const MODEL = 'MiniMax-M3';
export const BUDGET_TOKENS = 60000;
/** 每场景 test timeout（5 章 × 真实生成，留足余量） */
export const SCENE_TIMEOUT = 900_000;
/** 真实生成采样参数：max_tokens 4096 保 600 字以上章节；温度偏中文网文叙事 */
export const GEN_PARAMS = { max_tokens: 4096, temperature: 0.8 };

/** 世界书扫描全局设置（与 generation-pipeline SCAN_SETTINGS 同参） */
const SCAN_SETTINGS: ScanSettings = {
  scanDepth: 10, caseSensitive: false, matchWholeWords: false,
  recursive: true, maxRecursionSteps: 10,
};

// ---------- HTTP 基础 ----------

let cookie = '';

/** 登录拿会话 cookie（HttpOnly token；后续请求全部携带） */
export async function login(): Promise<void> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'dev123' }),
  });
  if (!res.ok) throw new Error(`登录失败 ${res.status}: ${await res.text()}`);
  const raw = res.headers.getSetCookie?.() ?? [];
  cookie = raw.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('登录响应未携带 set-cookie');
}

/** 带 cookie 的 JSON 请求（非 2xx 抛错并附响应片段） */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Cookie: cookie,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

// ---------- SSE 生成流（帧协议：data: {"text"|"error"|"raw"} + [DONE]） ----------

export interface SseUsage {
  /** 上游实测（Anthropic 兼容帧 message_start/message_delta）；抓不到为 0 */
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult {
  text: string;
  usage: SseUsage;
  ms: number;
}

/** 流式生成：手写 SSE 帧解析（text 累加 / error 抛错 / [DONE] 收束，断流抛 streamIncomplete） */
export async function generateStream(messages: Array<{ role: 'system' | 'user' | 'assistant'; name?: string; content: string }>): Promise<GenerateResult> {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/llm/generate`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: SOURCE, model: MODEL, messages, params: GEN_PARAMS, stream: true }),
  });
  if (!res.ok) throw new Error(`generate ${res.status}: ${(await res.text()).slice(0, 300)}`);
  if (!res.body) throw new Error('generate 响应无 body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let seenDone = false;
  const usage: SseUsage = { inputTokens: 0, outputTokens: 0 };

  const handleFrame = (frame: string): void => {
    const line = frame.split('\n').find((l) => l.startsWith('data: '));
    if (!line) return;
    const payload = line.slice(6);
    if (payload === '[DONE]') {
      seenDone = true;
      return;
    }
    const obj = JSON.parse(payload) as { text?: unknown; error?: { code?: unknown; message?: unknown }; raw?: unknown };
    if (obj.error) {
      throw new Error(`SSE error ${String(obj.error.code)}: ${String(obj.error.message)}`);
    }
    if (typeof obj.text === 'string') text += obj.text;
    // 上游原始帧抽 usage（Anthropic 兼容通道：message_start.input / message_delta.output）
    const raw = obj.raw as { type?: string; message?: { usage?: { input_tokens?: number } }; usage?: { output_tokens?: number } } | undefined;
    if (raw?.type === 'message_start') usage.inputTokens += raw.message?.usage?.input_tokens ?? 0;
    if (raw?.type === 'message_delta') usage.outputTokens += raw.usage?.output_tokens ?? 0;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      handleFrame(frame);
    }
  }
  if (!seenDone) throw new Error('streamIncomplete：SSE 结束但未见 [DONE]');
  return { text, usage, ms: Date.now() - started };
}

// ---------- 组装（scan + assemble，语义对齐 scanAndAssemble） ----------

export interface AssembleAssets {
  preset: TavernPreset | null;
  cards: TavernCardV2[];
  worldbooks: WorldbookAsset[];
  regexScripts: TavernRegexScript[];
}

export type Tail = { kind: 'directive'; text: string } | { kind: 'userMessage'; text: string };

/** no-op 变量读写（质量测试不使用 {{setvar}} 流程，仅满足 MacroEnv 形参） */
const noopVars = { getVar: () => undefined, setVar: () => undefined, scope: 'work' as const };

/** novel 宏环境：user=「作者」、char=主卡名（对齐 buildMacroEnv） */
export function novelMacroEnv(primaryCharName: string | undefined): MacroEnv {
  return { user: '作者', char: primaryCharName || '小说家', ...noopVars };
}

/** chat 宏环境：user=「用户」、char=激活角色（对齐 buildChatMacroEnv） */
export function chatMacroEnv(speakerName: string): MacroEnv {
  return { user: '用户', char: speakerName, ...noopVars };
}

export interface AssembleOutput {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; name?: string; content: string }>;
  promptTokens: number;
  activatedIds: string[];
}

/** 世界书扫描 + 总装（chatTexts=本轮注入文本+历史倒序，与 pipeline 一致；budget 内单次组装不循环截断） */
export function assemble(args: {
  assets: AssembleAssets;
  history: Message[];
  tail: Tail;
  macroEnv: MacroEnv;
  settings?: NovelSettings;
}): AssembleOutput {
  const { assets, history, tail, macroEnv } = args;
  const scan = scanWorldInfo({
    books: assets.worldbooks,
    chatTexts: [tail.text, ...[...history].reverse().map((m) => m.content)].filter(Boolean),
    settings: SCAN_SETTINGS,
    macroEnv,
  });
  const result = assemblePrompt({
    preset: assets.preset ?? EMPTY_PRESET_LIKE,
    cards: assets.cards,
    allowCardOverride: true,
    worldbookScan: scan,
    workSettings: args.settings ?? defaultNovelSettings,
    history,
    ...(tail.kind === 'directive' ? { directive: tail.text } : { userMessage: tail.text }),
    macroEnv,
    budgetTokens: BUDGET_TOKENS,
    regexScripts: assets.regexScripts,
  });
  return { messages: result.messages, promptTokens: result.usage.promptTokens, activatedIds: result.activatedIds };
}

/**
 * 预设缺失兜底骨架（与 hooks/context-plan EMPTY_PRESET 同构的内联副本：
 * 不从该模块导入以避免牵入 api/store 依赖链——此处仅取 8 marker 顺序常量）。
 */
const EMPTY_PRESET_LIKE: TavernPreset = {
  prompts: [],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'charDescription', enabled: true }, { identifier: 'charPersonality', enabled: true },
        { identifier: 'scenario', enabled: true },
        { identifier: 'worldInfoAfter', enabled: true },
        { identifier: 'chatHistory', enabled: true }, { identifier: 'jailbreak', enabled: true },
      ],
    },
  ],
};

// ---------- 后处理与消息构造 ----------

/** novel 后处理（对齐 finalizeGeneration）：全时轨正则 → 状态块 → 标题解析（postprocessMessage 内含双 false 轨清理） */
export function postprocessNovel(raw: string, directive: string, chapterIndex: number, regexScripts: TavernRegexScript[], env: MacroEnv) {
  return postprocessMessage(raw, { directive: directive || undefined, chapterIndex, regexScripts, macroEnv: env });
}

/** 渲染轨模拟（阅读视图）：markdownOnly 脚本在入库正文上的应用效果 */
export function applyDisplayTrack(content: string, regexScripts: TavernRegexScript[]): string {
  return getRegexedString(content, 'ai_output', { isMarkdown: true }, regexScripts);
}

/** chat 后处理（对齐 finalizeChatGeneration）：全时轨正则 + 状态块剥离，跳过标题解析（chat 首行「#」是正文） */
export function postprocessChat(raw: string, regexScripts: TavernRegexScript[], env: MacroEnv): { content: string; statusSnapshot?: Record<string, string | number> } {
  const cleaned = getRegexedString(raw, 'ai_output', { isMarkdown: false, isPrompt: false, macroEnv: env }, regexScripts);
  return parseStatusBlock(cleaned);
}

/** 作品创建（带四类绑定） */
export async function createWork(input: {
  title: string;
  mode: 'novel' | 'chat';
  characterIds?: string[];
  worldbookIds?: string[];
  presetId?: string;
  regexScriptIds?: string[];
}): Promise<{ id: string }> {
  return api('/api/works', {
    method: 'POST',
    body: JSON.stringify({
      title: input.title, mode: input.mode, genre: 'xuanhuan',
      characterIds: input.characterIds ?? [], worldbookIds: input.worldbookIds ?? [],
      presetId: input.presetId ?? '', regexScriptIds: input.regexScriptIds ?? [],
    }),
  });
}

/** Message 公共骨架（id/时间戳/swipes 骨架；三个 build 复用） */
function baseMessage(role: 'user' | 'assistant', name: string, content: string, extra: MessageExtra): Message {
  return {
    id: crypto.randomUUID(),
    role,
    name,
    content,
    createdAt: Date.now(),
    swipes: [content],
    swipeId: 0,
    extra,
  };
}

/** assistant 生成类消息的 extra（model/token/generationMs + 可选激活条目） */
function genExtra(input: { promptTokens: number; generationMs: number; activatedEntries?: string[] }): MessageExtra {
  return {
    model: MODEL,
    tokenCount: input.promptTokens,
    generationMs: input.generationMs,
    ...(input.activatedEntries?.length ? { activatedEntries: input.activatedEntries } : {}),
  };
}

/** novel 章节消息（对齐 buildChapterMessage §4.2） */
export function buildChapterMessage(input: {
  content: string;
  title: string;
  chapterIndex: number;
  directive?: string;
  promptTokens: number;
  generationMs: number;
  activatedEntries?: string[];
}): Message {
  return {
    ...baseMessage('assistant', '小说家', input.content, genExtra(input)),
    chapter: { index: input.chapterIndex, title: input.title },
    ...(input.directive ? { directive: input.directive } : {}),
  };
}

/** chat 用户消息（对齐 buildUserTurn） */
export function buildUserTurn(text: string): Message {
  return baseMessage('user', '用户', text, {});
}

/** chat AI 回复（对齐 buildAssistantTurn：name=激活角色，无章节语义） */
export function buildAssistantTurn(input: { content: string; speakerName: string; promptTokens: number; generationMs: number; activatedEntries?: string[] }): Message {
  return baseMessage('assistant', input.speakerName, input.content, genExtra(input));
}
