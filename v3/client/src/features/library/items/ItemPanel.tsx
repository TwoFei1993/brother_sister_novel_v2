/**
 * 物品道具面板（资产库「物品道具」Tab；用户需求：特殊物品道具也有资料卡）
 *
 * 列表（名 + describeItem 摘要）+ 新建 + 编辑（ItemEditor 弹层）+ 删除（confirm 确认）。
 * 原生资产无文件导入导出——创建/编辑全在应用内完成。
 */
import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { deleteItem, getItem, listItems, type ItemAsset, type LibraryAssetRef } from '../../../api/library';
import { describeItem } from '@shared/assets/item';

import ItemEditor from './ItemEditor';

interface ItemPanelProps {
  notify: (kind: 'ok' | 'err', text: string) => void;
}

export default function ItemPanel({ notify }: ItemPanelProps) {
  const [items, setItems] = useState<LibraryAssetRef[] | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = useCallback(async () => {
    try {
      setItems(await listItems());
    } catch (err) {
      setItems([]);
      notify('err', err instanceof Error ? err.message : '物品列表加载失败');
    }
  }, [notify]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  // 摘要逐项拉详情（列表个位数，可接受）；失败静默
  useEffect(() => {
    let alive = true;
    for (const it of items ?? []) {
      getItem(it.id)
        .then((a: ItemAsset) => {
          if (!alive) return;
          setSummaries((prev) => ({ ...prev, [it.id]: describeItem(a) }));
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [items]);

  const onDelete = async (id: string, name: string): Promise<void> => {
    if (!window.confirm(`确定删除物品「${name}」？该操作不可恢复。`)) return;
    try {
      await deleteItem(id);
      notify('ok', `已删除「${name}」`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <section aria-label="物品道具资产面板" className="flex flex-col gap-3">
      <div
        data-testid="item-guide"
        className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 py-2 text-xs leading-5 text-[hsl(var(--fg-muted))]"
      >
        <p className="font-medium text-[hsl(var(--fg))]">物品道具卡是什么</p>
        <p>
          给剧情里有特殊作用的物品/道具立卡（信物、金手指载体、关键武器…），描述具体到
          <span className="text-[hsl(var(--fg))]">质感、形状、颜色、功能、承载的感情</span>
          。绑定到作品后，写作时整块注入提示词——AI 会记住物品的每个细节，不会写串。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing({ id: null })}
          data-testid="item-create"
          className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-white"
        >
          ＋ 新建物品
        </button>
        <span className="text-xs text-[hsl(var(--fg-muted))]">创建后在作品设置里绑定到书，生成时自动生效</span>
      </div>

      {items === null && <p className="py-6 text-center text-sm text-[hsl(var(--fg-muted))]">加载中…</p>}
      {items?.length === 0 && <p className="py-6 text-center text-sm text-[hsl(var(--fg-muted))]">暂无物品卡，点击上方「新建物品」创建</p>}

      <ul className="flex flex-col gap-2">
        {(items ?? []).map((it) => (
          <li
            key={it.id}
            data-testid={`item-row-${it.id}`}
            className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3"
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing({ id: it.id })}
                className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[hsl(var(--fg))] hover:text-[hsl(var(--accent))]"
              >
                {it.name}
              </button>
              <button
                type="button"
                onClick={() => void onDelete(it.id, it.name)}
                aria-label={`删除物品 ${it.name}`}
                title="删除"
                className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg border border-red-400/40 px-1 text-sm text-red-400 hover:bg-red-400/10"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {summaries[it.id] && (
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-[hsl(var(--fg-muted))]">{summaries[it.id]}</p>
            )}
          </li>
        ))}
      </ul>

      {editing && (
        <ItemEditor
          itemId={editing.id}
          notify={notify}
          onClose={() => setEditing(null)}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </section>
  );
}
