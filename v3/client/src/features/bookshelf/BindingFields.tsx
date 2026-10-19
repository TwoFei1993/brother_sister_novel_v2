/**
 * 新建作品的绑定选择区（自 NewWorkDialog 拆出，行数规范修复）：
 * 角色卡/世界书多选（下拉添加 + × 移除 chips）、预设单选。
 * 常量与类型一并导出，供弹窗主体消费。
 */
import FieldHint from '../../components/FieldHint';
import { OPTION_CLS } from '../../components/ui-select';
import type { LibraryAssetRef } from '../../api/library';

export const BINDING_FIELDS = [
  {
    key: 'characterIds',
    label: '角色卡',
    multi: true,
    hint: '作品角色的设定来源：人设、开场白、对话示例都来自角色卡。可添加多张（多角色同台）；对话写作模式下按提及/轮换决定谁发言。',
  },
  {
    key: 'worldbookIds',
    label: '世界书',
    multi: true,
    hint: '世界观设定集：剧情关键词命中时自动注入对应设定（如地名、势力、规则）。可同时挂多本（人物书+世界书）。',
  },
  {
    key: 'presetId',
    label: '预设',
    multi: false,
    hint: '提示词编排方案：决定 AI 的写作风格与提示词装配顺序，推荐先从资源中心导入社区预设。',
  },
] as const;

export type BindingKey = (typeof BINDING_FIELDS)[number]['key'];

/** 多选绑定（角色卡/世界书）与单选绑定（预设）的统一状态 */
export type Bindings = { characterIds: string[]; worldbookIds: string[]; presetId: string };

export const EMPTY_BINDINGS: Bindings = {
  characterIds: [],
  worldbookIds: [],
  presetId: '',
};

export type BindingOptions = Record<BindingKey, LibraryAssetRef[]>;

export const EMPTY_OPTIONS: BindingOptions = {
  characterIds: [],
  worldbookIds: [],
  presetId: [],
};

interface BindingSelectorProps {
  bindings: Bindings;
  options: BindingOptions;
  optionsFailed: boolean;
  /** 任一绑定变化（多选追加/移除、单选赋值），整份回传 */
  onChange: (next: Bindings) => void;
  selectClass: string;
}

/** 绑定选择 fieldset（均可留空）：多选 = 下拉追加 + chips 移除；单选 = 直接赋值 */
export function BindingSelector({ bindings, options, optionsFailed, onChange, selectClass }: BindingSelectorProps) {
  function setBinding(key: BindingKey, value: string): void {
    if (!value) return;
    if (key === 'presetId') {
      onChange({ ...bindings, presetId: value });
      return;
    }
    const list = bindings[key];
    if (!list.includes(value)) onChange({ ...bindings, [key]: [...list, value] });
  }

  function removeBinding(key: 'characterIds' | 'worldbookIds', id: string): void {
    onChange({ ...bindings, [key]: bindings[key].filter((x) => x !== id) });
  }

  const nameOf = (key: BindingKey, id: string): string =>
    options[key].find((a) => a.id === id)?.name ?? '未知资源';

  return (
    <fieldset className="mb-4">
      <legend className="mb-1.5 text-sm text-[hsl(var(--fg-muted))]">
        绑定资源（可留空，稍后在作品内调整）
      </legend>
      {optionsFailed && (
        <p className="mb-2 text-xs text-[hsl(var(--fg-muted))]">
          资源列表加载失败，可先创建后到作品设置中绑定
        </p>
      )}
      <div className="space-y-3">
        {BINDING_FIELDS.map((field) => {
          const selected: string[] =
            field.key === 'presetId' ? (bindings.presetId ? [bindings.presetId] : []) : bindings[field.key];
          return (
            <div key={field.key}>
              <label className="flex items-center gap-3">
                <span className="flex w-14 shrink-0 items-center gap-1 text-sm">
                  {field.label}
                  <FieldHint text={field.hint} />
                </span>
                <select
                  value=""
                  onChange={(e) => setBinding(field.key, e.target.value)}
                  className={selectClass}
                >
                  <option value="" className={OPTION_CLS}>
                    {field.multi ? '添加…' : '不绑定'}
                  </option>
                  {options[field.key]
                    .filter((asset) => !selected.includes(asset.id))
                    .map((asset) => (
                      <option key={asset.id} value={asset.id} className={OPTION_CLS}>
                        {asset.name}
                      </option>
                    ))}
                </select>
              </label>
              {selected.length > 0 && (
                <div className="ml-[68px] mt-1.5 flex flex-wrap gap-1.5">
                  {selected.map((id) => (
                    <span
                      key={id}
                      className="flex items-center gap-1 rounded-full border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] py-0.5 pl-2.5 pr-1 text-xs"
                    >
                      {nameOf(field.key, id)}
                      {field.multi && (
                        <button
                          type="button"
                          aria-label={`移除 ${nameOf(field.key, id)}`}
                          onClick={() => removeBinding(field.key as 'characterIds' | 'worldbookIds', id)}
                          className="flex h-5 w-5 items-center justify-center rounded-full text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--border-soft))] hover:text-[hsl(var(--fg))]"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
