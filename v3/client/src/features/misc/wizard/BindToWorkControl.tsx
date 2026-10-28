/**
 * 绑定到作品控件（绑定全时序③）：向导导入成功后，就地把本次资产绑到已有作品
 * 或新建作品并携带——不再依赖「先建作品/后导入」的顺序。
 * 折叠按钮 → 展开时才拉作品列表（GET /api/works 最近更新优先，取前 20）；
 * 选中现有作品即 GET revision + PATCH 去重合并绑定（保留已有绑定）；
 * 「（新建作品并绑定）」走 createWork 直接携带 ids。挂载点：OutlinePreview 一键
 * 导入清单旁、SheetImportPanel 成功报告旁。
 */
import { useState } from 'react';

import { attributeAssets, bindAssetsToWork, mergeIdLists, type ImportedAssets } from './importAll';
import { createWork, listWorks, type WorkSummary } from '../../../api/works';

const MAX_WORKS = 20;
const NEW_OPTION = '__new__';

interface Props {
  /** 本次导入创建的资产（空 ids 时不渲染） */
  assets: ImportedAssets;
  /** 绑定成功回调（作品标题, 是否新建）——父级可刷新提示 */
  onBound?: (title: string, isNew: boolean) => void;
}

const selectCls =
  'h-9 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs outline-none focus:border-[hsl(var(--accent))]';

export default function BindToWorkControl({ assets, onBound }: Props) {
  const hasAssets = assets.characterIds.length > 0 || assets.worldbookIds.length > 0;
  const [open, setOpen] = useState(false);
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [selected, setSelected] = useState('');
  const [newTitle, setNewTitle] = useState('');
  /** 共享卡：勾选后绑定不写归属（素材库跨书可见的共享素材）；默认归属本书 */
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  if (!hasAssets) return null;

  /** 展开（懒加载作品列表，失败降级为空列表 + 错误提示） */
  const expand = async (): Promise<void> => {
    setOpen(true);
    if (works) return;
    try {
      setWorks((await listWorks()).slice(0, MAX_WORKS));
    } catch {
      setWorks([]);
      setMsg({ kind: 'err', text: '作品列表加载失败，请稍后重试' });
    }
  };

  /** 绑定到现有作品：GET revision → PATCH 去重合并（保留已有绑定）+ 补归属（共享卡跳过） */
  const bindExisting = async (workId: string): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const bound = await bindAssetsToWork(workId, {
        characterIds: assets.characterIds,
        worldbookIds: assets.worldbookIds,
      }, { shared });
      setMsg({ kind: 'ok', text: `已绑定到《${bound.title}》${shared ? '（共享卡，未归属）' : ''}` });
      onBound?.(bound.title, false);
      setSelected('');
    } catch {
      setMsg({ kind: 'err', text: '绑定失败（可能已被他人修改），请刷新后重试' });
    } finally {
      setBusy(false);
    }
  };

  /** 新建作品并携带资产（创建即绑定，无需二次 PATCH）+ 补归属（共享卡跳过） */
  const createAndBind = async (): Promise<void> => {
    const name = newTitle.trim();
    if (!name) {
      setMsg({ kind: 'err', text: '请输入新书名' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const work = await createWork({
        title: name,
        mode: 'novel',
        genre: 'chuanyue',
        characterIds: mergeIdLists([], assets.characterIds),
        worldbookIds: mergeIdLists([], assets.worldbookIds),
      });
      if (!shared) await attributeAssets(work.id, assets);
      setMsg({ kind: 'ok', text: `已创建《${work.title}》并绑定资产${shared ? '（共享卡，未归属）' : ''}` });
      onBound?.(work.title, true);
      setNewTitle('');
      setSelected('');
    } catch {
      setMsg({ kind: 'err', text: '创建作品失败，请重试' });
    } finally {
      setBusy(false);
    }
  };

  const onSelect = (value: string): void => {
    setSelected(value);
    if (value && value !== NEW_OPTION) void bindExisting(value);
  };

  return (
    <div data-testid="bind-to-work" className="mt-1 flex flex-col gap-1.5 border-t border-[hsl(var(--border-soft))] pt-2">
      {!open ? (
        <button
          type="button"
          onClick={() => void expand()}
          data-testid="bind-to-work-open"
          className="self-start text-xs font-medium underline underline-offset-4 text-[hsl(var(--accent))]"
        >
          绑定到作品…
        </button>
      ) : (
        <label className="flex items-center gap-2 text-xs text-[hsl(var(--fg-muted))]">
          绑定
          <select
            value={selected}
            onChange={(e) => onSelect(e.target.value)}
            disabled={busy}
            data-testid="bind-work-select"
            aria-label="选择要绑定的作品"
            className={selectCls}
          >
            <option value="">绑定到作品…</option>
            <option value={NEW_OPTION}>（新建作品并绑定）</option>
            {(works ?? []).map((w) => (
              <option key={w.id} value={w.id} className="bg-[hsl(var(--surface))]">
                《{w.title}》
              </option>
            ))}
          </select>
        </label>
      )}
      {open && (
        <label className="flex items-center gap-1.5 text-xs text-[hsl(var(--fg-muted))]" data-testid="bind-shared-check">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          共享卡（不归属本书，素材库各书可见）
        </label>
      )}
      {open && selected === NEW_OPTION && (
        <div className="flex gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="新书名"
            aria-label="新书名"
            data-testid="bind-new-title"
            className="h-9 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs outline-none focus:border-[hsl(var(--accent))]"
          />
          <button
            type="button"
            onClick={() => void createAndBind()}
            disabled={busy}
            data-testid="bind-create-btn"
            className="min-h-[36px] shrink-0 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium text-white disabled:opacity-40"
          >
            {busy ? '创建中…' : '创建并绑定'}
          </button>
        </div>
      )}
      {msg && (
        <p
          role="status"
          data-testid="bind-to-work-msg"
          className={`text-xs ${msg.kind === 'ok' ? 'text-emerald-500' : 'text-red-400'}`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
