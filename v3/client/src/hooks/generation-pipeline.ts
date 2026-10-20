/**
 * 生成流编排辅助（novel/chat 共用管线层，设计 §5.1 / §3.2 / §9.2）
 * loadAssembleAssets → buildMacroEnv → scanAndAssemble（总装+预算校验）→ finalizeGeneration（novel 入库收束；chat 见 chat-flow）。
 * 允许依赖 api 层与 store（getState）；不含 React hook。兜底预设与预算规划（EMPTY_PRESET/
 * planContext/守卫与 hint 构造/FittedPrompt 等）见 context-plan.ts（本模块 re-export 兼容）。
 */
import type { Message } from '@shared/message';
import type { TavernCardV2, TavernPreset, TavernRegexScript } from '@shared/tavern';
import type { CharacterAsset } from '@shared/card';
import type { PresetAsset } from '@shared/preset';
import type { WorldbookAsset } from '@shared/worldbook';
import type { Work } from '@shared/work';
import { DEFAULT_TARGET_CHAPTER_WORDS } from '@shared/work';

import { apiFetch } from '../api/client';
import type { RegexAsset } from '../api/library';
import { tokenizeMessages, type GenerateMessage } from '../api/llm';
import { countTokensApprox } from '../engine/budget';
import type { MacroEnv } from '../engine/types';
import { assemblePrompt } from '../engine/prompt/assemble';
import { META_ONLY_PLACEHOLDER, extractThinking, postprocessMessage } from '../engine/prompt/postprocess';
import { buildChapterRequirement } from '../engine/prompt/novel/requirements';
import { chapterOutlineDirective } from '../lib/outline/chapters';
import { scanWorldInfo } from '../engine/worldbook';
import { useGenerationStore } from '../stores/generation';
import { useSettingsStore, type LlmPrefs } from '../stores/settings';

import {
  buildFallbackPreset,
  novelGuardPlan,
  planContext,
  summarizeDropped,
  SCAN_SETTINGS,
} from './context-plan';

