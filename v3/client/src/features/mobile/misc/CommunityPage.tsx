/**
 * 沟通模式（/m/community，P3.2）：留言板 + 系统建议 + 想看的书
 *
 * - 三类 tab 筛选；登录用户可发言，作者可回复（行内回复框），删除=作者或本人
 * - 书名联想（想看的书）：MVP 纯文本，不做联想
 */
import { useEffect, useState } from 'react';

import { deleteEntry, listBoard, postEntry, replyEntry } from '../../../api/community';
import { useAuthStore } from '../../../stores/auth';
import type { BoardEntry, BoardType } from '@shared/community';

const TYPES: readonly BoardType[] = ['留言', '建议', '想看'];

function EntryCard({
  entry,
  isAuthor,
  myUid,
  onReply,
  onDelete,
}: {
  entry: BoardEntry;
  isAuthor: boolean;
  myUid: string;
  onReply: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <li className="m-book-card p-3 pl-4" data-testid={`board-entry-${entry.id}`}>
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className="rounded-full bg-[hsl(var(--accent))]/10 px-1.5 py-0.5 text-[10px] text-[hsl(var(--accent))]">{entry.type}</span>
        <span className="font-medium">{entry.author.name}</span>
        <span className="text-[10px] text-[hsl(var(--fg-muted))]">
          {new Date(entry.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
        {(isAuthor || entry.author.uid === myUid) && (
          <button type="button" onClick={() => onDelete(entry.id)} className="ml-auto text-[10px] text-[hsl(var(--fg-muted))] underline">
            删除
          </button>
        )}
      </div>
      <p className="text-sm leading-6">{entry.text}</p>
      {entry.reply && (
        <div className="mt-2 rounded-lg bg-[hsl(var(--bg))] p-2 text-xs leading-5">
          <span className="font-medium text-[hsl(var(--accent))]">作者回复：</span>
          {entry.reply.text}
        </div>
      )}
      {isAuthor && !entry.reply && !replying && (
        <button type="button" onClick={() => setReplying(true)} className="mt-2 text-xs text-[hsl(var(--accent))] underline">
          回复
        </button>
      )}
      {replying && (
        <div className="mt-2 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="回复内容"
            className="h-9 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs outline-none focus:border-[hsl(var(--accent))]"
          />
          <button
            type="button"
            onClick={() => {
              if (!draft.trim()) return;
              onReply(entry.id, draft.trim());
              setReplying(false);
            }}
            className="h-9 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs text-[hsl(var(--accent-fg))]"
          >
            发送
          </button>
        </div>
      )}
    </li>
  );
}

export default function CommunityPage() {
  const user = useAuthStore((s) => s.user);
  const [entries, setEntries] = useState<BoardEntry[] | null>(null);
  const [filter, setFilter] = useState<BoardType | '全部'>('全部');
  const [type, setType] = useState<BoardType>('留言');
  const [draft, setDraft] = useState('');

  function reload(): void {
    listBoard()
      .then(setEntries)
      .catch(() => setEntries([]));
  }
  useEffect(reload, []);

  const shown = (entries ?? []).filter((e) => filter === '全部' || e.type === filter);

  async function submit(): Promise<void> {
    if (!draft.trim()) return;
    try {
      const created = await postEntry(type, draft.trim());
      setEntries((es) => [created, ...(es ?? [])]);
      setDraft('');
    } catch {
      alert('发送失败，请重试');
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-4 pt-4">
      <div className="mb-3">
        <p className="m-serif text-[11px] tracking-[0.5em] text-[hsl(var(--fg-muted))]">書 房</p>
        <h1 className="m-serif mt-0.5 text-2xl font-semibold leading-tight">沟通</h1>
      </div>

      {/* 发言框 */}
      <div className="mb-4 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3">
        <div className="mb-2 flex gap-1.5">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`h-7 rounded-full border px-3 text-xs ${
                type === t
                  ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
                  : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void submit()}
            placeholder={type === '想看' ? '想看什么书？写给作者…' : type === '建议' ? '给作者的建议…' : '说点什么…'}
            data-testid="board-input"
            className="h-10 min-w-0 flex-1 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!draft.trim()}
            data-testid="board-send"
            className="h-10 shrink-0 rounded-xl bg-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>

      {/* 类型筛选 */}
      <div className="mb-2 flex gap-1.5">
        {(['全部', ...TYPES] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilter(t)}
            className={`h-7 rounded-full px-3 text-xs ${
              filter === t ? 'bg-[hsl(var(--fg-muted))]/15 font-medium' : 'text-[hsl(var(--fg-muted))]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {entries === null && <p className="py-12 text-center text-sm text-[hsl(var(--fg-muted))]">加载中…</p>}
      {entries?.length === 0 && <p className="py-12 text-center text-sm text-[hsl(var(--fg-muted))]">还没有留言，来说第一句吧</p>}
      <ul className="flex flex-col gap-2">
        {shown.map((e) => (
          <EntryCard
            key={e.id}
            entry={e}
            isAuthor={user?.role === 'author'}
            myUid={user?.id ?? ''}
            onReply={(id, text) => {
              void replyEntry(id, text)
                .then((updated) => setEntries((es) => (es ?? []).map((x) => (x.id === id ? updated : x))))
                .catch(() => alert('回复失败'));
            }}
            onDelete={(id) => {
              void deleteEntry(id)
                .then(() => setEntries((es) => (es ?? []).filter((x) => x.id !== id)))
                .catch(() => alert('删除失败'));
            }}
          />
        ))}
      </ul>
    </div>
  );
}
