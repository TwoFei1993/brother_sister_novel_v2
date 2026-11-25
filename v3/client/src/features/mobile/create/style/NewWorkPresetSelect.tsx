/**
 * 新建作品的「主预设」下拉（手机端建书弹窗；与桌面端建书的预设绑定项对等）。
 * 背景：手机端此前建书不带 presetId，而资料页的预设文风/情感基调面板只在绑定主预设后才出现。
 */
import { useEffect, useState } from 'react';

import { listPresets, type LibraryAssetRef } from '../../../../api/library';

interface Props {
  value: string;
  onChange: (presetId: string) => void;
  /** select 样式类（与同弹窗的写作风格/内容形态下拉一致） */
  selectClass: string;
}

export default function NewWorkPresetSelect({ value, onChange, selectClass }: Props) {
  const [presets, setPresets] = useState<LibraryAssetRef[] | null>(null);

  useEffect(() => {
    let alive = true;
    listPresets()
      .then((list) => {
        if (alive) setPresets(list);
      })
      .catch(() => {
        if (alive) setPresets([]); // 拉取失败降级为「暂无预设」，不阻塞建书
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm text-[hsl(var(--fg-muted))]">主预设（可选）</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="new-work-preset"
        className={selectClass}
      >
        <option value="">{presets === null ? '加载中…' : '不绑定'}</option>
        {(presets ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
