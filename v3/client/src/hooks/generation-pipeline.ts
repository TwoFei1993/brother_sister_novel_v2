/**
 * 生成流编排辅助（novel/chat 共用管线层，设计 §5.1 / §3.2 / §9.2）
 *
 * loadAssembleAssets（绑定资产并行拉取）→ buildMacroEnv（变量读写暂存）
 * → scanAndAssemble（世界书扫描 + 总装 + tokenize 预算校验；末轮注入经 AssembleTail
 *   参数化，novel=directive / chat=userMessage，review #7 去重）
 * → finalizeGeneration（novel：后处理 → 幂等入库 → 变量回写 → store 收束；
 *   chat 的成对收尾在 features/chat/chat-flow.ts，复用本层 persistMessage/persistVariables）
 *
 * 允许依赖 api 层与 store 的非 hook 调用（getState）；不含 React hook。
 * 纯函数见 generation-flow.ts，共享 run 内核见 generation-runtime.ts。
 */
import type { Message } from '@shared/message';
import type { TavernCardV2, TavernPreset, TavernPrompt, TavernRegexScript } from '@shared/tavern';
import type { CharacterAsset } from '@shared/card';
import type { PresetAsset } from '@shared/preset';
import type { WorldbookAsset } from '@shared/worldbook';
import type { Work } from '@shared/work';

import { apiFetch } from '../api/client';
import type { RegexAsset } from '../api/library';
import { tokenizeMessages, type GenerateMessage } from '../api/llm';
import type { MacroEnv } from '../engine/types';
import { countTokensApprox } from '../engine/budget';
import { buildSummarizePrompt } from '../engine/prompt/memory';
import { assemblePrompt } from '../engine/prompt/assemble';
import { postprocessMessage } from '../engine/prompt/postprocess';
import { scanWorldInfo, type ScanSettings } from '../engine/worldbook';
import { useGenerationStore } from '../stores/generation';
import { useSettingsStore, type LlmPrefs } from '../stores/settings';

import {
  appendSwipe,
  buildChapterMessage,
  nextChapterIndex,
  GenerationFlowError,
  toGenerationError,
} from './generation-flow';

export interface AssembleAssets {
  preset: TavernPreset | null;
  cards: TavernCardV2[];
  worldbooks: WorldbookAsset[];
  regexScripts: TavernRegexScript[];
}

/**
 * 预设缺失兜底：标准酒馆 marker 骨架（Default 预设的 marker 顺序，无内容提示词）。
 * 关键：worldInfoBefore/After 必须在列——否则只绑世界书不绑预设时，扫描命中的条目
 * 内容会因 prompt_order 无处装填而被静默丢弃（M3 验收发现并修复）。
 * main/jailbreak 无预设时 blocks 取空串自然跳过；卡字段由 marker 位置装填。
 */
export const EMPTY_PRESET: TavernPreset = {
  prompts: [],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'charPersonality', enabled: true },
        { identifier: 'scenario', enabled: true },
        { identifier: 'worldInfoAfter', enabled: true },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'jailbreak', enabled: true },
      ],
    },
  ],
};

/** novel 兜底主提示词：无预设时让模型以小说作家身份按章续写（质量测试 T5 教训：无主提示词会退化成通用助手） */
const FALLBACK_NOVEL_MAIN: TavernPrompt = {
  identifier: 'main',
  name: '内置作家主提示词',
  role: 'system',
  system_prompt: true,
  content:
    '你是一位资深中文小说作家。请根据上方的全部设定与剧情指引，续写下一章正文：\n' +
    '- 以小说笔法叙事，融合场景、动作、对话与心理描写，人物性格与关系保持前后一致\n' +
    '- 情节必须承接聊天历史中的前文，不得另起炉灶\n' +
    '- 每章正文约 1500 字；直接输出正文本身\n' +
    '- 不要输出章节标题、编号、总结、写作说明或任何与正文无关的元信息\n' +
    '- 绝不以 AI、助手、模型身份说话',
};

