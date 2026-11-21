/**
 * server 端完成收尾（M2 Task 3.2；client generation-pipeline.finalizeGeneration 移植）：
 * postprocessMessage（正则/标题/状态块/闲聊剥离全参）→ parseNewAssets 剥离 →
 * buildChapterMessage / appendSwipe（@shared 纯函数）→ 入库直调 upsertMessageInternal
 * （routes/works/messages.ts 锁内逻辑，与 HTTP 通道同一事实源）→ 变量回写（server 直写）→
 * 润色 pass 与 truncatedSwipeId 收尾标记（client generateChapter 同段落移植）。
 * 另含：变量回写 persistVariablesServer、全局变量快照 readGlobalsSnapshot（Task 3.1 挂账缝）、
 * 记忆抽取 extractAndStoreMemoryServer（每 N 章一次，server 同步执行）。
 *
 * 与 client 版差异只在 IO 缝（D5 语义逐点对齐）：buffer/thinking 由调用方传入
 * （server 无 generation store）；入库走 upsertMessageInternal 而非 apiFetch；
 * 变量/记忆落库走文件直写（不动 revision——与 persistRollingSummary 同例，
 * 生成通道自动写不抢占用户会话的乐观锁）。
 */
import { join } from 'node:path';

import type { Message } from '@shared/message';
import type { Work } from '@shared/work';
import type { MacroEnv } from '@shared/engine/types';
import {
  META_ONLY_PLACEHOLDER,
  extractThinking,
  mergeThinking,
  postprocessMessage,
} from '@shared/engine/prompt/postprocess';
import { parseNewAssets } from '@shared/engine/prompt/novel/new-assets';
import {
  MEMORY_EXTRACT_SYSTEM,
  mergeForeshadows,
  parseMemoryExtract,
} from '@shared/engine/prompt/novel/memory-extract';
import {
  GenerationFlowError,
  appendSwipe,
  buildChapterMessage,
  looksTruncated,
  nextChapterIndex,
} from '@shared/hooks/generation-flow';

import { runGenerate } from '../llm';
import { withWorkLock } from '../../middleware/writer';
import { readJson, writeJsonAtomic } from '../../storage/store';
import { HttpError } from '../../middleware/validate';
import { dataDir } from '../../routes/core/paths';
import { upsertMessageInternal } from '../../routes/works/messages';
import { workFile } from '../../routes/works/works';

import type { AssembleAssets } from './assets';
import { invalidReasonOf, progressOf, type ChainState } from './chainState';
import type { NovelGenPrefs, PendingVars } from './assemble';

/** data/config.json（GET /api/config 的 server 数据源，routes/core/config.ts 同一布局） */
function configFile(): string {
  return join(dataDir(), 'config.json');
}

/** 全局变量快照（Task 3.1 挂账：buildMacroEnv 的 global getVar 需调用方先读一次传入）。
 *  orchestrate 开头读一次传入整个任务生命周期；文件缺失/损坏按空表（server 无内存 store）。 */
export async function readGlobalsSnapshot(): Promise<Record<string, unknown>> {
  const config = await readJson<Record<string, unknown>>(configFile()).catch(() => null);
  return (config?.globalVariables as Record<string, unknown> | undefined) ?? {};
}

// ---------- 变量回写（client persistVariables 的 server 版） ----------

/**
 * 变量回写（引擎外持久化，best-effort）：work 级锁内读-合并-直写 settings.variables；
 * global 级读改写 config.json（PUT /api/config 的 server 数据源直写等价）。
 * 任何失败告警不抛（不影响正文入库——与 client 版 console.warn 语义一致）。
 */
export async function persistVariablesServer(work: Work, pending: PendingVars): Promise<void> {
  if (pending.work.size === 0 && pending.global.size === 0) return;
  try {
    if (pending.work.size > 0) {
      await withWorkLock(work.id, async () => {
        const current = await readJson<Work>(workFile(work.id));
        if (!current) return;
        const variables = { ...(current.settings.variables ?? {}), ...Object.fromEntries(pending.work) };
        await writeJsonAtomic(workFile(work.id), { ...current, settings: { ...current.settings, variables } });
      });
    }
    if (pending.global.size > 0) {
      const config = (await readJson<Record<string, unknown>>(configFile()).catch(() => null)) ?? {};
      const globals = (config.globalVariables as Record<string, string> | undefined) ?? {};
      const merged = { ...config, globalVariables: { ...globals, ...Object.fromEntries(pending.global) } };
      await writeJsonAtomic(configFile(), merged);
    }
  } catch (err) {
    console.warn('[novel-gen] 变量持久化失败（不影响正文入库）', err);
  }
}

