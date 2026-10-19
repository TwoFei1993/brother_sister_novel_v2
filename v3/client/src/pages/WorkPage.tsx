/**
 * 写作台页（/work/:id，设计 §7.1）——编排层
 *
 * - loadWork 拉作品 + 尾部 50 条消息（§4.6 默认窗口）；离开 reset
 * - 视图偏好：当前值 = 乐观覆盖 > work.viewPreference > 缺省 'b'；切换 PATCH 持久化（失败回滚）
 * - 顶栏：返回 / 作品名+章数 / 视图切换器（仅 novel；chat 固定对话视图）/ 停止 / 目录（仅 novel B）/ 设置
 * - 主区与底部指挥条委托 WorkViewRouter（novel A/B/C 分支 + chat 对话视图 + 指令复填闭环）
 * - 生成错误条（novel；chat 的错误在 ChatWorkspace 内呈现）
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { updateWork } from '../api/works';
import ChapterDrawer, { scrollToChapter } from '../features/workbench/ChapterDrawer';
import WorkSettingsSheet from '../features/workbench/WorkSettingsSheet';
import WorkViewRouter from '../features/workbench/WorkViewRouter';
import { useGenerate } from '../hooks/useGenerate';
import { useWorkTheme } from '../lib/theme';
import { useWorkStore } from '../stores/work';
import type { Message } from '@shared/message';
import type { ViewPreference } from '@shared/work';

/** 切换器 tab 定义（设计 §7.1：对话流 / 沉浸阅读 / 工作台；chat 模式不渲染） */
const VIEW_TABS: ReadonlyArray<{ id: ViewPreference; label: string; title: string }> = [
  { id: 'a', label: '💬', title: '对话流' },
  { id: 'b', label: '📖', title: '沉浸阅读' },
  { id: 'c', label: '🛠️', title: '工作台' },
];

