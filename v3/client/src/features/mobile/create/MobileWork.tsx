/**
 * 移动创作中（/m/work/:id）：正文 / 大纲 / 版本 / 资料 四分区，底部子 tab 切换（共识 D6）
 *
 * 数据与生成完全复用桌面层：useWorkStore（loadWork/消息流）+ useGenerate（生成编排）；
 * 本组件只做移动装配与导航，分区实现见同目录 WorkPanes / WorkVersions。
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { patchMessage } from '../../../api/works';
import { useGenerate } from '../../../hooks/useGenerate';
import { useWorkStore } from '../../../stores/work';
import type { Message } from '@shared/message';

import SelectionTools from '../../workbench/SelectionTools';
import PublishPanel from './PublishPanel';
import { OutlinePane, TextPane, AssetsPane } from './WorkPanes';
import VersionsPane from './WorkVersions';

type PaneId = 'text' | 'outline' | 'versions' | 'assets';

const PANES: ReadonlyArray<{ id: PaneId; label: string }> = [
  { id: 'text', label: '正文' },
  { id: 'outline', label: '大纲' },
  { id: 'versions', label: '版本' },
  { id: 'assets', label: '资料' },
];

export default function MobileWork() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { work, messages, loading, loadError, loadWork, upsertLocal } = useWorkStore();
  const gen = useGenerate();
  const [pane, setPane] = useState<PaneId>('text');
  /** 当前编辑的章节消息（正文/版本分区共享；null=自动取最后一章） */
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  useEffect(() => {
    if (id) void loadWork(id);
    return () => useWorkStore.getState().reset();
  }, [id, loadWork]);

  const chapters = messages.filter(
    (m): m is Message & { chapter: NonNullable<Message['chapter']> } => m.chapter !== undefined,
  );
  const current = chapters.find((c) => c.id === chapterId) ?? chapters.at(-1) ?? null;
  const done = (msg: Message | null): void => {
    if (msg) upsertLocal(msg);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mobile-work">
      {/* 顶栏：返回 / 书名+章数 / 停止 */}
      <header className="safe-top flex shrink-0 items-center gap-1 border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-2 py-2">
        <button
          type="button"
          onClick={() => navigate('/m/create')}
          className="flex h-9 min-w-9 items-center justify-center rounded-lg text-sm hover:bg-[hsl(var(--surface))]"
          aria-label="返回书架"
        >
          ←
        </button>
        <h1 className="m-serif min-w-0 flex-1 truncate text-[15px] font-semibold">
          {work?.title ?? '…'}
          {chapters.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-[hsl(var(--fg-muted))]">{chapters.length} 章</span>
          )}
        </h1>
        <button
          type="button"
          onClick={() => setPublishOpen(true)}
          disabled={chapters.length === 0}
          data-testid="publish-open-btn"
          className="h-9 rounded-lg px-3 text-xs text-[hsl(var(--accent))] disabled:opacity-40"
        >
          ⇪ 上架
        </button>
        {gen.streaming && (
          <button
            type="button"
            onClick={gen.stop}
            className="h-9 rounded-lg px-3 text-xs text-[hsl(var(--danger))]"
            data-testid="mobile-stop-btn"
          >
            ⏹ 停止
          </button>
        )}
      </header>

      {loading && <p className="flex-1 py-24 text-center text-sm text-[hsl(var(--fg-muted))]">作品加载中…</p>}
      {loadError && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-[hsl(var(--fg-muted))]">作品加载失败（可能已被删除）</p>
          <button
            type="button"
            onClick={() => id && void loadWork(id)}
            className="h-10 rounded-lg border border-[hsl(var(--border-soft))] px-5 text-sm"
          >
            重新加载
          </button>
        </div>
      )}

      {!loading && !loadError && work && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {pane === 'text' && (
              <TextPane work={work} chapters={chapters} current={current} gen={gen} onPick={setChapterId} onDone={done} />
            )}
            {pane === 'outline' && (
              <OutlinePane
                work={work}
                chapters={chapters}
                onDone={(msg) => {
                  upsertLocal(msg);
                  setChapterId(msg.id);
                  setPane('versions');
                }}
              />
            )}
            {pane === 'versions' && (
              <VersionsPane
                work={work}
                messages={messages}
                current={current}
                gen={gen}
                onPick={setChapterId}
                onDone={done}
              />
            )}
            {pane === 'assets' && <AssetsPane work={work} nextIndex={chapters.length + 1} />}
          </div>
          {/* 选段 AI 工具（润色/扩写/重写）：与桌面同源组件，应用后 PATCH 幂等覆盖（失败回滚） */}
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
              void patchMessage(work.id, updated).catch(() => store.upsertLocal(m));
            }}
          />

          {publishOpen && <PublishPanel chapters={chapters} onClose={() => setPublishOpen(false)} />}

          {/* 分区切换（固定底部，位于移动壳 tab 之上；衬线 + 印点） */}
          <nav
            role="tablist"
            aria-label="创作分区"
            className="safe-bottom flex shrink-0 border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]"
          >
            {PANES.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={pane === p.id}
                data-testid={`pane-${p.id}`}
                data-active={pane === p.id ? 'true' : 'false'}
                onClick={() => setPane(p.id)}
                className={`m-tab m-serif flex-1 py-2.5 text-[13px] transition-colors ${
                  pane === p.id ? 'font-medium text-[hsl(var(--accent))]' : 'text-[hsl(var(--fg-muted))]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}
