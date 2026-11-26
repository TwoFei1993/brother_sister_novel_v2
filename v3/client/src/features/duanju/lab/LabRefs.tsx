/**
 * 试验台参考图区（M2）：按顺序的缩略图列表（第 1 张是底图）+ 添加入口（上传 / 从本作品选）
 *
 * 列表可以比当前通道的上限长（切到上限更小的通道不删用户的图）：超出的标灰并写明「该通道不会用」。
 */
import type { LabProvider, LabRef } from '@shared/duanju/lab';
import { LAB_REF_LIMITS } from '@shared/duanju/lab';
import { ImagePlus, X } from 'lucide-react';

import { duanjuFileUrl } from '../../../api/duanju';
import type { LabRefOption } from '../lib/lab/refs';

interface Props {
  workId: string;
  provider: LabProvider;
  value: readonly LabRef[];
  onChange: (next: LabRef[]) => void;
  /** 本作品里可加的图（角色设定图 / 场景图 / 历史试验图） */
  options: readonly LabRefOption[];
  /** 扩写或出图进行中：锁定 */
  disabled: boolean;
  /** 正在添加（上传中） */
  adding: boolean;
  onUpload: (file: File) => void;
  onAddFromWork: (option: LabRefOption) => void;
}

const GROUPS: ReadonlyArray<LabRefOption['group']> = ['角色设定图', '场景图', '历史试验图'];

const btnCls =
  'flex h-9 items-center justify-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs text-[hsl(var(--fg-muted))] transition-colors hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--fg))] disabled:opacity-40 disabled:hover:border-[hsl(var(--border-soft))]';

export default function LabRefs({ workId, provider, value, onChange, options, disabled, adding, onUpload, onAddFromWork }: Props) {
  const limit = LAB_REF_LIMITS[provider];
  const full = value.length >= limit;
  const locked = disabled || adding || full;

  if (limit === 0) {
    return (
      <div>
        <span className="mb-1.5 block text-xs text-[hsl(var(--fg-muted))]">参考图</span>
        <p className="text-xs text-[hsl(var(--fg-muted))]" data-testid="lab-refs-unsupported">
          该通道不支持参考图——换到本地引擎或 Seedream
        </p>
      </div>
    );
  }

  return (
    <div data-testid="lab-refs">
      <span className="mb-1.5 block text-xs text-[hsl(var(--fg-muted))]">
        参考图 <span className="tabular-nums">{Math.min(value.length, limit)}/{limit}</span>
      </span>
      <p className="mb-2 text-xs leading-5 text-[hsl(var(--fg-muted))]">
        {provider === 'comfy'
          ? '第 1 张是底图：场景、构图、造型都跟它走；后面的当人物 / 场景参考。'
          : '以这张图为准，保持人物与物件和它一致。'}
      </p>
      {value.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {value.map((ref, i) => {
            const unused = i >= limit;
            const rest = (next: LabRef): LabRef[] => value.map((x, j) => (j === i ? next : x));
            return (
              <li key={ref.path} className={`w-28 shrink-0 ${unused ? 'opacity-50' : ''}`} data-testid={`lab-ref-${i}`}>
                <div className="relative aspect-[3/4] overflow-hidden rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))]">
                  <img src={duanjuFileUrl(workId, ref.path)} alt={ref.caption || `参考图 ${i + 1}`} className="h-full w-full object-cover" />
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] leading-4 text-white">
                    {i === 0 ? '图1 · 底图' : `图${i + 1}`}
                  </span>
                  <button
                    type="button"
                    aria-label={`移除参考图 ${i + 1}`}
                    disabled={disabled}
                    onClick={() => onChange(value.filter((_, j) => j !== i))}
                    data-testid={`lab-ref-remove-${i}`}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  {unused && (
                    <span className="absolute inset-x-1 bottom-1 rounded bg-black/70 px-1 py-0.5 text-center text-[10px] leading-4 text-white">
                      该通道不会用
                    </span>
                  )}
                </div>
                <input
                  value={ref.caption}
                  onChange={(e) => onChange(rest({ ...ref, caption: e.target.value.slice(0, 200) }))}
                  placeholder="这张图画的是什么"
                  aria-label={`参考图 ${i + 1} 的说明`}
                  data-testid={`lab-ref-caption-${i}`}
                  disabled={disabled}
                  className="mt-1 w-full rounded border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-1.5 py-1 text-[11px] outline-none focus:border-[hsl(var(--accent))] disabled:opacity-60"
                />
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className={btnCls} data-testid="lab-ref-upload">
          <ImagePlus className="h-3.5 w-3.5" aria-hidden />
          {adding ? '添加中…' : '上传图片'}
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            disabled={locked}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = '';
            }}
          />
        </label>
        {options.length > 0 && (
          <select
            value=""
            disabled={locked}
            aria-label="从本作品选参考图"
            data-testid="lab-ref-pick"
            onChange={(e) => {
              const option = options[Number(e.target.value)];
              if (option) onAddFromWork(option);
            }}
            className="h-9 max-w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs text-[hsl(var(--fg-muted))] outline-none focus:border-[hsl(var(--accent))] disabled:opacity-40"
          >
            <option value="">从本作品选…</option>
            {GROUPS.map((group) => {
              const items = options.map((option, i) => ({ option, i })).filter((x) => x.option.group === group);
              return items.length ? (
                <optgroup key={group} label={group}>
                  {items.map(({ option, i }) => (
                    <option key={i} value={i}>
                      {option.caption}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        )}
      </div>
    </div>
  );
}