/** 视图切换器（A/B/C 三 tab，顶栏；当前值持久化在 work.viewPreference） */
function ViewSwitcher({
  value,
  disabled,
  onChange,
}: {
  value: ViewPreference;
  disabled: boolean;
  onChange: (v: ViewPreference) => void;
}) {
  return (
    <div
      data-testid="view-switcher"
      role="tablist"
      aria-label="视图切换"
      className="flex shrink-0 items-center rounded-lg border border-[hsl(var(--border-soft))] p-0.5"
    >
      {VIEW_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          title={t.title}
          disabled={disabled}
          data-testid={`view-tab-${t.id}`}
          onClick={() => onChange(t.id)}
          className={`flex h-9 min-w-9 items-center justify-center rounded-md px-1.5 text-sm transition-colors disabled:opacity-40 ${
            value === t.id
              ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]'
              : 'text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function WorkPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { work, messages, loading, loadError, hasMore, loadingOlder, loadWork, loadOlder, setWork } =
    useWorkStore();
  const gen = useGenerate();
  // 题材→主题：作品挂载时按 genre 换肤，离开还原默认暗色基调（Task 32）
  useWorkTheme(work?.genre ?? 'hunhe');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 视图乐观切换覆盖值（PATCH 成功后清除，回落到 work.viewPreference 派生） */
  const [viewOverride, setViewOverride] = useState<ViewPreference | null>(null);

  useEffect(() => {
    if (id) void loadWork(id);
    return () => useWorkStore.getState().reset();
  }, [id, loadWork]);

  const chapters = messages.filter(
    (m): m is Message & { chapter: NonNullable<Message['chapter']> } => m.chapter !== undefined,
  );
  /** 当前视图：乐观覆盖值 > 服务端持久化值 > 缺省 B（移动端友好） */
  const currentView: ViewPreference = viewOverride ?? work?.viewPreference ?? 'b';

  /** 切换视图：乐观生效 + PATCH work 持久化（revision 乐观锁，失败回滚） */
  async function handleViewChange(v: ViewPreference): Promise<void> {
    if (!work || v === currentView) return;
    const prev = currentView;
    setViewOverride(v);
    try {
      const next = await updateWork(work.id, { revision: work.revision, viewPreference: v });
      setWork(next);
      setViewOverride(null);
    } catch {
      console.warn('[WorkPage] 视图偏好持久化失败，已回滚');
      setViewOverride(prev);
    }
  }

  const iconBtn =
    'flex h-10 min-w-10 items-center justify-center rounded-lg text-sm transition-colors hover:bg-[hsl(var(--surface))]';

  return (
    <div className="flex h-screen flex-col bg-[hsl(var(--bg))] text-[hsl(var(--fg))]">
      {/* 顶栏 */}
      <header className="safe-top flex items-center gap-1 border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-2 py-1.5 sm:px-4">
        <button type="button" onClick={() => navigate('/')} className={iconBtn} title="返回书架" aria-label="返回书架">
          ←
        </button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
          {work?.title ?? '…'}
          {chapters.length > 0 && (
            <span className="ml-2 text-xs font-normal text-[hsl(var(--fg-muted))]">共 {chapters.length} 章</span>
          )}
        </h1>
        {work && work.mode === 'novel' && (
          <ViewSwitcher value={currentView} disabled={loading || loadError} onChange={(v) => void handleViewChange(v)} />
        )}
        {gen.streaming && (
          <button
            type="button"
            onClick={gen.stop}
            data-testid="top-stop-btn"
            className={`${iconBtn} text-[hsl(var(--danger))]`}
            title="停止生成"
          >
            ⏹ 停止
          </button>
        )}
        {work && work.mode === 'novel' && currentView === 'b' && (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className={iconBtn}
            title="章节目录"
            aria-label="章节目录"
          >
            📖
          </button>
        )}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={iconBtn}
          title="作品设置"
          aria-label="作品设置"
        >
          ⚙
        </button>
      </header>

      {/* 错误条（novel 生成失败人话提示，半成品保留可「继续」；chat 错误在 ChatWorkspace 内）
          fixed 浮层 + z-[60]：高于作品设置面板（z-50），避免被遮挡无法点「知道了」 */}
      {gen.error && (
        <div className="fixed inset-x-0 top-0 z-[60] flex items-center gap-2 border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--danger))]/10 px-4 py-2 text-xs text-[hsl(var(--danger))] backdrop-blur-sm">
          <span className="min-w-0 flex-1">{gen.error.message}</span>
          <button type="button" onClick={gen.clearError} className="shrink-0 underline">
            知道了
          </button>
        </div>
      )}

      {/* 主区 */}
      <main className="flex min-h-0 flex-1 flex-col">
        {loading && <p className="flex-1 py-24 text-center text-sm text-[hsl(var(--fg-muted))]">作品加载中…</p>}
        {loadError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <p className="text-sm text-[hsl(var(--fg-muted))]">作品加载失败（可能已被删除）</p>
            <button
              type="button"
              onClick={() => id && void loadWork(id)}
              className="h-10 rounded-lg border border-[hsl(var(--border-soft))] px-5 text-sm hover:border-[hsl(var(--accent))]"
            >
              重新加载
            </button>
          </div>
        )}
        {!loading && !loadError && work && (
          <WorkViewRouter
            work={work}
            currentView={currentView}
            gen={gen}
            hasMore={hasMore}
            loadingOlder={loadingOlder}
            loadOlder={loadOlder}
          />
        )}
      </main>

      {drawerOpen && (
        <ChapterDrawer
          open
          onClose={() => setDrawerOpen(false)}
          chapters={chapters.map((m) => ({ index: m.chapter.index, title: m.chapter.title }))}
          onLocate={scrollToChapter}
        />
      )}
      {settingsOpen && work && (
        <WorkSettingsSheet work={work} onClose={() => setSettingsOpen(false)} onSaved={setWork} />
      )}
    </div>
  );
}