// ---- 上下文规划层公开面（迁移兼容 re-export：全部调用方仍从本模块导入）----
export {
  EMPTY_PRESET, SCAN_SETTINGS, buildChatMainPrompt, buildFallbackPreset,
  novelGuardPlan, planContext, summarizeDropped, withNovelOutputGuard,
} from './context-plan';

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
export function buildMacroEnv(work: Work, primaryCharName: string | undefined, pending: PendingVars): MacroEnv {
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

// 类型公开面（规范回补迁出至 context-plan；re-export 保持调用方兼容）
export type { AssembleTail, FittedPrompt } from './context-plan';
import type { AssembleTail, FittedPrompt } from './context-plan';

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
  // 预算默认拉满（M3 百万级上下文；过小预算会截掉前文致续写脱节，用户显式设置仍优先）
  const maxContext = prefs.maxContext ?? 1000000;
  const maxTokens = prefs.maxTokens ?? 8192;
  const budget = Math.max(0, maxContext - maxTokens);

  // 防失忆（§5.3 滚动摘要）：预算切出的最旧部分压缩成摘要注入（增量游标 summaryUpTo 防重复）
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
  const targetWords = work.settings.targetChapterWords ?? DEFAULT_TARGET_CHAPTER_WORDS; // 兜底主提示词与末尾写作要求共用
  // 章节大纲联动（一键导入大纲）：第 N 章有预设大纲时 directive 末尾追加本章要点（仅进提示词，入库 directive 保持原指令）
  const outlineHint =
    tail.kind === 'directive'
      ? chapterOutlineDirective(work.settings.chapterOutlines, nextChapterIndex(messages))
      : '';
  // 输出守卫（novel）在 tokenize 校验之后追加：预算需预留其开销（novelGuardPlan 见 context-plan）
  const guardPlan =
    tail.kind === 'directive'
      ? novelGuardPlan(targetWords)
      : { allowance: 0, withGuard: (msgs: GenerateMessage[]): GenerateMessage[] => msgs };
  for (;;) {
    const result = assemblePrompt({
      preset: assets.preset ?? buildFallbackPreset(tail.kind, work.settings.chatReplyLength ?? 'medium', targetWords),
      cards: assets.cards,
      // §4.4 卡覆盖预设开关：作品级设置，缺省视为开（与酒馆一致）
      allowCardOverride: work.allowCardOverride !== false,
      worldbookScan: scan,
      workSettings: work.settings,
      ...(summary ? { summary } : {}),
      history,
      ...(tail.kind === 'directive'
        ? { directive: tail.text + outlineHint, chapterRequirement: buildChapterRequirement(targetWords) }
        : { userMessage: tail.text }),
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
      return { messages: guardPlan.withGuard(assembled), promptTokens: result.usage.promptTokens, truncated: result.usage.truncated, activatedIds: result.activatedIds };
    }
    const { count } = await tokenizeMessages(prefs.source, prefs.model || undefined, assembled);
    if (count <= budget - guardPlan.allowance) {
      return { messages: guardPlan.withGuard(assembled), promptTokens: count, truncated: result.usage.truncated, activatedIds: result.activatedIds };
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
      const globals = (config.globalVariables as Record<string, string> | undefined) ?? {};
      const merged = { ...config, globalVariables: { ...globals, ...Object.fromEntries(pending.global) } };
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
  /** 无效输出重试覆盖语义：重跑携带首次消息 id，落库行按 messageId 幂等覆盖 */
  messageId?: string;
  pending: PendingVars;
}

/** 完成收尾（§5.1⑥ / §9.2）：后处理 → 构造消息 → 幂等入库 → 变量回写 → store 收束 */
export async function finalizeGeneration(input: FinalizeInput): Promise<Message> {
  const { work, directive, swipeTarget, assets, env, prefs, startedAt, pending } = input;
  const raw = useGenerationStore.getState().buffer;
  const chapterIndex = nextChapterIndex(input.messages);
  // 思考流捕获（用户反馈⑨）：sanitize 只剥离，内容存 extra.rawThinking 供前端折叠展示
  const { thinking } = extractThinking(raw);
  const pp = postprocessMessage(raw, {
    directive: directive || undefined,
    chapterIndex: chapterIndex - 1,
    regexScripts: assets.regexScripts,
    macroEnv: env,
    speakerName: '小说家',
    stripChatter: true, // novel 入库轨闲聊前导剥离（对 System 寒暄等，见 chat-preamble.ts）
  });
  const generationMs = Date.now() - startedAt;
  const extra = {
    model: prefs.model || undefined,
    tokenCount: input.promptTokens,
    generationMs,
    ...(thinking ? { rawThinking: thinking } : {}),
  };
  // 净化后一无所有 = 整轮输出只有思考/元信息：落占位提示（上层 isMetaOnly 据此自动重试一次）
  const bodyContent = pp.content.trim() ? pp.content : META_ONLY_PLACEHOLDER;
  const message = swipeTarget
    ? appendSwipe(swipeTarget, bodyContent, extra)
    : buildChapterMessage({
        content: bodyContent,
        title: pp.title,
        chapterIndex,
        directive: directive || undefined,
        promptTokens: input.promptTokens,
        generationMs,
        statusSnapshot: pp.statusSnapshot,
        activatedEntries: input.activatedIds,
        rawThinking: thinking ?? undefined,
        // 无效输出重试覆盖语义：重跑时携带首次消息 id，按 messageId 幂等覆盖落库行
        ...(input.messageId ? { id: input.messageId } : {}),
      });
  const metaOnly = !pp.content.trim(); // 整轮输出只有思考/元信息：不入库，交由上层自动重试
  if (!metaOnly) {
    try {
      await persistMessage(work.id, message);
    } catch (err) {
      const ge = toGenerationError(err);
      throw new GenerationFlowError({ code: ge.code, message: `正文已生成，但入库失败：${ge.message}` });
    }
    await persistVariables(work, pending);
  }
  useGenerationStore.getState().finish();
  useGenerationStore.getState().reset();
  return message;
}
