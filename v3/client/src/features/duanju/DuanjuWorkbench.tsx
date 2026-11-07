/**
 * 短剧工作台（共识 D3/D4）：分区 tab + 依赖解锁门 + 三端响应式一套代码
 *
 * 挂载点：桌面 /work/:id（WorkPage 分支）与移动 /m/work/:id（MobileWork 分支）。
 * tab：剧本 → 角色 → 场景 → 分镜 → 出图/导出；剧本定稿前下游锁定（D3）。
 */
import { useEffect, useState } from 'react';

import { useDuanjuStore } from './store';
import ScriptPane from './script/ScriptPane';
import CharactersPane from './characters/CharactersPane';
import ScenesPane from './scenes/ScenesPane';
import StoryboardPane from './storyboard/StoryboardPane';
import ExportPane from './export/ExportPane';

type TabId = 'script' | 'characters' | 'scenes' | 'storyboard' | 'export';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'script', label: '剧本' },
  { id: 'characters', label: '角色' },
  { id: 'scenes', label: '场景' },
  { id: 'storyboard', label: '分镜' },
  { id: 'export', label: '出图/导出' },
];

interface Props {
  workId: string;
  title: string;
  onBack: () => void;
}

export default function DuanjuWorkbench({ workId, title, onBack }: Props) {
  const { project, loading, loadError, load, conflict, clearConflict } = useDuanjuStore();
  const [tab, setTab] = useState<TabId>('script');

  useEffect(() => {
    void load(workId);
    return () => useDuanjuStore.getState().reset();
  }, [workId, load]);

  const scriptConfirmed = project?.script.confirmed ?? false;
  const locked = (id: TabId): string | null =>
    id === 'script' || scriptConfirmed ? null : '先在「剧本」tab 定稿后解锁';

  return (
    <div
      className="flex min-h-screen flex-col bg-[hsl(var(--bg))] text-[hsl(var(--fg))]"
      data-testid="duanju-workbench"
    >
      {/* 全局保存冲突条（深度测试 R3-5：角色/场景/分镜 tab 的保存失败原先无任何提示） */}
      {conflict && (
        <div
          className="flex items-center gap-2 bg-[hsl(var(--danger))]/10 px-3 py-2 text-xs text-[hsl(var(--danger))]"
          role="alert"
          data-testid="duanju-conflict-bar"
        >
          <span className="flex-1">保存失败：内容已在别处被修改（或网络异常），请刷新后重试</span>
          <button
            type="button"
            className="underline"
            onClick={() => {
              clearConflict();
              void load(workId);
            }}
          >
            刷新
          </button>
        </div>
      )}
      <header className="safe-top sticky top-0 z-20 flex flex-col gap-1 border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-2 py-2 sm:px-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 min-w-10 items-center justify-center rounded-lg text-sm hover:bg-[hsl(var(--bg))]"
            aria-label="返回书架"
          >
            ←
          </button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
            {title}
            {project && (
              <span className="ml-2 text-xs font-normal text-[hsl(var(--fg-muted))]">
                {project.style} · 目标 {project.targetEpisodes} 集
              </span>
            )}
          </h1>
        </div>
        <nav className="flex gap-1 overflow-x-auto" role="tablist" aria-label="短剧分区">
          {TABS.map((t) => {
            const lock = locked(t.id);
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                disabled={!!lock}
                title={lock ?? undefined}
                data-testid={`duanju-tab-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`h-9 shrink-0 rounded-lg px-3 text-sm transition-colors disabled:opacity-40 ${
                  tab === t.id
                    ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]'
                    : 'text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]'
                }`}
              >
                {t.label}
                {lock ? ' 🔒' : ''}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="min-h-0 flex-1">
        {loading && <p className="py-24 text-center text-sm text-[hsl(var(--fg-muted))]">加载中…</p>}
        {loadError && (
          <div className="flex flex-col items-center gap-3 py-24">
            <p className="text-sm text-[hsl(var(--fg-muted))]">短剧项目加载失败</p>
            <button
              type="button"
              onClick={() => void load(workId)}
              className="h-10 rounded-lg border border-[hsl(var(--border-soft))] px-5 text-sm"
            >
              重新加载
            </button>
          </div>
        )}
        {!loading && !loadError && project && (
          <>
            {tab === 'script' && <ScriptPane workId={workId} />}
            {tab === 'characters' && <CharactersPane workId={workId} />}
            {tab === 'scenes' && <ScenesPane workId={workId} />}
            {tab === 'storyboard' && <StoryboardPane workId={workId} />}
            {tab === 'export' && <ExportPane workId={workId} />}
          </>
        )}
      </main>
    </div>
  );
}
