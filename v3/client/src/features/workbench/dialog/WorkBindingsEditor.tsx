/**
 * 作品绑定资产编辑器（写作台设置抽屉内嵌，设计 §4.3；自 WorkSettingsSheet 拆出）
 *
 * - 角色卡/世界书：多选 chips（下拉添加 + × 移除，交互同 NewWorkDialog）
 * - 预设：单选下拉（'' = 不绑定，生成用内置空预设）
 * - 改动即 PATCH work（revision 乐观锁）：本地乐观更新失败回滚；只发变更字段
 *   （server 对未传字段保留现值，避免整包覆盖并发改动）
 */
import { useEffect, useState } from 'react';

import { updateWork } from '../../../api/works';
import type { LibraryAssetRef } from '../../../api/library';
import type { Work } from '@shared/work';

interface WorkBindingsEditorProps {
  work: Work;
  /** 三类资产浅列表（宿主拉取；null 时已删资产显示占位名） */
  assets: {
    characters: LibraryAssetRef[];
    worldbooks: LibraryAssetRef[];
    presets: LibraryAssetRef[];
  } | null;
  /** PATCH 成功（父级同步 workStore.setWork，返回服务端 revision+1 的全量 Work） */
  onSaved: (work: Work) => void;
}

/** id → name 映射辅助（绑定了但已删除的资产显示为占位） */
function nameOf(list: LibraryAssetRef[], id: string): string {
  return list.find((a) => a.id === id)?.name ?? `（已删除：${id.slice(0, 8)}…）`;
}

const selectCls =
  'h-9 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-sm outline-none focus:border-[hsl(var(--accent))]';

/** 绑定改动补丁（characterIds/worldbookIds 多选、presetId 单选） */
type BindingPatch = Partial<Pick<Work, 'characterIds' | 'worldbookIds' | 'presetId'>>;

/** 单行多选绑定：已选 chips（× 移除）+ 添加下拉（已选项不在候选中） */
function MultiBindingRow({
  label,
  ids,
  options,
  onAdd,
  onRemove,
}: {
  label: string;
  ids: string[];
  options: LibraryAssetRef[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div data-testid={`binding-row-${label}`}>
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-sm text-[hsl(var(--fg-muted))]">{label}</span>
        <select
          value=""
          aria-label={`添加${label}`}
          data-testid={`binding-add-${label}`}
          onChange={(e) => {
            if (e.target.value) onAdd(e.target.value);
          }}
          className={selectCls}
        >
          <option value="">添加…</option>
          {options
            .filter((a) => !ids.includes(a.id))
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </div>
      {ids.length > 0 && (
        <div className="ml-16 mt-1.5 flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <span
              key={id}
              data-testid={`binding-chip-${id}`}
              className="flex items-center gap-1 rounded-full border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] py-0.5 pl-2.5 pr-1 text-xs"
            >
              {nameOf(options, id)}
              <button
                type="button"
                aria-label={`移除 ${nameOf(options, id)}`}
                data-testid={`binding-remove-${id}`}
                onClick={() => onRemove(id)}
                className="flex h-5 w-5 items-center justify-center rounded-full text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--border-soft))] hover:text-[hsl(var(--fg))]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WorkBindingsEditor({ work, assets, onSaved }: WorkBindingsEditorProps) {
  /** 绑定名单本地镜像：乐观更新立即可见（不依赖父级重渲染），失败回滚 */
  const [bindings, setBindings] = useState<Required<BindingPatch>>({
    characterIds: work.characterIds,
    worldbookIds: work.worldbookIds,
    presetId: work.presetId,
  });
  const [patching, setPatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 宿主以新 Work 更新（PATCH 成功 onSaved → 父级 setWork）时同步本地镜像
  useEffect(() => {
    setBindings({
      characterIds: work.characterIds,
      worldbookIds: work.worldbookIds,
      presetId: work.presetId,
    });
  }, [work]);

  /** 绑定改动即存：本地乐观更新（界面即时反映）→ PATCH；成功回传服务端 Work，失败回滚并提示 */
  async function patchBindings(patch: BindingPatch): Promise<void> {
    const prev = bindings;
    setBindings({ ...bindings, ...patch });
    setPatching(true);
    setError(null);
    try {
      const updated = await updateWork(work.id, { revision: work.revision, ...patch });
      onSaved(updated);
    } catch (err) {
      setBindings(prev);
      setError(err instanceof Error ? err.message : '绑定保存失败，请重试');
    } finally {
      setPatching(false);
    }
  }

  return (
    <section>
      <p className="mb-2 text-sm font-medium">
        绑定资产
        <span className="ml-2 text-xs font-normal text-[hsl(var(--fg-muted))]">
          （改动即保存{patching ? '，保存中…' : ''}）
        </span>
      </p>
      <div className="space-y-3">
        <MultiBindingRow
          label="角色卡"
          ids={bindings.characterIds}
          options={assets?.characters ?? []}
          onAdd={(id) => void patchBindings({ characterIds: [...bindings.characterIds, id] })}
          onRemove={(id) => void patchBindings({ characterIds: bindings.characterIds.filter((x) => x !== id) })}
        />
        <MultiBindingRow
          label="世界书"
          ids={bindings.worldbookIds}
          options={assets?.worldbooks ?? []}
          onAdd={(id) => void patchBindings({ worldbookIds: [...bindings.worldbookIds, id] })}
          onRemove={(id) => void patchBindings({ worldbookIds: bindings.worldbookIds.filter((x) => x !== id) })}
        />
        <div data-testid="binding-row-预设" className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-sm text-[hsl(var(--fg-muted))]">预设</span>
          <select
            value={bindings.presetId}
            aria-label="选择预设"
            data-testid="binding-preset"
            onChange={(e) => void patchBindings({ presetId: e.target.value })}
            className={selectCls}
          >
            <option value="">（不绑定，生成用内置空预设）</option>
            {bindings.presetId && !(assets?.presets ?? []).some((a) => a.id === bindings.presetId) && (
              <option value={bindings.presetId}>{nameOf(assets?.presets ?? [], bindings.presetId)}</option>
            )}
            {(assets?.presets ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          data-testid="binding-error"
          className="mt-2 rounded-lg bg-[hsl(var(--danger))]/10 p-2 text-xs text-[hsl(var(--danger))]"
        >
          {error}
        </p>
      )}
    </section>
  );
}
