/**
 * server 端组装（M2 Task 3.1）：scanAndAssemble 全流程移植（client
 * generation-pipeline.ts :223-369 逐点对齐，D5 不允许语义漂移）。
 *
 * 纯内核全从 @shared 引（scanWorldInfo/assemblePrompt/planContext/novelGuardPlan/
 * buildFallbackPreset/pickChapterRequirement/recallBlock/skeletonBlock/outline
 * directives/NEW_ASSETS_HINT/countTokensApprox/nextChapterIndex）；IO 缝 server 本地：
 * 1. tokenize = services/tokenize.countTokens（client 走 /api/tokenize HTTP，server
 *    直调同一实现，消息拼接语义与该路由一致：contents join('\n')）；
 * 2. 摘要 LLM 与摘要落库 = helpers.ts（runGenerate 非流式 + work.json 锁内读-改-写）；
 * 3. 全局变量 = 调用方读 data/config.json 传入快照（server 无内存 store）。
 */
import type { Message } from '@shared/message';
import type { TavernPreset } from '@shared/tavern';
import type { PresetAsset } from '@shared/preset';
import type { Work } from '@shared/work';
import { DEFAULT_TARGET_CHAPTER_WORDS } from '@shared/work';
import type { MacroEnv } from '@shared/engine/types';
import { assemblePrompt } from '@shared/engine/prompt/assemble';
import type {
  AssembleTail,
  FittedPrompt,
  GenerateMessage,
  SummarizePrefs,
} from '@shared/engine/prompt/context-plan';
import {
  buildFallbackPreset,
  novelGuardPlan,
  planContext,
  SCAN_SETTINGS,
} from '@shared/engine/prompt/context-plan';
import { pickChapterRequirement, type StyleBits } from '@shared/engine/prompt/novel/requirements';
import { NEW_ASSETS_HINT } from '@shared/engine/prompt/novel/new-assets';
import { chapterOutlineDirective, volumeOutlineDirective } from '@shared/lib/outline/chapters';
import { recallBlock } from '@shared/lib/recall';
import { skeletonBlock } from '@shared/lib/skeleton';
import { scanWorldInfo } from '@shared/engine/worldbook';
import { nextChapterIndex } from '@shared/hooks/generation-flow';

import { countTokens } from '../tokenize';

import { readAsset, type AssembleAssets } from './assets';
import { persistRollingSummary, summarizeDropped } from './helpers';

/**
 * server 端 novel-gen 生成偏好：shared SummarizePrefs（组装相关 {source/model/maxContext/maxTokens}）
 * + Task 1.1 prefsSchema 的采样/思考/润色字段（与 client stores/settings LlmPrefs 正文生成相关
 * 字段一一对应；runner 传入的 z.infer<prefsSchema> 天然满足本结构）。
 */
export type NovelGenPrefs = SummarizePrefs & {
  temperature?: number;
  thinking?: boolean;
  polishModel?: string;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
};

// ---- 宏环境 ----

/** 变量待写集合（{{setvar}} 的引擎外持久化暂存，finalize 阶段回写） */
export interface PendingVars {
  work: Map<string, string>;
  global: Map<string, string>;
}

/** 宏环境（§5.1③）：user=「作者」、char=主卡名或「小说家」；work 级变量读 work.settings，
 *  global 级读调用方传入的 config 快照（server 无内存 store），写进暂存 */
export function buildMacroEnv(
  work: Work,
  primaryCharName: string | undefined,
  pending: PendingVars,
  globals?: Record<string, unknown>,
): MacroEnv {
  return {
    user: '作者',
    char: primaryCharName || '小说家',
    getVar: (name, scope) => {
      if (scope === 'global') {
        const v = globals?.[name];
        return typeof v === 'string' ? v : undefined;
      }
      return work.settings.variables?.[name];
    },
    setVar: (name, value, scope) => {
      (scope === 'global' ? pending.global : pending.work).set(name, value);
    },
    scope: 'work',
  };
}

