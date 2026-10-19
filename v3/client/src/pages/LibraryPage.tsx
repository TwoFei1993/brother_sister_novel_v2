/**
 * /library 资产库页面（设计 §7.1 / Task 26）
 *
 * 四类资产 Tab（URL ?tab= 深链同步；?tab=hub 资源中心）+ 资产面板（AssetPanel）。
 * 预设 Tab 选中资产后展开「提示词管理器」；世界书/角色卡「编辑」打开对应编辑器弹层。
 * 面板 CRUD 已拆至 features/library/AssetPanel（review 规范修复）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ASSET_META, type AssetType } from '../api/library';
import AssetPanel from '../features/library/AssetPanel';
import AssetTabs, { type LibraryTab } from '../features/library/AssetTabs';
import CardEditor from '../features/library/editors/CardEditor';
import WorldbookEditor from '../features/library/editors/WorldbookEditor';
import PromptManager from '../features/library/prompts/PromptManager';
import ResourceHub from '../features/library/ResourceHub';

type Toast = { kind: 'ok' | 'err'; text: string } | null;

/** 从 Tab 参数解析资产类型（非法回退角色卡） */
function parseTab(v: string | null): AssetType {
  return ASSET_META.some((m) => m.id === v) ? (v as AssetType) : 'characters';
}

export default function LibraryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const isHub = rawTab === 'hub'; // 资源中心深链（?tab=hub，Task 30）
  const tab: AssetType = parseTab(rawTab);
  const [toast, setToast] = useState<Toast>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ type: AssetType; id: string } | null>(null);
  const [listRefresh, setListRefresh] = useState(0);
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const setTab = (next: LibraryTab) => {
    setSelectedPresetId(null);
    setEditing(null);
    if (next === 'hub') {
      setSearchParams({ tab: 'hub' }, { replace: true });
      return;
    }
    setSearchParams(next === 'characters' ? {} : { tab: next }, { replace: true });
  };

  /** 编辑按钮分派：预设内联管理器，世界书/角色卡全屏编辑器，其余提示后续版本 */
  const openEditor = (type: AssetType, id: string) => {
    if (type === 'presets') {
      setSelectedPresetId(id);
      return;
    }
    if (type === 'characters' || type === 'worldbooks') {
      setEditing({ type, id });
      return;
    }
    notify('err', '该类资产编辑器将在后续版本提供');
  };

  /** 编辑器保存成功：刷新列表摘要 */
  const onEditorSaved = useCallback(() => setListRefresh((k) => k + 1), []);

  const meta = ASSET_META.find((m) => m.id === tab)!;

  return (
    <main className="safe-top safe-bottom mx-auto min-h-screen w-full max-w-2xl bg-[hsl(var(--bg))] px-4 pb-16 text-[hsl(var(--fg))]">
      <header className="mb-4 flex items-center gap-3 pt-2">
        <Link
          to="/"
          aria-label="返回书架"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[hsl(var(--border-soft))] text-lg transition-colors hover:border-[hsl(var(--accent))]"
        >
          ←
        </Link>
        <h1 className="text-xl font-semibold">资产库</h1>
      </header>

      {toast && (
        <div
          role="status"
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
            toast.kind === 'ok'
              ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-500'
              : 'border-red-400/40 bg-red-400/10 text-red-400'
          }`}
        >
          {toast.text}
        </div>
      )}

      <AssetTabs value={isHub ? 'hub' : tab} onChange={setTab} />

      {isHub ? (
        <ResourceHub notify={notify} onJump={setTab} />
      ) : (
        <>
          {tab === 'presets' && selectedPresetId && (
            <div className="mb-6 rounded-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4">
              <PromptManager
                presetId={selectedPresetId}
                notify={notify}
                onImportedNew={(id) => {
                  setSelectedPresetId(id);
                  setListRefresh((k) => k + 1); // 粘贴导入后列表同步出新资产
                }}
              />
            </div>
          )}

          <AssetPanel
            key={tab}
            type={tab}
            label={meta.label}
            accept={meta.accept}
            notify={notify}
            onEdit={(id) => openEditor(tab, id)}
            refreshKey={listRefresh}
          />

          {editing?.type === 'worldbooks' && (
            <WorldbookEditor
              worldbookId={editing.id}
              notify={notify}
              onClose={() => setEditing(null)}
              onSaved={onEditorSaved}
            />
          )}
          {editing?.type === 'characters' && (
            <CardEditor
              characterId={editing.id}
              notify={notify}
              onClose={() => setEditing(null)}
              onSaved={onEditorSaved}
            />
          )}
        </>
      )}
    </main>
  );
}
