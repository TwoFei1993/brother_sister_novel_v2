/**
 * 移动创作分区：版本（安卓 app Phase1 核心）
 *
 * 章节选择 → 版本列表（命名/来源/字数/时间/正文预览），支持：
 * - 切换激活版本（updateSwipe：本地 + PATCH，失败回滚）
 * - 🎲 重roll（同 directive 追加 AI 版本，自动命名 vN）
 * - 📝 生成新版本并手改（forkManualVersion：复制当前版本为「<基底>手改M」，随后正文分区编辑保存）
 * - 上架状态标记（publishedVersionId 对应版本显示「已上架」，上架管理 Phase1 后续任务接入）
 */
import { Dices, FileText, Trash2 } from 'lucide-react';
import { forkManualVersion } from '../../../hooks/generation-flow';
import { deleteMessage, patchMessage } from '../../../api/works';
import { useWorkStore } from '../../../stores/work';
import { chapterTitle } from '../../../lib/chapter-title';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';
import type { UseGenerateResult } from '../../../hooks/useGenerate';

import { ChapterChips } from './panes/ChapterChips';

type ChapterMsg = Message & { chapter: NonNullable<Message['chapter']> };
type Gen = Pick<UseGenerateResult, 'streaming' | 'swipeRegenerate'>;

export default function VersionsPane({
  work,
  messages,
  current,
  gen,
  onPick,
  onDone,
}: {
  work: Work;
  messages: readonly Message[];
  current: ChapterMsg | null;
  gen: Gen;
  onPick: (id: string) => void;
  onDone: (msg: Message | null) => void;
}) {
  async function reroll(): Promise<void> {
    if (!current || gen.streaming) return;
    onDone(await gen.swipeRegenerate(work, useWorkStore.getState().messages, current));
  }

  /** 🗑 删除本章（D3 同桌面语义）：确认后 DELETE，本地移除 */
  async function removeChapter(): Promise<void> {
    if (!current) return;
    if (!window.confirm(`确定删除 ${chapterTitle(current.chapter.index, current.chapter.title)}？不可恢复。`)) return;
    try {
      await deleteMessage(work.id, current.id);
      onPick('');
      useWorkStore.setState((st) => ({ messages: st.messages.filter((m) => m.id !== current.id) }));
    } catch {
      alert('删除失败，请重试');
    }
  }

  /** 复制当前版本为手改新版本并切为激活（正文分区可继续编辑保存） */
  async function forkManual(): Promise<void> {
    if (!current) return;
    const updated = forkManualVersion(current);
    useWorkStore.getState().upsertLocal(updated);
    try {
      await patchMessage(work.id, updated);
    } catch {
      console.warn('[MobileWork] 手改版本持久化失败，已回滚');
      useWorkStore.getState().upsertLocal(current);
    }
  }

  return (
    <div className="pb-4">
      <ChapterChips chapters={messages.filter((m): m is ChapterMsg => m.chapter !== undefined)} currentId={current?.id} onPick={onPick} />

      {gen.streaming && (
        <p className="flex items-center justify-center gap-1.5 py-3 text-xs text-[hsl(var(--accent))]" data-testid="versions-rerolling">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[hsl(var(--accent))]" />
          重roll生成中（完成后自动追加并切到新版本）…
        </p>
      )}

      {current && (
        <>
          <div className="mx-4 mb-2 flex gap-2">
            <button
              type="button"
              onClick={() => void removeChapter()}
              data-testid="mobile-delete-ch-btn"
              title="删除本章"
              className="flex h-9 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-red-400/40 text-xs text-red-400"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              删除
            </button>
            <button
              type="button"
              onClick={() => void reroll()}
              disabled={gen.streaming}
              title="同指令重写本章，追加新版本（旧版本保留）"
              data-testid="mobile-reroll-btn"
              className="flex h-9 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] text-xs disabled:opacity-40"
            >
              <Dices className="h-4 w-4" aria-hidden />
              重roll
            </button>
            <button
              type="button"
              onClick={() => void forkManual()}
              disabled={gen.streaming}
              title="生成新版本并手改（复制当前版本为手改副本并激活）"
              data-testid="mobile-fork-btn"
              className="flex h-9 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] text-xs disabled:opacity-40"
            >
              <FileText className="h-4 w-4" aria-hidden />
              手改
            </button>
          </div>

          <ul className="flex flex-col gap-2 px-4" data-testid="version-list">
            {current.swipes.map((v, i) => {
              const active = i === current.swipeId;
              const published = current.chapter.publishedVersionId === v.id;
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => void useWorkStore.getState().updateSwipe(current.id, i)}
                    data-testid={`version-item-${v.name}`}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/5'
                        : 'border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`m-serif font-medium ${active ? 'text-[hsl(var(--accent))]' : ''}`}>{v.name}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          v.origin === '手改'
                            ? 'bg-[hsl(var(--fg-muted))]/10 text-[hsl(var(--fg-muted))]'
                            : 'bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
                        }`}
                      >
                        {v.origin}
                      </span>
                      {published && (
                        <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                          已上架
                        </span>
                      )}
                      <span className="ml-auto text-[hsl(var(--fg-muted))]">
                        {v.content.length} 字 · {new Date(v.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[hsl(var(--fg-muted))]">{v.content}</p>
                    {active && <p className="mt-1 text-[10px] text-[hsl(var(--accent))]">当前版本（续写基于此）</p>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {!current && <p className="py-16 text-center text-sm text-[hsl(var(--fg-muted))]">还没有章节——去「正文」分区写第一章</p>}
    </div>
  );
}