// ---------- 完成收尾（client finalizeGeneration 移植） ----------

export interface FinalizeChapterInput {
  work: Work;
  /** 本轮上下文（决定 chapterIndex 与 nextChapterIndex） */
  messages: Message[];
  directive: string;
  /** swipe/append/expand：候选 append 进该消息（同 id 幂等覆盖）；null=新章 */
  swipeTarget: Message | null;
  assets: AssembleAssets;
  env: MacroEnv;
  prefs: NovelGenPrefs;
  promptTokens: number;
  activatedIds: string[];
  startedAt: number;
  pending: PendingVars;
  /** 本轮聚合全文（server 无 store：调用方传入 initialBuffer 种子 + LLM 产出） */
  buffer: string;
  /** 流式思考聚合（D4 thinking 帧；与正文内嵌 <think> 兜底合并） */
  thinking?: string;
  /** 无效输出重试覆盖语义：重跑携带首次消息 id，落库行按 messageId 幂等覆盖 */
  messageId?: string;
  /** title 兜底（续写轮沿用原章标题——防续写指令首句污染 title） */
  keepTitle?: string;
}

/** 完成收尾（§5.1⑥ / §9.2）：后处理 → 构造消息 → 幂等入库 → 变量回写。返回构造的消息
 *  （metaOnly=整轮只有思考/元信息时不入库，消息仍返回交由上层自动重试——client 同语义）。 */