/** chat 兜底主提示词：无预设时强制沉浸式角色扮演（{{char}} 由宏环境解析为当前发言角色） */
const FALLBACK_CHAT_MAIN: TavernPrompt = {
  identifier: 'main',
  name: '内置角色扮演主提示词',
  role: 'system',
  system_prompt: true,
  content:
    '你将完全扮演{{char}}，进行沉浸式角色扮演对话：\n' +
    '- 始终以{{char}}的身份、口吻说话与行动，用小说笔法描写（对话、动作、心理、环境）\n' +
    '- 每轮回复约 200-500 字；严格遵循上方世界观与角色设定，主动推动剧情\n' +
    '- 绝不跳出角色，绝不承认自己是 AI 或助手；不要在回复开头加角色名前缀',
};

/** 通用兜底收尾层：禁止元信息与思维过程外泄 */
const FALLBACK_JAILBREAK: TavernPrompt = {
  identifier: 'jailbreak',
  name: '内置收尾要求',
  role: 'system',
  system_prompt: true,
  content:
    '输出要求（最高优先级）：你的输出就是正文/对话本身——禁止任何旁白解释、写作提纲、思维过程（如 <thinking> 块）或「以下是/本章完」类元信息。',
};

/** 按模式构建兜底预设（marker 骨架 + 中文主提示词；卡覆盖开关仍可替换 main） */
export function buildFallbackPreset(tailKind: 'directive' | 'userMessage'): TavernPreset {
  return {
    ...EMPTY_PRESET,
    prompts: [tailKind === 'directive' ? FALLBACK_NOVEL_MAIN : FALLBACK_CHAT_MAIN, FALLBACK_JAILBREAK],
  };
}

/** 世界书扫描全局设置（scanDepth 固定 10；条目级 scanDepth 可更深） */
const SCAN_SETTINGS: ScanSettings = {
  scanDepth: 10,
  caseSensitive: false,
  matchWholeWords: false,
  recursive: true,
  maxRecursionSteps: 10,
};

/** 上下文规划（纯函数）：预算装得下则全量保留；装不下时从最旧侧切出 dropped（待摘要区） */
export function planContext(history: Message[], budget: number): { kept: Message[]; dropped: Message[] } {
  const tokens = history.map((m) => countTokensApprox(m.content));
  const total = tokens.reduce((a, b) => a + b, 0);
  if (total <= budget) return { kept: history, dropped: [] };
  let acc = 0;
  let cut = history.length;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    acc += tokens[i];
    if (acc > budget) {
      cut = i + 1;
      break;
    }
  }
  return { kept: history.slice(cut), dropped: history.slice(0, cut) };
}

/** 滚动摘要（防失忆）：把被预算切出的最旧消息压缩为摘要文本；失败返回 null（生成不阻塞） */
export async function summarizeDropped(
  prefs: LlmPrefs,
  prevSummary: string | undefined,
  texts: string[],
): Promise<string | null> {
  if (texts.length === 0) return null;
  const { system, user } = buildSummarizePrompt(prevSummary ?? '', texts);
  try {
    const out = (await apiFetch('/api/llm/generate', {
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
    })) as { text?: string };
    const text = out.text?.trim();
    return text ? text : null;
  } catch {
    return null;
  }
}

/** 拉取作品绑定的正则脚本（生成轨装配 + 显示轨渲染共用；单项失败跳过不阻塞） */
export async function loadRegexScripts(work: Work): Promise<TavernRegexScript[]> {
  const list = await Promise.all(
    work.regexScriptIds.map((id) =>
      apiFetch<RegexAsset>(`/api/regex-scripts/${id}`).then((a) => a.raw).catch(() => null),
    ),
  );
  return list.filter((s): s is TavernRegexScript => s !== null);
}

/** 并行拉取作品绑定的四类资产；单项失败跳过不阻塞生成 */
export async function loadAssembleAssets(work: Work): Promise<AssembleAssets> {
  const [preset, cards, books, regexScripts] = await Promise.all([
    work.presetId
      ? apiFetch<PresetAsset>(`/api/presets/${work.presetId}`).then((a) => a.raw).catch(() => null)
      : Promise.resolve(null),
    Promise.all(
      work.characterIds.map((id) =>
        apiFetch<CharacterAsset>(`/api/characters/${id}`).then((a) => a.card).catch(() => null),
      ),
    ),
    Promise.all(work.worldbookIds.map((id) => apiFetch<WorldbookAsset>(`/api/worldbooks/${id}`).catch(() => null))),
    loadRegexScripts(work),
  ]);
  return {
    preset,
    cards: cards.filter((c): c is TavernCardV2 => c !== null),
    worldbooks: books.filter((b): b is WorldbookAsset => b !== null),
    regexScripts,
  };
}

