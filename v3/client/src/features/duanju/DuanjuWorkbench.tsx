/**
 * 短剧工作台（共识 D3/D4）：分区 tab + 依赖解锁门 + 三端响应式一套代码
 *
 * 挂载点：桌面 /work/:id（WorkPage 分支）与移动 /m/work/:id（MobileWork 分支）。
 * tab：剧本 → 角色 → 场景 → 分镜 → 出图/导出 → 资产库 → 试验；剧本定稿前下游锁定（D3）。
 *
 * 2026-11-26（设计共识 D7 / 3.6 / 3.7）：
 * - 分区按「作品数据存在」渲染，不随数据刷新卸载重挂（此前每次刷新都卸载，编辑中的内容会丢）
 * - 首次加载失败显示错误页；刷新失败保留分区并提示
 * - 流水线进度条挂在顶栏下方（切到别的分区也看得到、停得了）；打开作品时自动续跑未完成的流水线
 */
import { useEffect, useRef, useState } from 'react';

import { useDuanjuStore } from './store';
import { resumePipeline } from './lib/pipeline/runner';
import ScriptPane from './script/ScriptPane';
import CharactersPane from './characters/CharactersPane';
import ScenesPane from './scenes/ScenesPane';
import StoryboardPane from './storyboard/StoryboardPane';
import ExportPane from './export/ExportPane';
import AssetLibraryPane from './assets/AssetLibraryPane';
import LabPane from './lab/LabPane';
import PipelineStatusBar from './script/PipelineStatusBar';

type TabId = 'script' | 'characters' | 'scenes' | 'storyboard' | 'export' | 'assets' | 'lab';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'script', label: '剧本' },
  { id: 'characters', label: '角色' },
  { id: 'scenes', label: '场景/道具' },
  { id: 'storyboard', label: '分镜' },
  { id: 'export', label: '出图/导出' },
  { id: 'assets', label: '资产库' },
  { id: 'lab', label: '试验' },
];

/** 不依赖剧本定稿的分区（试验台只是试提示词与出图） */
const UNLOCKED_TABS: ReadonlySet<TabId> = new Set<TabId>(['script', 'lab']);

interface Props {
  workId: string;
  title: string;
  onBack: () => void;
}

export default function DuanjuWorkbench({ workId, title, onBack }: Props) {
  const { project, loading, loadError, load, conflict, clearConflict } = useDuanjuStore();
  const [tab, setTab] = useState<TabId>('script');
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void load(workId);
    return () => useDuanjuStore.getState().reset();
  }, [workId, load]);

  // 打开作品：有未完成的流水线断点就接着跑（停靠中的只恢复提示，不自动续）
  useEffect(() => {
    void resumePipeline(workId);
  }, [workId]);

  // 切换分区后让选中的 tab 滚入视野（分区多了会横向溢出）
  useEffect(() => {
    navRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [tab]);

  const scriptConfirmed = project?.script.confirmed ?? false;
  const locked = (id: TabId): string | null =>
    UNLOCKED_TABS.has(id) || scriptConfirmed ? null : '先在「剧本」tab 定稿后解锁';

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
      {/* 刷新失败但已有数据：保留分区（编辑中的内容不丢），顶部提示 */}
      {loadError && project && (
        <div
          className="flex items-center gap-2 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
          role="status"
          data-testid="duanju-refresh-failed"
        >
          <span className="flex-1">刷新失败，显示的可能是旧数据</span>
          <button type="button" className="underline" onClick={() => void load(workId)}>
            重试
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
        <nav ref={navRef} className="scrollbar-none flex gap-1 overflow-x-auto" role="tablist" aria-label="短剧分区">
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

      {/* 流水线进度条：运行中 / 停靠 / 中断 / 停止或有失败的完成 */}
      <PipelineStatusBar workId={workId} />

      <main className="min-h-0 flex-1">
        {loading && !project && <p className="py-24 text-center text-sm text-[hsl(var(--fg-muted))]">加载中…</p>}
        {loadError && !project && (
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
        {project && (
          <>
            {/* 全部 pane 常驻挂载，hidden 切换（用户反馈 #7）：AI 提取/生图进行中切 tab
                不再卸载组件中断任务，回来还在；刷新安全（生成产物 server 已落盘） */}
            <div hidden={tab !== 'script'}><ScriptPane workId={workId} /></div>
            <div hidden={tab !== 'characters'}><CharactersPane workId={workId} /></div>
            <div hidden={tab !== 'scenes'}><ScenesPane workId={workId} /></div>
            <div hidden={tab !== 'storyboard'}><StoryboardPane workId={workId} /></div>
            <div hidden={tab !== 'export'}><ExportPane workId={workId} /></div>
            <div hidden={tab !== 'assets'}><AssetLibraryPane workId={workId} onImported={() => void load(workId)} /></div>
            <div hidden={tab !== 'lab'}><LabPane workId={workId} /></div>
          </>
        )}
      </main>
    </div>
  );
}
