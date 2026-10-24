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
import type { FactionAsset } from '@shared/assets/faction';
import type { WorldbookAsset } from '@shared/worldbook';
import type { Work } from '@shared/work';
import { DEFAULT_TARGET_CHAPTER_WORDS } from '@shared/work';

import { apiFetch } from '../api/client';
import type { RegexAsset } from '../api/library';
import { tokenizeMessages, type GenerateMessage } from '../api/llm';
import { countTokensApprox } from '../engine/budget';
import type { MacroEnv } from '../engine/types';
import { assemblePrompt } from '../engine/prompt/assemble';
import { META_ONLY_PLACEHOLDER, extractThinking, mergeThinking, postprocessMessage } from '../engine/prompt/postprocess';
import { buildChapterRequirement } from '../engine/prompt/novel/requirements';
import { MEMORY_EXTRACT_SYSTEM, mergeForeshadows, parseMemoryExtract } from '../engine/prompt/novel/memory-extract';
import { NEW_ASSETS_HINT, parseNewAssets } from '../engine/prompt/novel/new-assets';
import { chapterOutlineDirective } from '../lib/outline/chapters';
import { recallBlock } from '../lib/recall';
import { skeletonBlock } from '../lib/skeleton';
import { scanWorldInfo } from '../engine/worldbook';
import { useGenerationStore } from '../stores/generation';
import { useSettingsStore, type LlmPrefs } from '../stores/settings';
import { useWorkStore } from '../stores/work';

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
  /** 势力介绍（P2.2；整块注入提示词资料区，无逐条激活语义） */
  factions: FactionAsset[];
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

/**
 * 章号感知的绑定生效集（P2.2 绑定三态，共识 D4）
 *
 * 写第 C 章时素材生效 = 初始绑定 ids ∪ bindings(active 且 fromChapter≤C)。
 * chapterIndex 缺省（chat 模式/全量场景）= 不做章过滤，全部生效。
 */
export function effectiveAssetIds(
  work: Work,
  kind: 'character' | 'worldbook' | 'faction',
  chapterIndex?: number,
): string[] {
  const initial =
    kind === 'character' ? work.characterIds : kind === 'worldbook' ? work.worldbookIds : (work.factionIds ?? []);
  if (chapterIndex === undefined) return initial;
  const extra = (work.bindings ?? [])
    .filter((b) => b.kind === kind && b.status === 'active' && b.fromChapter <= chapterIndex)
    .map((b) => b.assetId);
  return [...new Set([...initial, ...extra])];
}

