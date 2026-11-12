/**
 * 大纲分区（反馈：零章节也能聊全书大纲）：
 * - 「全书策划」：BookOutlineChat——聊世界观/主角/势力/大纲 → 确认一键写入「资料」，历史可回滚
 * - 「章节迭代」：OutlineIterChat——已有章节后逐章聊修改（正文写起来之后的主要用法）
 * 两个模式顶部切换；每本书会话独立持久化（localStorage 按 workId）。
 */
import { useState } from 'react';
import { Map, MessagesSquare, NotebookPen } from 'lucide-react';

import OutlineIterChat from '../plan/OutlineIterChat';
import BookOutlineChat from '../plan/BookOutlineChat';
import type { ChapterMsg } from './types';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

type OutlineMode = 'book' | 'chapter';

export function OutlinePane({
  work,
  chapters,
  onApplied,
  onDone,
  onGoWrite,
}: {
  work: Work;
  chapters: readonly ChapterMsg[];
  /** 全书策划应用到资料（宿主同步 workStore） */
  onApplied: (w: Work) => void;
  /** 章节新版本生成成功回调 */
  onDone: (msg: Message) => void;
  /** 全书策划应用成功后跳去写正文（宿主切分区） */
  onGoWrite?: () => void;
}) {
  const hasChapters = chapters.length > 0;
  const [mode, setMode] = useState<OutlineMode>(hasChapters ? 'chapter' : 'book');

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="outline-pane">
      {/* 模式切换 */}
      <div className="flex shrink-0 gap-1.5 px-4 pt-3">
        <button
          type="button"
          onClick={() => setMode('book')}
          data-testid="outline-mode-book"
          aria-pressed={mode === 'book'}
          className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border text-xs ${
            mode === 'book'
              ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
              : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
          }`}
        >
          <NotebookPen className="h-4 w-4" aria-hidden />
          全书策划
        </button>
        <button
          type="button"
          onClick={() => setMode('chapter')}
          data-testid="outline-mode-chapter"
          aria-pressed={mode === 'chapter'}
          disabled={!hasChapters}
          className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border text-xs disabled:opacity-40 ${
            mode === 'chapter'
              ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
              : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
          }`}
        >
          <MessagesSquare className="h-4 w-4" aria-hidden />
          章节迭代
        </button>
      </div>

      {mode === 'book' ? (
        <BookOutlineChat work={work} onApplied={onApplied} onGoWrite={onGoWrite} />
      ) : hasChapters ? (
        <OutlineIterChat work={work} chapters={chapters.map((msg) => ({ msg }))} onDone={onDone} />
      ) : (
        <div className="px-4 py-10 text-center">
          <Map className="mx-auto h-10 w-10 text-[hsl(var(--fg-muted))]" strokeWidth={1.5} aria-hidden />
          <p className="mt-3 text-sm font-medium">章节迭代</p>
          <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[hsl(var(--fg-muted))]">
            先用「全书策划」聊出大纲，或在「正文」写第一章——之后就能在这里逐章和助手聊修改。
          </p>
        </div>
      )}
    </div>
  );
}