// ---- 附加预设合并 ----

/**
 * 按风格挂载的附加预设（stylePresetIds）合并进主预设栈（用户需求：通用预设常驻 +
 * 风格预设按需）：附加预设的每个 prompt 追加到主栈尾部，identifier 前缀唯一化防冲突；
 * enabled 跟随附加预设自身 prompt_order，主栈顺序不被打乱（附加块贴近生成点生效）。
 * 任一附加预设读取失败静默跳过（不影响主预设生成）。合并逻辑逐行对照 client 版。
 */
export async function mergeStylePresets(
  work: Work,
  base: TavernPreset,
  _prefs: NovelGenPrefs,
): Promise<TavernPreset> {
  const ids = work.settings.stylePresetIds ?? [];
  if (ids.length === 0) return base;
  const extras = await Promise.all(ids.map((presetId) => readAsset<PresetAsset>('presets', presetId)));
  const prompts = [...base.prompts];
  const baseOrder = base.prompt_order?.[0]?.order ?? [];
  const order = [...baseOrder];
  for (const asset of extras) {
    if (!asset) continue;
    const list = asset.raw.prompt_order?.[0]?.order ?? [];
    for (const entry of list) {
      const src = asset.raw.prompts.find((x) => x.identifier === entry.identifier);
      if (!src || !src.content?.trim()) continue;
      const uid = `sty${asset.id.slice(0, 6)}-${src.identifier}`;
      if (order.some((o) => o.identifier === uid)) continue;
      prompts.push({ ...src, identifier: uid });
      order.push({ identifier: uid, enabled: entry.enabled });
    }
  }
  return { ...base, prompts, prompt_order: [{ character_id: 100001, order }] };
}

// ---- 组装主流程 ----

/** 世界书扫描 + 总装 + tokenize 预算校验（§5.4：超预算按比例多截历史再组装）。
 *  全流程对照 client generation-pipeline.scanAndAssemble，仅 IO 缝不同（见文件头）。 */
