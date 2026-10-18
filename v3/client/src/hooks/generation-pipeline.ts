/**
 * 生成流编排辅助（useGenerate 的管线层，设计 §5.1 / §3.2 / §9.2）
 *
 * loadAssembleAssets（绑定资产并行拉取）→ buildMacroEnv（变量读写暂存）
 * → scanAndAssemble（世界书扫描 + 总装 + tokenize 预算校验）
 * → finalizeGeneration（后处理 → 幂等入库 → 变量回写 → store 收束）
 *
 * 允许依赖 api 层与 store 的非 hook 调用（getState）；不含 React hook。
 * 纯函数见 generation-flow.ts。
 */
import type { Message } from '@shared/message';
import type { TavernCardV2, TavernPreset, TavernRegexScript } from '@shared/tavern';
import type { CharacterAsset } from '@shared/card';
import type { PresetAsset } from '@shared/preset';
import type { WorldbookAsset } from '@shared/worldbook';
import type { Work } from '@shared/work';

import { apiFetch, ApiError } from '../api/client';
import { tokenizeMessages, type GenerateMessage } from '../api/llm';
import type { MacroEnv } from '../engine/types';
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

/** 正则脚本资产（与 server RegexAsset 同形；shared 暂无壳类型，Task 25 上移） */
interface RegexAsset {
  id: string;
  name: string;
  raw: TavernRegexScript;
}

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

/** 世界书扫描全局设置（scanDepth 固定 10；条目级 scanDepth 可更深） */
const SCAN_SETTINGS: ScanSettings = {
  scanDepth: 10,
  caseSensitive: false,
  matchWholeWords: false,
  recursive: true,
  maxRecursionSteps: 10,
};

/** 并行拉取作品绑定的四类资产；单项失败跳过不阻塞生成 */
export async function loadAssembleAssets(work: Work): Promise<AssembleAssets> {
  const [preset, cards, books, scripts] = await Promise.all([
    work.presetId
      ? apiFetch<PresetAsset>(`/api/presets/${work.presetId}`).then((a) => a.raw).catch(() => null)
      : Promise.resolve(null),
    Promise.all(
      work.characterIds.map((id) =>
        apiFetch<CharacterAsset>(`/api/characters/${id}`).then((a) => a.card).catch(() => null),
      ),
    ),
    Promise.all(work.worldbookIds.map((id) => apiFetch<WorldbookAsset>(`/api/worldbooks/${id}`).catch(() => null))),
    Promise.all(
      work.regexScriptIds.map((id) =>
        apiFetch<RegexAsset>(`/api/regex-scripts/${id}`).then((a) => a.raw).catch(() => null),
      ),
    ),
  ]);
  return {
    preset,
    cards: cards.filter((c): c is TavernCardV2 => c !== null),
    worldbooks: books.filter((b): b is WorldbookAsset => b !== null),
    regexScripts: scripts.filter((s): s is TavernRegexScript => s !== null),
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

/** 世界书扫描 + 总装 + tokenize 预算校验（§5.4：超预算按比例多截历史再组装） */
export async function scanAndAssemble(
  work: Work,
  messages: Message[],
  directive: string,
  assets: AssembleAssets,
  env: MacroEnv,
  prefs: LlmPrefs,
): Promise<FittedPrompt> {
  const scan = scanWorldInfo({
    books: assets.worldbooks,
    // 扫描池 = 本轮指令（最新文本，必扫）+ 历史消息（最近的在前，与酒馆扫描深度语义一致）
    chatTexts: [directive, ...[...messages].reverse().map((m) => m.content)].filter(Boolean),
    settings: SCAN_SETTINGS,
    macroEnv: env,
  });
  const maxContext = prefs.maxContext ?? 8192;
  const maxTokens = prefs.maxTokens ?? 2048;
  const budget = Math.max(0, maxContext - maxTokens);

  let history = messages;
  for (;;) {
    const result = assemblePrompt({
      preset: assets.preset ?? EMPTY_PRESET,
      cards: assets.cards,
      // §4.4 卡覆盖预设开关：作品级设置，缺省视为开（与酒馆一致）
      allowCardOverride: work.allowCardOverride !== false,
      worldbookScan: scan,
      workSettings: work.settings,
      history,
      directive,
      macroEnv: env,
      budgetTokens: budget,
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

/** 幂等入库（§9.2）；409 冲突 → 拉最新 work 后重放一次（§4.5 协议） */
export async function persistMessage(workId: string, message: Message): Promise<void> {
  const post = (): Promise<unknown> =>
    apiFetch(`/api/works/${workId}/messages`, { method: 'POST', body: JSON.stringify(message) });
  try {
    await post();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'conflict') {
      await apiFetch(`/api/works/${workId}`); // 拉最新状态后重放一次
      await post();
      return;
    }
    throw err;
  }
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
