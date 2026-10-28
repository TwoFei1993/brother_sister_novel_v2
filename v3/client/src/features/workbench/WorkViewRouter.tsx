/**
 * 写作台视图路由（设计 §7.1）：按 mode/viewPreference 渲染主区 + 底部指挥条
 *
 * - chat：ChatWorkspace（固定对话视图）
 * - novel：C 工作台（WorkbenchView + useWorkbenchData 接线）/ A 对话流 / B 沉浸阅读；
 *   无章节且未生成时 EmptyGuide 引导（含备选开场上计）
 * - 指令复填闭环：C 侧栏点击指令 → directiveSeed → CommandBar 输入框（onSeedConsumed 复位）
 * - A 视图动作：swipe 切换 / 重roll / 正文编辑 / 指令重放（PATCH + 乐观回滚）
 */
import { useEffect, useMemo, useState } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import type { Message } from '@shared/message';
import type { TavernRegexScript } from '@shared/tavern';
import type { Work, ViewPreference } from '@shared/work';

import { patchMessage } from '../../api/works';
import { exportTxt } from '../../lib/export';
import { batchProgressText } from '../../hooks/generation-flow';
import { loadRegexScripts } from '../../hooks/generation-pipeline';
import type { UseGenerateResult } from '../../hooks/useGenerate';
import { useWorkbenchData } from '../../hooks/useWorkbenchData';
import { useGenerationStore } from '../../stores/generation';
import { useWorkStore } from '../../stores/work';

import ChatWorkspace from '../chat/ChatWorkspace';
import EmptyGuide from './bench/EmptyGuide';
import WorkbenchView from './bench/WorkbenchView';
import CommandBar from './CommandBar';
import SelectionTools from './SelectionTools';
import DialogView from './dialog/DialogView';
import ReadingView from './ReadingView';
import WorkTtsBar from '../tts/WorkTtsBar';

export interface WorkViewRouterProps {
  work: Work;
  /** 当前视图（WorkPage 顶栏切换器派生：乐观覆盖 > 持久化 > 缺省 B） */
  currentView: ViewPreference;
  gen: UseGenerateResult;
  hasMore: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
}

