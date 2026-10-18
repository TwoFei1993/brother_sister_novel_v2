/**
 * 写作台视图路由（设计 §7.1）：按 mode/viewPreference 渲染主区 + 底部指挥条
 *
 * - chat：ChatWorkspace（固定对话视图）
 * - novel：C 工作台（WorkbenchView + useWorkbenchData 接线）/ A 对话流 / B 沉浸阅读；
 *   无章节且未生成时 EmptyGuide 引导（含备选开场上计）
 * - 指令复填闭环：C 侧栏点击指令 → directiveSeed → CommandBar 输入框（onSeedConsumed 复位）
 * - A 视图动作：swipe 切换 / 重roll / 正文编辑 / 指令重放（PATCH + 乐观回滚）
 */
import { useEffect, useState } from 'react';
import type { Message } from '@shared/message';
import type { Work, ViewPreference } from '@shared/work';

import { patchMessage, upsertMessage } from '../../api/works';
import { loadAssembleAssets } from '../../hooks/generation-pipeline';
import type { UseGenerateResult } from '../../hooks/useGenerate';
import { useWorkbenchData } from '../../hooks/useWorkbenchData';
import { useGenerationStore } from '../../stores/generation';
import { useWorkStore } from '../../stores/work';

import ChatWorkspace from '../chat/ChatWorkspace';
import WorkbenchView from './bench/WorkbenchView';
import CommandBar from './CommandBar';
import DialogView from './dialog/DialogView';
import ReadingView from './ReadingView';

/** 空态引导：无章节且未在生成时展示；含角色卡备选开场（alternate_greetings）一键入库 */
function EmptyGuide({ work, onCreated }: { work: Work; onCreated: (m: Message) => void }) {
  const [greetings, setGreetings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let alive = true;
    loadAssembleAssets(work)
      .then((a) => {
        if (alive) setGreetings(a.cards[0]?.data.alternate_greetings ?? []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [work]);

  async function importGreeting(text: string): Promise<void> {
    setImporting(true);
    const message: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      name: '小说家',
      content: text,
      createdAt: Date.now(),
      swipes: [text],
      swipeId: 0,
      chapter: { index: 1, title: '序章' },
      extra: {},
    };
    try {
      await upsertMessage(work.id, message);
      onCreated(message);
    } catch {
      console.warn('[WorkViewRouter] 备选开场上传失败');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center" data-testid="empty-guide">
      <p className="text-lg font-semibold">《{work.title}》</p>
      <p className="text-sm text-[hsl(var(--fg-muted))]">
        在下方输入剧情指令（可留空），点击「▶ 续写」开始创作第一章
      </p>
      {greetings.length > 0 && (
        <div className="mt-4 w-full max-w-md space-y-2">
          <p className="text-xs text-[hsl(var(--fg-muted))]">或使用角色卡备选开场：</p>
          {greetings.map((g, i) => (
            <button
              key={i}
              type="button"
              disabled={importing}
              onClick={() => importGreeting(g)}
              className="line-clamp-2 w-full rounded-lg border border-[hsl(var(--border-soft))] p-3 text-left text-xs transition-colors hover:border-[hsl(var(--accent))] disabled:opacity-40"
            >
              {g}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const wb = useWorkbenchData(work);
  /** C 侧栏指令复填：非 null 时 CommandBar 注入输入框（消费后复位） */
  const [directiveSeed, setDirectiveSeed] = useState<string | null>(null);

  const chapters = messages.filter(
    (m): m is Message & { chapter: NonNullable<Message['chapter']> } => m.chapter !== undefined,
  );
  const lastChapter = chapters.length > 0 ? chapters[chapters.length - 1] : null;
  const showReading = chapters.length > 0 || gen.streaming;

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

  /** A 视图：✏️ 编辑正文——写回当前候选位（swipe 切换恢复编辑后文本），PATCH 失败回滚 */
  async function handleEditContent(target: Message, content: string): Promise<void> {
    const updated: Message = {
      ...target,
      content,
      swipes: target.swipes.map((s, i) => (i === target.swipeId ? content : s)),
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

  // ---------- 渲染 ----------

  if (work.mode === 'chat') return <ChatWorkspace work={work} />;

  return (
    <>
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
            hasMore={hasMore}
            loadingOlder={loadingOlder}
            onNeedOlder={loadOlder}
            onSwipe={(messageId, delta) => void handleBubbleSwipe(messageId, delta)}
            onReroll={(m) => void handleReroll(m)}
            onEditContent={(m, content) => handleEditContent(m, content)}
            onReplay={(m, directive) => void handleReplay(m, directive)}
          />
        ) : (
          <ReadingView
            messages={messages}
            streaming={gen.streaming}
            buffer={gen.buffer}
            hasMore={hasMore}
            loadingOlder={loadingOlder}
            onNeedOlder={loadOlder}
          />
        )
      ) : (
        <EmptyGuide work={work} onCreated={upsertLocal} />
      )}

      <CommandBar
        streaming={gen.streaming}
        partialKept={gen.partialKept}
        canToggleSwipe={(lastChapter?.swipes.length ?? 0) > 1}
        swipePosition={lastChapter ? `${lastChapter.swipeId + 1}/${lastChapter.swipes.length}` : null}
        disabled={false}
        busy={gen.streaming}
        onGenerate={(d) => void handleGenerate(d)}
        onToggleSwipe={(d) => void handleToggleSwipe(d)}
        onContinue={() => void handleContinue()}
        onStop={gen.stop}
        seedText={directiveSeed}
        onSeedConsumed={() => setDirectiveSeed(null)}
      />
    </>
  );
}