/** 并行拉取作品绑定的资产；chapterIndex 给定时按绑定生效章过滤（novel 生成），缺省全量（chat） */
export async function loadAssembleAssets(work: Work, chapterIndex?: number): Promise<AssembleAssets> {
  const characterIds = effectiveAssetIds(work, 'character', chapterIndex);
  const worldbookIds = effectiveAssetIds(work, 'worldbook', chapterIndex);
  const factionIds = effectiveAssetIds(work, 'faction', chapterIndex);
  const [preset, cards, books, factions, regexScripts] = await Promise.all([
    work.presetId
      ? apiFetch<PresetAsset>(`/api/presets/${work.presetId}`).then((a) => a.raw).catch(() => null)
      : Promise.resolve(null),
    Promise.all(
      characterIds.map((id) =>
        apiFetch<CharacterAsset>(`/api/characters/${id}`).then((a) => a.card).catch(() => null),
      ),
    ),
    Promise.all(worldbookIds.map((id) => apiFetch<WorldbookAsset>(`/api/worldbooks/${id}`).catch(() => null))),
    Promise.all(factionIds.map((id) => apiFetch<FactionAsset>(`/api/factions/${id}`).catch(() => null))),
    loadRegexScripts(work),
  ]);
  const factionList = factions.filter((f): f is FactionAsset => f !== null);
  // 势力注入（D4「整块注入」）：构造成伪世界书 constant 条目，复用世界书引擎的既有注入路径（不动引擎）
  const factionBook: WorldbookAsset | null =
    factionList.length > 0
      ? {
          id: '__factions__',
          name: '势力设定（绑定生效）',
          raw: {
            entries: Object.fromEntries(
              factionList.map((f, i) => [
                String(i),
                {
                  uid: i,
                  key: [f.name],
                  content: `【势力设定：${f.name}】${f.description}${f.relations ? `\n与其他势力的关系：${f.relations}` : ''}${f.members?.length ? `\n主要成员：${f.members.join('、')}` : ''}`,
                  constant: true,
                  enabled: true,
                  insertion_order: 40,
                },
              ]),
            ),
          },
        }
      : null;
  return {
    preset,
    cards: cards.filter((c): c is TavernCardV2 => c !== null),
    worldbooks: [...books.filter((b): b is WorldbookAsset => b !== null), ...(factionBook ? [factionBook] : [])],
    factions: factionList,
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
  // 远距记忆检索（P2-1）：被预算裁掉的最旧章节按当前指令相关性召回 top3 窗口（仅 novel，仅进提示词）
  const recallHint =
    tail.kind === 'directive' && plan.dropped.length > 0
      ? recallBlock(
          [tail.text, ...messages.slice(-2).map((m) => m.content)].join('\n'),
          plan.dropped.map((m) => m.content).join('\n\n'),
        )
      : '';
  // 章节骨架兜底（失忆修复）：LLM 摘要失败（上游不稳）时被裁章节会在上下文完全消失——
  // 骨架块纯本地压缩（标题+首段）永不在场失败，与摘要/回忆并存（仅进提示词）
  const skeletonHint =
    tail.kind === 'directive' && plan.dropped.length > 0 ? skeletonBlock(plan.dropped) : '';
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
        ? {
            // NEW_ASSETS_HINT 仅在有真实指令的章追加：空指令（⚡连写推进章）保持纯净，
            // 避免「剧情指引：」裸前缀被 hint 撑出（batch 测试锁定的语义）
            directive: tail.text + outlineHint + recallHint + skeletonHint + (tail.text ? NEW_ASSETS_HINT : ''),
            chapterRequirement: buildChapterRequirement(targetWords),
          }
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

/** 幂等入库（§9.2）：server 按 messageId 幂等 upsert（同 id 整行替换），重发安全、无 409 路径。
 *  入库会 bump 服务端 work.revision：随响应同步回 work store，避免本会话后续 PATCH（变量回写/视图偏好）乐观锁 409。 */
export async function persistMessage(workId: string, message: Message): Promise<void> {
  const res = await apiFetch<{ ok: boolean; revision?: number }>(`/api/works/${workId}/messages`, {
    method: 'POST',
    body: JSON.stringify(message),
  });
  const { work } = useWorkStore.getState();
  if (work && work.id === workId && typeof res.revision === 'number' && res.revision > work.revision) {
    useWorkStore.getState().setWork({ ...work, revision: res.revision });
  }
}

/** 变量回写（引擎外持久化，best-effort）：作品级 PATCH work（带 revision），全局级 GET+merge+PUT config */
/** 记忆抽取触发周期（每 N 章一次）：平衡抽取成本与状态新鲜度 */
export const MEMORY_EXTRACT_EVERY = 3;

/**
 * 自动记忆抽取（后台 best-effort）：用当前 LLM 通道对最新一章做结构化抽取，
 * 得到「人物状态卡 + 新埋伏笔」，合并进 settings.characterState/foreshadows 并 PATCH 落库，
 * 同时同步 work store（避免批次内状态卡滞后一批）。任何失败静默（不影响本章已入库）。
 */
export async function extractAndStoreMemory(
  work: Work,
  chapterText: string,
  chapterNumber: number,
  prefs: LlmPrefs,
): Promise<void> {
  const body = {
    source: prefs.source,
    model: prefs.model,
    stream: false,
    params: { max_tokens: 800, temperature: 0.2 },
    messages: [
      { role: 'system', content: MEMORY_EXTRACT_SYSTEM },
      { role: 'user', content: `【最新一章（第${chapterNumber}章）】\n${chapterText.slice(-6000)}` },
    ],
  };
  const res = await apiFetch<{ text?: string }>('/api/llm/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const parsed = parseMemoryExtract(res.text ?? '');
  if (!parsed) return;
  const foreshadows = mergeForeshadows(work.settings.foreshadows, chapterNumber, parsed.foreshadows);
  const settings = {
    ...work.settings,
    characterState: parsed.characterState,
    foreshadows,
  };
  const updated = await apiFetch<Work>(`/api/works/${work.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ revision: work.revision, settings }),
  });
  useWorkStore.getState().setWork(updated);
}

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
  // 思考流捕获（用户反馈⑨ + D4 全链路）：流式 thinkingBuffer 优先，内嵌 <think> 标签兜底
  const { thinking: taggedThinking } = extractThinking(raw);
  const thinking = mergeThinking(useGenerationStore.getState().thinkingBuffer, taggedThinking);
  const pp = postprocessMessage(raw, {
    directive: directive || undefined,
    chapterIndex: chapterIndex - 1,
    regexScripts: assets.regexScripts,
    macroEnv: env,
    speakerName: '小说家',
    stripChatter: true, // novel 入库轨闲聊前导剥离（对 System 寒暄等，见 chat-preamble.ts）
  });
  const generationMs = Date.now() - startedAt;
  // P2.2 待绑定检测：剥离 <new_assets> 块（不进正文），清单进 extra.newAssets 供前端确认绑定
  const { content: cleanContent, detected } = parseNewAssets(pp.content);
  const extra = {
    model: prefs.model || undefined,
    tokenCount: input.promptTokens,
    generationMs,
    ...(thinking ? { rawThinking: thinking } : {}),
    ...(detected.length > 0 ? { newAssets: detected } : {}),
  };
  // 净化后一无所有 = 整轮输出只有思考/元信息：落占位提示（上层 isMetaOnly 据此自动重试一次）
  const bodyContent = cleanContent.trim() ? cleanContent : META_ONLY_PLACEHOLDER;
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
        newAssets: detected.length > 0 ? detected : undefined,
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
    // 自动记忆抽取（每 3 章一次，后台不阻塞返回）：人物状态卡 + 伏笔登记 → settings
    if (!swipeTarget && chapterIndex % 3 === 0) {
      void extractAndStoreMemory(work, message.content, chapterIndex, prefs).catch((e) =>
        console.warn('[memory-extract] 抽取失败（不影响本章入库）:', e?.message ?? e),
      );
    }

  }
  useGenerationStore.getState().finish();
  useGenerationStore.getState().reset();
  return message;
}