/** 变量待写集合（{{setvar}} 的引擎外持久化暂存，生成完成后回写） */
export interface PendingVars {
  work: Map<string, string>;
  global: Map<string, string>;
}

/** 宏环境（§5.1③）：user=「作者」、char=主卡名或「小说家」；变量读走 store/参数，写进暂存 */
export function buildMacroEnv(
  work: Work,
  primaryCharName: string | undefined,
  pending: PendingVars,
): MacroEnv {
  return {
    user: '作者',
    char: primaryCharName || '小说家',
    getVar: (name, scope) =>
      scope === 'global'
        ? useSettingsStore.getState().config?.globalVariables?.[name]
        : work.settings.variables?.[name],
    setVar: (name, value, scope) => {
      (scope === 'global' ? pending.global : pending.work).set(name, value);
    },
    scope: 'work',
  };
}

export interface FittedPrompt {
  messages: GenerateMessage[];
  /** tokenize 实测总 token（超预算多截后） */
  promptTokens: number;
  truncated: boolean;
  activatedIds: string[];
}

/** 末轮注入通道（review #7 参数化，novel/chat 共用同一 scanAndAssemble）：
 *  novel=剧情指令 directive（「剧情指引：…」包装）/ chat=用户消息 userMessage（§4.3） */
export type AssembleTail =
  | { kind: 'directive'; text: string }
  | { kind: 'userMessage'; text: string };

/** 世界书扫描 + 总装 + tokenize 预算校验（§5.4：超预算按比例多截历史再组装） */
export async function scanAndAssemble(
  work: Work,
  messages: Message[],
  tail: AssembleTail,
  assets: AssembleAssets,
  env: MacroEnv,
  prefs: LlmPrefs,
): Promise<FittedPrompt> {
  const scan = scanWorldInfo({
    books: assets.worldbooks,
    // 扫描池 = 本轮注入文本（最新，必扫）+ 历史消息（最近的在前，与酒馆扫描深度语义一致）
    chatTexts: [tail.text, ...[...messages].reverse().map((m) => m.content)].filter(Boolean),
    settings: SCAN_SETTINGS,
    macroEnv: env,
  });
  // 预算默认拉满：MiniMax-M3 支持百万级上下文；过小的预算会把前文章节全部截掉，
  // 导致续写脱离前文（质量测试后用户实测踩中）。用户显式设置仍优先生效。
  const maxContext = prefs.maxContext ?? 1000000;
  const maxTokens = prefs.maxTokens ?? 8192;
  const budget = Math.max(0, maxContext - maxTokens);

  // 防失忆（§5.3 滚动摘要）：历史超出预算的最旧部分不再静默丢弃，
  // 而是压缩成滚动摘要注入（增量游标 summaryUpTo 避免重复摘要）。
  const plan = planContext(messages, budget);
  let summary = work.settings.rollingSummary;
  if (plan.dropped.length > 0 && (work.settings.summaryUpTo ?? 0) < plan.dropped.length) {
    const fresh = await summarizeDropped(
      prefs,
      summary,
      plan.dropped.map((m) => m.content),
    );
    if (fresh !== null) {
      summary = fresh;
      // best-effort 持久化（失败仅影响本会话，下次生成会重新摘要）
      try {
        await apiFetch(`/api/works/${work.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            revision: work.revision,
            settings: { ...work.settings, rollingSummary: fresh, summaryUpTo: plan.dropped.length },
          }),
        });
      } catch {
        /* 摘要照常用于本次组装 */
      }
    }
  }

  let history = plan.kept;
  for (;;) {
    const result = assemblePrompt({
      preset: assets.preset ?? buildFallbackPreset(tail.kind),
      cards: assets.cards,
      // §4.4 卡覆盖预设开关：作品级设置，缺省视为开（与酒馆一致）
      allowCardOverride: work.allowCardOverride !== false,
      worldbookScan: scan,
      workSettings: work.settings,
      ...(summary ? { summary } : {}),
      history,
      ...(tail.kind === 'directive' ? { directive: tail.text } : { userMessage: tail.text }),
      macroEnv: env,
      budgetTokens: budget,
      regexScripts: assets.regexScripts, // promptOnly 生成轨（静态块进上下文前应用）
    });
    const assembled: GenerateMessage[] = result.messages.map((m) => ({
      role: m.role,
      ...(m.name ? { name: m.name } : {}),
      content: m.content,
    }));
    if (history.length === 0) {
      return { messages: assembled, promptTokens: result.usage.promptTokens, truncated: result.usage.truncated, activatedIds: result.activatedIds };
    }
    const { count } = await tokenizeMessages(prefs.source, prefs.model || undefined, assembled);
    if (count <= budget) {
      return { messages: assembled, promptTokens: count, truncated: result.usage.truncated, activatedIds: result.activatedIds };
    }
    // 超预算：按超量比例估算截断条数（至少 1 条），截掉最旧后重新组装校验
    const perMsg = count / Math.max(1, assembled.length);
    const drop = Math.min(history.length, Math.max(1, Math.ceil((count - budget) / perMsg)));
    history = history.slice(drop);
  }
}

/** 幂等入库（§9.2）：server 按 messageId 幂等 upsert（同 id 整行替换），重发安全、无 409 路径 */
export async function persistMessage(workId: string, message: Message): Promise<void> {
  await apiFetch(`/api/works/${workId}/messages`, { method: 'POST', body: JSON.stringify(message) });
}

/** 变量回写（引擎外持久化，best-effort）：作品级 PATCH work（带 revision），全局级 GET+merge+PUT config */
export async function persistVariables(work: Work, pending: PendingVars): Promise<void> {
  if (pending.work.size === 0 && pending.global.size === 0) return;
  try {
    if (pending.work.size > 0) {
      const variables = { ...(work.settings.variables ?? {}), ...Object.fromEntries(pending.work) };
      await apiFetch(`/api/works/${work.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ revision: work.revision, settings: { ...work.settings, variables } }),
      });
    }
    if (pending.global.size > 0) {
      const config = await apiFetch<Record<string, unknown>>('/api/config');
      const merged = {
        ...config,
        globalVariables: {
          ...((config.globalVariables as Record<string, string> | undefined) ?? {}),
          ...Object.fromEntries(pending.global),
        },
      };
      await apiFetch('/api/config', { method: 'PUT', body: JSON.stringify(merged) });
      useSettingsStore.getState().setConfig(merged);
    }
  } catch (err) {
    console.warn('[useGenerate] 变量持久化失败（不影响正文入库）', err);
  }
}