export async function scanAndAssemble(
  work: Work,
  messages: Message[],
  tail: AssembleTail,
  assets: AssembleAssets,
  env: MacroEnv,
  prefs: NovelGenPrefs,
): Promise<FittedPrompt> {
  const scan = scanWorldInfo({
    books: assets.worldbooks,
    // 扫描池 = 本轮注入文本（最新，必扫）+ 历史消息（最近的在前，与酒馆扫描深度语义一致）
    chatTexts: [tail.text, ...[...messages].reverse().map((m) => m.content)].filter(Boolean),
    settings: SCAN_SETTINGS,
    macroEnv: env,
  });
  // 预算默认拉满（M3 百万级上下文；过小预算会截掉前文致续写脱节，用户显式设置仍优先）
  const maxContext = prefs.maxContext ?? 65536;
  const maxTokens = prefs.maxTokens ?? 8192;
  const budget = Math.max(0, maxContext - maxTokens);

  // 防失忆（§5.3 滚动摘要）：预算切出的最旧部分压缩成摘要注入（增量游标 summaryUpTo 防重复）
  const plan = planContext(messages, budget);
  let summary = work.settings.rollingSummary;
  if (plan.dropped.length > 0 && (work.settings.summaryUpTo ?? 0) < plan.dropped.length) {
    const fresh = await summarizeDropped(prefs, summary, plan.dropped.map((m) => m.content));
    if (fresh !== null) {
      summary = fresh;
      // best-effort 持久化（失败仅影响本次组装的磁盘态，摘要照常注入）
      await persistRollingSummary(work.id, fresh, plan.dropped.length);
    }
  }

  let history = plan.kept;
  const targetWords = work.settings.targetChapterWords ?? DEFAULT_TARGET_CHAPTER_WORDS; // 兜底主提示词与末尾写作要求共用
  // 基调与文风执行位（用户反馈①）：解析作品设置的基调/文风为写法级指令，注入要求块最前（最高优先级）
  const WRITING_STYLE_LABEL: Record<string, string> = {
    qidian: '起点风：爽点前置、节奏明快、句子利落',
    jjwxc: '晋江风：情感细腻、人物张力足、心理刻画绵密',
    fanqie: '番茄风：强钩子、快节奏、段落短',
  };
  const styleBits: StyleBits = {
    tones: [...work.settings.storyTones, work.settings.customStoryTone].filter(Boolean),
    style:
      (work.settings.customWritingStyle || '').trim() ||
      WRITING_STYLE_LABEL[work.settings.writingStyle] ||
      '',
  };
  // 章节大纲联动（一键导入大纲）：第 N 章有预设大纲时 directive 末尾追加本章要点（仅进提示词）
  const outlineHint =
    tail.kind === 'directive'
      ? chapterOutlineDirective(work.settings.chapterOutlines, nextChapterIndex(messages))
      : '';
  // 分卷规划联动（卷规划层）：第 N 章按 startChapter 定位所属卷，追加本卷主线（仅进提示词）
  const volumeHint =
    tail.kind === 'directive'
      ? volumeOutlineDirective(work.settings.volumeOutlines, nextChapterIndex(messages))
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
  // 按风格挂载的附加预设合并进主预设栈（附加块贴近生成点生效）
  const basePreset = assets.preset ?? buildFallbackPreset(tail.kind, work.settings.chatReplyLength ?? 'medium', targetWords);
  const preset = await mergeStylePresets(work, basePreset, prefs);
  // 输出守卫（novel）在 tokenize 校验之后追加：预算需预留其开销；
  // 续写轮用「无缝续写」守卫变体（反馈③：常规守卫的「第一行输出标题」会诱发模型重新开章）
  const guardPlan =
    tail.kind === 'directive'
      ? novelGuardPlan(targetWords, tail.continuation === true)
      : { allowance: 0, withGuard: (msgs: GenerateMessage[]): GenerateMessage[] => msgs };
  for (;;) {
    const result = assemblePrompt({
      preset,
      cards: assets.cards,
      bios: assets.bios, // 人物小传（作者手写）随卡注入人设块
      // §4.4 卡覆盖预设开关：作品级设置，缺省视为开（与酒馆一致）
      allowCardOverride: work.allowCardOverride !== false,
      worldbookScan: scan,
      workSettings: work.settings,
      ...(summary ? { summary } : {}),
      history,
      ...(tail.kind === 'directive'
        ? {
            // NEW_ASSETS_HINT 仅在有真实指令的章追加：空指令（⚡连写推进章）保持纯净
            directive: tail.text + volumeHint + outlineHint + recallHint + skeletonHint + (tail.text ? NEW_ASSETS_HINT : ''),
            // 要求块选择：续写轮「无缝续写」变体 > 扩写轮「本章加长」变体 > 常规轮
            chapterRequirement: pickChapterRequirement({
              continuation: tail.continuation,
              expandChapter: tail.expandChapter,
              segment: tail.segment,
              continueRemaining: tail.continueRemaining,
              targetWords,
              progress: {
                chapter: nextChapterIndex(messages),
                total: work.settings.desiredChapterCount,
              },
              styleBits,
            }),
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
    // server IO 缝：直调本地 tokenize（client 版走 /api/tokenize HTTP；该路由对
    // messages 入参的语义 = contents join('\n')，此处直调等价）
    const { count } = await countTokens(prefs.source, prefs.model || undefined, assembled.map((m) => m.content).join('\n'));
    if (count <= budget - guardPlan.allowance) {
      return { messages: guardPlan.withGuard(assembled), promptTokens: count, truncated: result.usage.truncated, activatedIds: result.activatedIds };
    }
    // 超预算：按超量比例估算截断条数（至少 1 条），截掉最旧后重新组装校验
    const perMsg = count / Math.max(1, assembled.length);
    const drop = Math.min(history.length, Math.max(1, Math.ceil((count - budget) / perMsg)));
    history = history.slice(drop);
  }
}
