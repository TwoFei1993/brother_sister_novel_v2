/**
 * C 工作台视图（设计 §7.1）：侧栏（状态变量 + 世界书激活灯 + 快速指令/指令历史）
 * + 主区复用 ReadingView 阅读流
 *
 * - 桌面（lg+）：左 320px 固定侧栏（纵向三面板，独立滚动）+ 右侧阅读流，双栏同屏
 * - 移动（<lg）：侧栏收进右缘抽屉，浮动「工作台」按钮唤起；主区全屏阅读流
 * - 快照/激活审计提取：取最新与上一条 assistant 消息的 extra（本组件做，子面板纯渲染）
 */
import { useEffect, useMemo, useState } from 'react';

import type { Message } from '@shared/message';

import ActivatedList, { type WorldbookEntryRef } from './ActivatedList';
import DirectiveHistory from './DirectiveHistory';
import ReadingView from '../ReadingView';
import StatusPanel, { type SnapshotValue } from './StatusPanel';

export interface WorkbenchViewProps {
  messages: Message[];
  streaming: boolean;
  buffer: string;
  hasMore: boolean;
  loadingOlder: boolean;
  onNeedOlder: () => void;
  /** 全量世界书条目索引（id="bookId:uid"，父层从绑定资产解析） */
  entryIndex: WorldbookEntryRef[];
  /** 作品级快速指令（work.settings.quickDirectives ?? []） */
  quickDirectives: string[];
  /** 点击历史/快速指令：父层复填到底部指令输入框 */
  onPickDirective: (text: string) => void;
  /** 追加快速指令（父层 PATCH work） */
  onAddQuickDirective: (text: string) => void;
  /** 删除快速指令（父层 PATCH work） */
  onRemoveQuickDirective: (index: number) => void;
}

/** assistant 消息按时间升序（createdAt 相同保持流内顺序） */
function assistantChain(messages: Message[]): Message[] {
  return messages.filter((m) => m.role === 'assistant').sort((a, b) => a.createdAt - b.createdAt);
}

/** 侧栏三面板（StatusPanel / ActivatedList / DirectiveHistory 纵向排列），桌面移动共用 */
function Sidebar(props: {
  snapshot: Record<string, SnapshotValue> | null;
  prevSnapshot: Record<string, SnapshotValue> | null;
  activatedIds: string[] | null;
  entryIndex: WorldbookEntryRef[];
  messages: Message[];
  quickDirectives: string[];
  onPickDirective: (text: string) => void;
  onAddQuickDirective: (text: string) => void;
  onRemoveQuickDirective: (index: number) => void;
  /** 移动抽屉模式：点击指令后顺手收起抽屉 */
  onPicked?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 pb-4">
      <StatusPanel snapshot={props.snapshot} prevSnapshot={props.prevSnapshot} />
      <ActivatedList activatedIds={props.activatedIds} entries={props.entryIndex} />
      <DirectiveHistory
        messages={props.messages}
        onPick={(t) => {
          props.onPickDirective(t);
          props.onPicked?.();
        }}
        quickDirectives={props.quickDirectives}
        onAddQuickDirective={props.onAddQuickDirective}
        onRemoveQuickDirective={props.onRemoveQuickDirective}
      />
    </div>
  );
}

export default function WorkbenchView({
  messages,
  streaming,
  buffer,
  hasMore,
  loadingOlder,
  onNeedOlder,
  entryIndex,
  quickDirectives,
  onPickDirective,
  onAddQuickDirective,
  onRemoveQuickDirective,
}: WorkbenchViewProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const chain = useMemo(() => assistantChain(messages), [messages]);
  const latest = chain.length > 0 ? chain[chain.length - 1] : null;
  const prev = chain.length > 1 ? chain[chain.length - 2] : null;
  const snapshot = latest?.extra.statusSnapshot ?? null;
  const prevSnapshot = prev?.extra.statusSnapshot ?? null;
  // 有 assistant 消息即视为激活审计已发生（缺省空数组=本次无激活）；无消息才显示引导
  const activatedIds = latest ? (latest.extra.activatedEntries ?? []) : null;

  // Esc 关闭移动抽屉（桌面双栏下无抽屉，无副作用）
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const sidebarProps = {
    snapshot,
    prevSnapshot,
    activatedIds,
    entryIndex,
    messages,
    quickDirectives,
    onPickDirective,
    onAddQuickDirective,
    onRemoveQuickDirective,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row" data-testid="workbench-view">
      {/* 桌面侧栏（左 320px，独立滚动） */}
      <aside
        aria-label="工作台侧栏"
        data-testid="workbench-sidebar"
        className="hidden w-80 shrink-0 overflow-y-auto border-r border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] lg:block"
      >
        <Sidebar {...sidebarProps} />
      </aside>

      {/* 移动抽屉（右缘滑出）+ 唤起按钮 */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="打开工作台侧栏"
        data-testid="workbench-toggle"
        className="fixed right-3 bottom-20 z-30 flex h-11 items-center gap-1 rounded-full border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-4 text-xs shadow-lg lg:hidden"
      >
        📊 工作台
      </button>
      <div
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden ${
          drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        aria-label="工作台侧栏"
        data-testid="workbench-drawer"
        className={`fixed inset-y-0 right-0 z-50 flex w-80 max-w-[85vw] flex-col overflow-y-auto bg-[hsl(var(--surface))] shadow-xl transition-transform duration-200 lg:hidden ${
          drawerOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="safe-top flex items-center justify-between border-b border-[hsl(var(--border-soft))] px-3 pb-3 pt-4">
          <h2 className="text-sm font-semibold">工作台</h2>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="关闭工作台侧栏"
            data-testid="workbench-drawer-close"
            className="flex h-8 min-w-8 items-center justify-center rounded text-sm text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]"
          >
            ×
          </button>
        </div>
        <Sidebar {...sidebarProps} onPicked={() => setDrawerOpen(false)} />
      </aside>

      {/* 主区：复用 B 视图阅读流 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ReadingView
          messages={messages}
          streaming={streaming}
          buffer={buffer}
          hasMore={hasMore}
          loadingOlder={loadingOlder}
          onNeedOlder={onNeedOlder}
        />
      </div>
    </div>
  );
}