export interface FinalizeInput {
  work: Work;
  messages: Message[];
  directive: string;
  swipeTarget: Message | null;
  assets: AssembleAssets;
  env: MacroEnv;
  prefs: LlmPrefs;
  promptTokens: number;
  activatedIds: string[];
  startedAt: number;
  pending: PendingVars;
}

/** 完成收尾（§5.1⑥ / §9.2）：后处理 → 构造消息 → 幂等入库 → 变量回写 → store 收束 */
export async function finalizeGeneration(input: FinalizeInput): Promise<Message> {
  const { work, directive, swipeTarget, assets, env, prefs, startedAt, pending } = input;
  const raw = useGenerationStore.getState().buffer;
  const chapterIndex = nextChapterIndex(input.messages);
  const pp = postprocessMessage(raw, {
    directive: directive || undefined,
    chapterIndex: chapterIndex - 1,
    regexScripts: assets.regexScripts,
    macroEnv: env,
    speakerName: '小说家',
  });
  const generationMs = Date.now() - startedAt;
  const extra = {
    model: prefs.model || undefined,
    tokenCount: input.promptTokens,
    generationMs,
  };
  const message = swipeTarget
    ? appendSwipe(swipeTarget, pp.content, extra)
    : buildChapterMessage({
        content: pp.content,
        title: pp.title,
        chapterIndex,
        directive: directive || undefined,
        promptTokens: input.promptTokens,
        generationMs,
        statusSnapshot: pp.statusSnapshot,
        activatedEntries: input.activatedIds,
      });
  try {
    await persistMessage(work.id, message);
  } catch (err) {
    const ge = toGenerationError(err);
    throw new GenerationFlowError({ code: ge.code, message: `正文已生成，但入库失败：${ge.message}` });
  }
  await persistVariables(work, pending);
  useGenerationStore.getState().finish();
  useGenerationStore.getState().reset();
  return message;
}
