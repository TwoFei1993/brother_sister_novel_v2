/**
 * 单类资产面板（自 pages/LibraryPage 拆出，review 规范修复）
 *
 * 列表（名/描述摘要）+ 导入（multipart → /api/io/<type>/import）+ 导出
 * （角色卡 png/json，其余 json）+ 删除（confirm 确认）；描述摘要逐项拉详情。
 * 编辑按钮分派逻辑由页面按类型决定（预设内联 / 世界书·卡弹层），本组件只回调。
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

import {
  ASSET_META, describeAsset, deleteAsset, exportAsset, getAsset, importAsset, listAssets,
  type AssetType, type LibraryAssetRef,
} from '../../api/library';

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

export default function AssetPanel({ type, label, accept, notify, onEdit, refreshKey }: AssetPanelProps) {
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
