/**
 * 主预设选择弹层（资料分区「文风与基调」）：从预设库给本书单选一本主预设，或解除绑定。
 * 背景见 StylePane 头注——手机端此前没有任何入口绑定主预设。
 */
import { useEffect, useState } from 'react';

import { listPresets, type LibraryAssetRef } from '../../../../api/library';

interface Props {
  /** 当前绑定的主预设 id（空串=未绑定） */
  current: string;
  onSelect: (presetId: string) => void;
  onClose: () => void;
}

const rowCls = (active: boolean): string =>
  `flex min-h-11 w-full items-center rounded-lg px-3 py-2 text-left text-sm ${
    active ? 'bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]' : 'hover:bg-[hsl(var(--bg))]'
  }`;

export default function PresetPickerSheet({ current, onSelect, onClose }: Props) {
  const [presets, setPresets] = useState<LibraryAssetRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listPresets()
      .then((list) => {
        if (alive) setPresets(list);
      })
      .catch(() => {
        if (alive) setError('预设列表加载失败，请重试');
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="m-fade fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="m-sheet max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-[hsl(var(--surface))] p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="选择主预设"
        data-testid="preset-picker-sheet"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">选择主预设</h3>
          <button type="button" onClick={onClose} className="text-xs text-[hsl(var(--fg-muted))]">
            取消
          </button>
        </div>
        {error && (
          <p className="mb-2 text-xs text-[hsl(var(--danger))]" role="alert">
            {error}
          </p>
        )}
        {presets === null && !error && (
          <p className="py-4 text-center text-xs text-[hsl(var(--fg-muted))]">加载中…</p>
        )}
        {presets !== null && (
          <ul className="flex flex-col gap-1">
            <li>
              <button type="button" onClick={() => onSelect('')} data-testid="preset-option-none" className={rowCls(current === '')}>
                不绑定主预设
              </button>
            </li>
            {presets.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  data-testid={`preset-option-${p.id}`}
                  className={rowCls(current === p.id)}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {presets !== null && presets.length === 0 && (
          <p className="py-4 text-center text-xs leading-5 text-[hsl(var(--fg-muted))]">
            预设库是空的——先在电脑端「资产库 → 预设」导入
          </p>
        )}
      </div>
    </div>
  );
}
