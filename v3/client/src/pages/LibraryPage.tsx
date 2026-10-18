/**
 * /library 资产库页面（设计 §7.1 / Task 26）
 *
 * 四类资产 Tab（URL ?tab= 深链同步）+ 每 Tab：资产列表（名/描述摘要/操作）
 * + 导入（multipart → /api/io/<type>/import）+ 导出（角色卡 png/json，其余 json）
 * + 删除 + 内联提示条（未引入 toast 库，会话内轻量提示）。
 * 预设 Tab 选中资产后展开「提示词管理器」；世界书/角色卡「编辑」打开对应编辑器弹层。
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  ASSET_META, describeAsset, deleteAsset, exportAsset, getAsset, importAsset, listAssets,
  type AssetType, type LibraryAssetRef,
} from '../api/library';
import AssetTabs, { type LibraryTab } from '../features/library/AssetTabs';
import CardEditor from '../features/library/CardEditor';
import PromptManager from '../features/library/PromptManager';
import ResourceHub from '../features/library/ResourceHub';
import WorldbookEditor from '../features/library/WorldbookEditor';

type Toast = { kind: 'ok' | 'err'; text: string } | null;

/** 从 Tab 参数解析资产类型（非法回退角色卡） */
function parseTab(v: string | null): AssetType {
  return ASSET_META.some((m) => m.id === v) ? (v as AssetType) : 'characters';
}

// ---------- 单类资产面板 ----------

interface AssetPanelProps {
  type: AssetType;
  label: string;
  accept: string;
  notify: (kind: 'ok' | 'err', text: string) => void;
  /** 编辑按钮：分派逻辑由页面按类型决定（预设内联 / 世界书·卡弹层） */
  onEdit: (id: string) => void;
  /** 变更信号：粘贴导入等面板外写入发生后 +1 触发列表重拉 */
  refreshKey: number;
}

function AssetPanel({ type, label, accept, notify, onEdit, refreshKey }: AssetPanelProps) {
  const [items, setItems] = useState<LibraryAssetRef[] | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await listAssets(type));
    } catch (err) {
      setItems([]);
      notify('err', err instanceof Error ? err.message : `${label}列表加载失败`);
    }
  }, [type, label, notify]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  // 描述摘要：列表常量为个位数，逐项拉详情可接受；失败静默（摘要非关键信息）
  useEffect(() => {
    let alive = true;
    for (const it of items ?? []) {
      getAsset(type, it.id)
        .then((a) => {
          if (alive) setSummaries((prev) => ({ ...prev, [it.id]: describeAsset(a) }));
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [items, type]);

  const onFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (!file) return;
    setBusy(true);
    try {
      const asset = await importAsset(type, file);
      notify('ok', `已导入「${asset.name}」`);
      await reload();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const onExport = async (id: string, name: string, format?: 'png' | 'json') => {
    try {
      await exportAsset(type, id, { name, format });
      notify('ok', `「${name}」已导出${format ? `（${format.toUpperCase()}）` : ''}`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '导出失败');
    }
  };

  const onDelete = async (id: string, name: string) => {
    if (!window.confirm(`确定删除「${name}」？该操作不可恢复。`)) return;
    try {
      await deleteAsset(type, id);
      notify('ok', `已删除「${name}」`);
      await reload();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <section aria-label={`${label}资产面板`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? '导入中…' : `导入${label}`}
        </button>
        <span className="text-xs text-[hsl(var(--fg-muted))]">
          支持 {accept} 文件{type === 'characters' ? '（PNG 卡自动提取内嵌 JSON）' : ''}
        </span>
        <input ref={fileRef} type="file" accept={accept} hidden onChange={onFileChosen} />
      </div>

      {items === null && <p className="py-6 text-center text-sm text-[hsl(var(--fg-muted))]">加载中…</p>}
      {items?.length === 0 && (
        <p className="py-6 text-center text-sm text-[hsl(var(--fg-muted))]">
          暂无{label}，点击上方「导入{label}」上传酒馆格式文件
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {(items ?? []).map((it) => (
          <li
            key={it.id}
            className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[hsl(var(--fg))]">{it.name}</p>
                <p className="truncate text-xs text-[hsl(var(--fg-muted))]">
                  {summaries[it.id] ?? ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onEdit(it.id)}
                className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
              >
                编辑
              </button>
              {type === 'characters' && (
                <button
                  type="button"
                  onClick={() => void onExport(it.id, it.name, 'png')}
                  className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
                >
                  导出 PNG
                </button>
              )}
              <button
                type="button"
                onClick={() => void onExport(it.id, it.name, 'json')}
                className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
              >
                导出 JSON
              </button>
              <button
                type="button"
                onClick={() => void onDelete(it.id, it.name)}
                className="min-h-[36px] rounded-lg border border-red-400/40 px-3 text-sm text-red-400 hover:bg-red-400/10"
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- 页面壳 ----------

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