export async function finalizeChapter(input: FinalizeChapterInput): Promise<Message> {
  const { work, directive, swipeTarget, assets, env, prefs, startedAt, pending } = input;
  const raw = input.buffer;
  const chapterIndex = nextChapterIndex(input.messages);
  // 思考流合并：调用方传入的流式 thinking 优先，内嵌 <think> 标签兜底
  const { thinking: taggedThinking } = extractThinking(raw);
  const thinking = mergeThinking(input.thinking ?? '', taggedThinking);
  const pp = postprocessMessage(raw, {
    directive: directive || undefined,
    chapterIndex: chapterIndex - 1,
    ...(input.keepTitle ? { fallbackTitle: input.keepTitle } : {}),
    regexScripts: assets.regexScripts,
    macroEnv: env,
    speakerName: '小说家',
    stripChatter: true, // novel 入库轨闲聊前导剥离（对 System 寒暄等）
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
  // 净化后一无所有 = 整轮输出只有思考/元信息：落占位提示（上层 invalidReasonOf 据此自动重试）
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
        ...(input.messageId ? { id: input.messageId } : {}),
      });
  const metaOnly = !pp.content.trim(); // 整轮输出只有思考/元信息：不入库，交由上层自动重试
  if (!metaOnly) {
    try {
      await upsertMessageInternal(work.id, message);
    } catch (err) {
      // 执行中删书（D6）：404 以 WORK_MISSING 区分（runner 落 failed「作品已删除」）；
      // 其余入库失败照 client 语义包装（正文已生成，但入库失败：…）
      if (err instanceof HttpError && err.status === 404) {
        throw new GenerationFlowError({ code: 'WORK_MISSING', message: '作品已删除：正文已生成但无法入库' });
      }
      throw new GenerationFlowError({
        code: 'unknown',
        message: `正文已生成，但入库失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
    await persistVariablesServer(work, pending);
  }
  return message;
}

// ---------- 润色 pass 与收尾标记（client generateChapter 同段落移植） ----------

/** 润色系统提示词（client useGenerate.ts:490-493 逐字一致） */
const POLISH_SYSTEM =
  '你是资深小说编辑。对下面的章节全文做语言润色：保持全部情节、对话与事实，字数变化不超过 10%；' +
  '提升语言质感、消除重复与平庸表达；不改变人称与叙事结构。只输出润色后的正文本身，禁止任何解释或元信息。';

/**
 * 润色 pass（P2-2）：polishModel 非空且产出有效才润色（meta/崩溃稿润色无意义，白烧调用）；
 * 润色稿写回激活版本（新消息仅一支候选），同 id 幂等覆盖；失败静默保留原稿。
 */
export async function polishChapter(st: ChainState, msg: Message | null): Promise<Message | null> {
  const polishModel = st.prefs.polishModel;
  if (!msg || !polishModel || invalidReasonOf(msg) !== null) return msg;
  try {
    st.onProgress(progressOf(st, 'polishing'));
    let text = '';
    for await (const ev of runGenerate({
      source: st.prefs.source,
      model: polishModel,
      stream: false,
      params: { temperature: 0.6 },
      messages: [
        { role: 'system', content: POLISH_SYSTEM },
        { role: 'user', content: msg.content },
      ],
    })) {
      if (ev.kind === 'text') text += ev.text;
      if (ev.kind === 'error') break;
    }
    const polished = text.trim();
    if (!polished) return msg;
    const activeId = msg.swipeId;
    const next: Message = {
      ...msg,
      content: polished,
      swipes: msg.swipes.map((v, i) => (i === activeId ? { ...v, content: polished } : v)),
    };
    await upsertMessageInternal(st.workId, next); // 同 id 幂等覆盖：落库行更新为润色稿
    st.chapterText = next.content;
    return next;
  } catch {
    return msg; // 润色失败保留原稿（静默——正文本身已可用）
  }
}

/** 最后防线标记（client :518-529/:591-604 同构）：仅对有效产出标记，且在润色之后——
 *  标记跟随最终版本；swipe 场景 mark=末位候选（占位崩溃稿误标会指向崩溃候选） */
export async function markTruncatedSwipe(st: ChainState, msg: Message | null, mark: number): Promise<Message | null> {
  if (!msg || invalidReasonOf(msg) !== null) return msg;
  const tw = st.work.settings.targetChapterWords ?? 3000;
  if (!looksTruncated(st.finish, msg.content, tw)) return msg;
  const next: Message = { ...msg, extra: { ...msg.extra, truncatedSwipeId: mark } };
  try {
    await upsertMessageInternal(st.workId, next);
  } catch {
    /* 标记落库失败不阻塞返回 */
  }
  return next;
}

// ---------- 自动记忆抽取（client extractAndStoreMemory 的 server 版） ----------

/** 记忆抽取触发周期（每 N 章一次）：与 client generation-pipeline.MEMORY_EXTRACT_EVERY 同值同义 */
export const MEMORY_EXTRACT_EVERY = 3;

/**
 * 自动记忆抽取：用当前 LLM 通道对最新一章做结构化抽取（人物状态卡 + 新埋伏笔），
 * 锁内读-合并-直写 settings.characterState/foreshadows（并发防覆盖）。LLM 或落盘
 * 失败由调用方静默（不影响本章已入库）——client 版同语义。
 */
export async function extractAndStoreMemoryServer(
  workId: string,
  chapterText: string,
  chapterNumber: number,
  prefs: NovelGenPrefs,
): Promise<void> {
  let text = '';
  for await (const ev of runGenerate({
    source: prefs.source,
    model: prefs.model ?? '',
    stream: false,
    params: { max_tokens: 800, temperature: 0.2 },
    messages: [
      { role: 'system', content: MEMORY_EXTRACT_SYSTEM },
      { role: 'user', content: `【最新一章（第${chapterNumber}章）】\n${chapterText.slice(-6000)}` },
    ],
  })) {
    if (ev.kind === 'text') text += ev.text;
    if (ev.kind === 'error') return;
  }
  const parsed = parseMemoryExtract(text);
  if (!parsed) return;
  await withWorkLock(workId, async () => {
    const current = await readJson<Work>(workFile(workId));
    if (!current) return;
    const foreshadows = mergeForeshadows(current.settings.foreshadows, chapterNumber, parsed.foreshadows);
    const settings = { ...current.settings, characterState: parsed.characterState, foreshadows };
    await writeJsonAtomic(workFile(workId), { ...current, settings });
  });
}