export default function WorkViewRouter({ work, currentView, gen, hasMore, loadingOlder, loadOlder }: WorkViewRouterProps) {
  const messages = useWorkStore((s) => s.messages);
  const upsertLocal = useWorkStore((s) => s.upsertLocal);
  /** 思考流缓冲（B 阅读视图正文上方滚动显示；A/C 视图不显示） */
  const thinkingBuffer = useGenerationStore((s) => s.thinkingBuffer);
  const wb = useWorkbenchData(work);
  /** C 侧栏指令复填：非 null 时 CommandBar 注入输入框（消费后复位） */
  const [directiveSeed, setDirectiveSeed] = useState<string | null>(null);
  /** 显示轨正则脚本（markdownOnly，§5.1②）：work 绑定资产，A/B 视图渲染前应用 */
  const [regexScripts, setRegexScripts] = useState<TavernRegexScript[]>([]);

  useEffect(() => {
    let alive = true;
    loadRegexScripts(work)
      .then((list) => {
        if (alive) setRegexScripts(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [work]);

  const chapters = messages.filter(
    (m): m is Message & { chapter: NonNullable<Message['chapter']> } => m.chapter !== undefined,
  );
  const lastChapter = chapters.length > 0 ? chapters[chapters.length - 1] : null;
  /** 长上下文质量警示：按「作品+章节数」记 sessionStorage——同数量不再打扰，章节数变化才重新提醒 */
  const driftSeenKey = `drift-warn-seen:${work.id}:${chapters.length}`;
  const [driftWarnDismissed, setDriftWarnDismissed] = useState(
    () => sessionStorage.getItem(driftSeenKey) !== null,
  );

  function dismissDriftWarn(): void {
    setDriftWarnDismissed(true);
    try {
      sessionStorage.setItem(driftSeenKey, '1');
    } catch {
      /* 隐私模式等场景静默 */
    }
  }

  /** 章节数增长（key 变化）时按新 key 重算：未关闭过的新数量提醒重新出现 */
  useEffect(() => {
    setDriftWarnDismissed(sessionStorage.getItem(driftSeenKey) !== null);
  }, [driftSeenKey]);
  const showReading = chapters.length > 0 || gen.streaming;
  /** TTS 连播队列：按章号升序（与 ReadingView 渲染序同源，队列下标=渲染下标，供高亮对齐） */
  const ttsChapters = useMemo(
    () =>
      [...chapters]
        .sort((a, b) => a.chapter.index - b.chapter.index)
        .map((m) => ({ text: m.content, directive: m.directive, voiceMap: work.voiceMap })),
    [chapters, work.voiceMap],
  );

  // ---------- novel 生成动作（CommandBar） ----------

  async function handleGenerate(directive: string): Promise<void> {
    const msg = await gen.generateChapter(work, messages, directive);
    if (msg) upsertLocal(msg);
  }

  async function handleContinue(): Promise<void> {
    const partial = useGenerationStore.getState().buffer;
    const msg = await gen.continueFromPartial(work, messages, partial);
    if (msg) upsertLocal(msg);
  }

  /** 🎲换一支：多候选 ◀▶ 切换（PATCH）；仅一支时同指令重生成（追加候选） */
  async function handleToggleSwipe(delta: 1 | -1): Promise<void> {
    if (lastChapter && lastChapter.swipes.length > 1) {
      const n = lastChapter.swipes.length;
      await useWorkStore.getState().updateSwipe(lastChapter.id, (lastChapter.swipeId + delta + n) % n);
      return;
    }
    if (lastChapter && !gen.streaming) {
      const msg = await gen.swipeRegenerate(work, messages, lastChapter);
      if (msg) upsertLocal(msg);
    }
  }

  /** 🎲 恒为重roll：对最后一章同指令追加新候选（多候选时也可用，与 ◀▶ 切换互补） */
  async function handleRerollLast(): Promise<void> {
    if (gen.streaming || !lastChapter) return;
    const msg = await gen.swipeRegenerate(work, useWorkStore.getState().messages, lastChapter);
    if (msg) upsertLocal(msg);
  }

  // ---------- A 对话流视图（DialogView）动作 ----------

  /** A 视图：任意章节 ◀▶ 切候选（updateSwipe 本地 + PATCH，失败回滚在 store 内） */
  async function handleBubbleSwipe(messageId: string, delta: 1 | -1): Promise<void> {
    if (gen.streaming) return;
    const m = useWorkStore.getState().messages.find((x) => x.id === messageId);
    if (!m || m.swipes.length < 2) return;
    const n = m.swipes.length;
    await useWorkStore.getState().updateSwipe(messageId, (m.swipeId + delta + n) % n);
  }

  /** A 视图：↻ 重roll——同 directive 重生成该章，候选追加（swipeTarget 路径） */
  async function handleReroll(target: Message): Promise<void> {
    if (gen.streaming) return;
    const msg = await gen.swipeRegenerate(work, messages, target);
    if (msg) upsertLocal(msg);
  }

  /** A 视图：✏️ 编辑正文——写回当前版本（版本切换恢复编辑后文本），PATCH 失败回滚 */
  async function handleEditContent(target: Message, content: string): Promise<void> {
    const updated: Message = {
      ...target,
      content,
      swipes: target.swipes.map((v, i) => (i === target.swipeId ? { ...v, content } : v)),
    };
    upsertLocal(updated);
    try {
      await patchMessage(work.id, updated);
    } catch {
      console.warn('[WorkViewRouter] 正文编辑持久化失败，已回滚');
      upsertLocal(target);
    }
  }

  /** A 视图：指令重放——directive 变更先 PATCH（last-write-wins），再对目标章节 swipeRegenerate 追加候选 */
  async function handleReplay(target: Message, directive: string): Promise<void> {
    if (gen.streaming) return;
    let updated = target;
    if ((target.directive ?? '') !== directive) {
      updated = { ...target, directive };
      upsertLocal(updated);
      try {
        await patchMessage(work.id, updated);
      } catch {
        console.warn('[WorkViewRouter] 指令更新持久化失败，已回滚');
        upsertLocal(target);
        return;
      }
    }
    const msg = await gen.swipeRegenerate(work, useWorkStore.getState().messages, updated);
    if (msg) upsertLocal(msg);
  }

  /** A 视图：🗑 删除本章（D3）——store 乐观移除 + DELETE 持久化 + stats 回拉；失败已在 store 回滚 */
  async function handleDeleteMessage(target: Message): Promise<boolean> {
    if (gen.streaming) return false;
    return useWorkStore.getState().removeMessage(target.id);
  }

  // ---------- 渲染 ----------

  if (work.mode === 'chat') return <ChatWorkspace work={work} />;

  return (
    <>
      {/* 上下文截断提示（生成完成入库后由 useGenerate 记录；⚠ 手动可关） */}
      {gen.lastTruncated && (
        <div
          role="status"
          data-testid="context-truncated-tip"
          className="flex items-center gap-2 border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--danger))]/10 px-3 py-2 text-xs text-[hsl(var(--danger))]"
        >
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            上下文预算不足，最旧章节已被截断——可在 设置→生成参数 调大「上下文预算」
          </span>
          <button
            type="button"
            aria-label="关闭提示"
            data-testid="truncated-tip-close"
            onClick={gen.clearTruncated}
            className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded hover:bg-[hsl(var(--danger))]/20"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
      {currentView === 'c' ? (
        <WorkbenchView
          messages={messages}
          streaming={gen.streaming}
          buffer={gen.buffer}
          hasMore={hasMore}
          loadingOlder={loadingOlder}
          onNeedOlder={loadOlder}
          entryIndex={wb.entryIndex}
          quickDirectives={wb.quickDirectives}
          onPickDirective={setDirectiveSeed}
          onAddQuickDirective={(t) => void wb.addQuickDirective(t)}
          onRemoveQuickDirective={(i) => void wb.removeQuickDirective(i)}
        />
      ) : showReading ? (
        currentView === 'a' ? (
          <DialogView
            messages={messages}
            streaming={gen.streaming}
            buffer={gen.buffer}
            targetMessageId={gen.targetMessageId}
            regexScripts={regexScripts}
            hasMore={hasMore}
            loadingOlder={loadingOlder}
            onNeedOlder={loadOlder}
            onSwipe={(messageId, delta) => void handleBubbleSwipe(messageId, delta)}
            onReroll={(m) => void handleReroll(m)}
            onEditContent={(m, content) => handleEditContent(m, content)}
            onReplay={(m, directive) => void handleReplay(m, directive)}
            onDeleteMessage={(m) => handleDeleteMessage(m)}
          />
        ) : (
          <ReadingView
            messages={messages}
            streaming={gen.streaming}
            buffer={gen.buffer}
            thinking={thinkingBuffer}
            regexScripts={regexScripts}
            hasMore={hasMore}
            loadingOlder={loadingOlder}
            onNeedOlder={loadOlder}
            onExportTxt={() =>
              exportTxt(
                work.title,
                [...chapters]
                  .sort((a, b) => a.chapter.index - b.chapter.index)
                  .map((m) => ({ title: m.chapter.title, content: m.content })),
              )
            }
          />
        )
      ) : (
        <EmptyGuide work={work} onCreated={upsertLocal} />
      )}

      {/* novel TTS 听书条（引擎常驻；A/B/C 三视图均显示，写作时也能随时听书；高亮由 ReadingView 读 tts store） */}
      {work.mode === 'novel' && <WorkTtsBar work={work} chapters={ttsChapters} />}

      {/* 选段 AI 工具（润色/扩写/重写）：novel 模式挂载，应用后 PATCH 幂等覆盖（失败回滚本地） */}
      {work.mode === 'novel' && (
        <SelectionTools
          getTarget={(sel) => {
            for (const m of useWorkStore.getState().messages) {
              if (m.content.includes(sel)) return { messageId: m.id, content: m.content };
            }
            return null;
          }}
          onApplied={(messageId, nextContent) => {
            const store = useWorkStore.getState();
            const m = store.messages.find((x) => x.id === messageId);
            if (!m) return;
            const updated: Message = {
              ...m,
              content: nextContent,
              swipes: m.swipes.map((v, i) => (i === m.swipeId ? { ...v, content: nextContent } : v)),
            };
            store.upsertLocal(updated);
            void patchMessage(work.id, updated).catch(() => store.upsertLocal(m)); // 持久化失败回滚本地
          }}
        />
      )}

      {/* 长上下文质量警示（深度测试实测：累积 6 章起出现句式重复/节奏退化，可手动关闭） */}
      {work.mode === 'novel' && chapters.length >= 6 && !driftWarnDismissed && (
        <div
          role="status"
          data-testid="drift-warning"
          className="flex items-center gap-2 border-t border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400"
        >
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            已累积 {chapters.length} 章：实测长上下文连续生成可能出现质量退化（句式重复、节奏拖沓）。建议分卷创作或对单章「换一支」对比。
          </span>
          <button
            type="button"
            aria-label="关闭警示"
            data-testid="drift-warning-close"
            onClick={dismissDriftWarn}
            className="flex shrink-0 items-center rounded px-1 hover:bg-amber-500/20"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      <CommandBar
        streaming={gen.streaming}
        partialKept={gen.partialKept}
        canToggleSwipe={(lastChapter?.swipes.length ?? 0) > 1}
        swipePosition={lastChapter ? `${lastChapter.swipeId + 1}/${lastChapter.swipes.length}` : null}
        disabled={false}
        busy={gen.streaming}
        batchProgress={gen.batch ? batchProgressText(gen.batch) : null}
        canOutline={(work.settings.chapterOutlines?.length ?? 0) > 0}
        onGenerate={(d) => void handleGenerate(d)}
        onBatch={(d) => void gen.runBatch(work, d)}
        onByOutline={(limit?: number) => void gen.runByOutline(work, messages, limit)}
        onToggleSwipe={(d) => void handleToggleSwipe(d)}
        onRerollLast={() => void handleRerollLast()}
        onContinue={() => void handleContinue()}
        onStop={gen.stop}
        seedText={directiveSeed}
        onSeedConsumed={() => setDirectiveSeed(null)}
      />
    </>
  );
}
