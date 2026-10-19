/**
 * 编辑器共享 UI（Task 27）
 *
 * EditorShell：全屏弹层壳（头部：关闭/标题/未保存徽标/保存），
 * 世界书与角色卡编辑器共用，保证一致的保存动线。
 * Field 原语：label + FieldHint 问号说明（第二轮体验改进，替代裸 title）。
 */
import type { ReactNode } from 'react';

import FieldHint from '../../../components/FieldHint';
import { OPTION_CLS, SELECT_TONE_CLS } from '../../../components/ui-select';

export interface EditorShellProps {
  title: string;
  dirty: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
}

export default function EditorShell({ title, dirty, saving, onClose, onSave, children }: EditorShellProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[hsl(var(--bg))] text-[hsl(var(--fg))]">
      <header className="flex items-center gap-3 border-b border-[hsl(var(--border-soft))] px-4 py-2">
        <button
          type="button"
          aria-label="关闭编辑器"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[hsl(var(--border-soft))] text-lg transition-colors hover:border-[hsl(var(--accent))]"
        >
          ←
        </button>
        <h2 className="truncate text-base font-semibold">{title}</h2>
        {dirty && (
          <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-500">未保存</span>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          data-testid="editor-save"
          title="保存全部改动；有未保存改动时按钮亮起"
          className="ml-auto min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

// ---------- 字段原语（label 包裹式，说明走 FieldHint 问号） ----------

const fieldInputCls =
  'mt-1 min-h-[36px] w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-sm text-[hsl(var(--fg))]';

/** label 行：文字 + 问号提示（title 悬停可见） */
function FieldLabel({ label, tip }: { label: string; tip?: string }) {
  return (
    <span className="flex items-center gap-1">
      {label}
      {tip && <FieldHint text={tip} />}
    </span>
  );
}

export interface BaseFieldProps {
  /** 中文标签 */
  label: string;
  /** 简短说明（FieldHint 悬停提示） */
  tip?: string;
}

export function TextField({
  label, tip, value, onChange, textarea, rows = 4, placeholder,
}: BaseFieldProps & {
  value: string;
  onChange: (v: string) => void;
  /** true 时渲染多行 textarea */
  textarea?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs text-[hsl(var(--fg-muted))]">
      <FieldLabel label={label} tip={tip} />
      {textarea ? (
        <textarea
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 py-1.5 text-sm text-[hsl(var(--fg))]"
        />
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={fieldInputCls}
        />
      )}
    </label>
  );
}

export function NumberField({
  label, tip, value, onChange, min,
}: BaseFieldProps & { value: number | null; onChange: (v: number | null) => void; min?: number }) {
  return (
    <label className="block text-xs text-[hsl(var(--fg-muted))]">
      <FieldLabel label={label} tip={tip} />
      <input
        type="number"
        min={min}
        // null（可选覆盖未设置）显示为空
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? null : Number(raw));
        }}
        className={fieldInputCls}
      />
    </label>
  );
}

export function SelectField<T extends string | number>({
  label, tip, value, onChange, options,
}: BaseFieldProps & {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <label className="block text-xs text-[hsl(var(--fg-muted))]">
      <FieldLabel label={label} tip={tip} />
      <select
        value={String(value)}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
        className={`${fieldInputCls} ${SELECT_TONE_CLS}`}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} className={OPTION_CLS}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ToggleField({
  label, tip, checked, onChange,
}: BaseFieldProps & { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[36px] cursor-pointer items-center gap-2 text-xs text-[hsl(var(--fg-muted))]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[hsl(var(--accent))]"
      />
      <FieldLabel label={label} tip={tip} />
    </label>
  );
}
