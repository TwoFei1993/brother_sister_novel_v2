/**
 * 世界书单条目编辑表单（Task 27，设计 §5.2 一期字段全集）
 *
 * 受控组件：entry 由父级传入，变更以 Partial 补丁回调上报，自身不发请求。
 * 字段语义锚点：酒馆 world-info.js newWorldInfoEntryDefinition：
 * - selectiveLogic（world_info_logic :33）0 AND_ANY / 1 NOT_ALL / 2 NOT_ANY / 3 AND_ALL
 * - position（world_info_position :855）一期开放 0 before / 1 after / 4 atDepth
 *   （2/3 AN、5/6 EM 由引擎映射到前/后，编辑器不暴露）
 * - role（world_info_format）0 system / 1 user / 2 assistant
 * - scanDepth/caseSensitive/matchWholeWords：null = 跟随全局（扫描设置覆盖）
 */
import { useState, type KeyboardEvent } from 'react';
import type { TavernWorldInfoEntry } from '@shared/tavern';

import { NumberField, SelectField, TextField, ToggleField } from './EditorShell';

const LOGIC_OPTIONS = [
  { value: 0, label: '任一匹配' },
  { value: 1, label: '任一不匹配' },
  { value: 2, label: '全部不匹配' },
  { value: 3, label: '全部匹配' },
] as const;

const POSITION_OPTIONS = [
  { value: 0, label: '角色卡之前' },
  { value: 1, label: '角色卡之后' },
  { value: 4, label: '按深度注入' },
] as const;

const ROLE_OPTIONS = [
  { value: 0, label: 'system' },
  { value: 1, label: 'user' },
  { value: 2, label: 'assistant' },
] as const;

/** 布尔覆盖三态：'' = null = 跟随全局 */
const OVERRIDE_OPTIONS = [
  { value: '', label: '跟随全局' },
  { value: 'true', label: '启用' },
  { value: 'false', label: '禁用' },
] as const;

export interface EntryEditorProps {
  entry: TavernWorldInfoEntry;
  /** 局部补丁合入该条目 */
  onChange: (patch: Partial<TavernWorldInfoEntry>) => void;
}

// ---------- 键 chips 输入 ----------

interface ChipsInputProps {
  label: string;
  tip: string;
  /** 测试定位（如 chips-key / chips-keysecondary） */
  testId: string;
  values: string[];
  onChange: (next: string[]) => void;
}

/** 键输入：逗号（中英）/回车切分为 chip；Backspace 删尾 chip；chip 点 × 删除；失焦收尾 */
export function ChipsInput({ label, tip, testId, values, onChange }: ChipsInputProps) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const parts = draft
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !values.includes(s));
    if (parts.length === 0) return;
    onChange([...values, ...parts]);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="text-xs text-[hsl(var(--fg-muted))]" title={tip} data-testid={testId}>
      {label}
      <div className="mt-1 flex min-h-[36px] flex-wrap items-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] px-2 py-1">
        {values.map((k) => (
          <span
            key={k}
            data-chip={k}
            className="flex items-center gap-1 rounded-full bg-[hsl(var(--accent))]/15 px-2 py-0.5 text-xs text-[hsl(var(--accent))]"
          >
            {k}
            <button
              type="button"
              aria-label={`删除键 ${k}`}
              onClick={() => onChange(values.filter((v) => v !== k))}
              className="text-[hsl(var(--fg-muted))] hover:text-red-400"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          placeholder={values.length === 0 ? '输入后回车/逗号添加' : ''}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          className="min-w-[80px] flex-1 bg-transparent py-0.5 text-sm text-[hsl(var(--fg))] outline-none"
        />
      </div>
    </div>
  );
}

// ---------- 主表单 ----------

/** 数值兜底：字段缺失/nullish 时显示的默认值 */
const num = (v: number | null | undefined, fallback: number): number => (typeof v === 'number' ? v : fallback);

export default function EntryEditor({ entry, onChange }: EntryEditorProps) {
  const atDepth = entry.position === 4;

  return (
    <div data-testid="entry-editor" className="flex flex-col gap-3">
      <TextField
        label="备注名"
        tip="条目标题（酒馆 comment 字段），仅用于列表展示"
        value={entry.comment ?? ''}
        onChange={(comment) => onChange({ comment })}
      />

      <ChipsInput
        label="主键"
        tip="触发该条目的关键词，多个用逗号/回车分隔；支持 /正则/ 格式"
        testId="chips-key"
        values={entry.key ?? []}
        onChange={(key) => onChange({ key })}
      />
      <ChipsInput
        label="二级键"
        tip="配合下方逻辑对主键做二次过滤；留空则仅按主键判定"
        testId="chips-keysecondary"
        values={entry.keysecondary ?? []}
        onChange={(keysecondary) => onChange({ keysecondary })}
      />

      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="二级键逻辑"
          tip="主键命中后如何结合二级键判定"
          value={num(entry.selectiveLogic, 0)}
          onChange={(selectiveLogic) => onChange({ selectiveLogic })}
          options={LOGIC_OPTIONS}
        />
        <SelectField
          label="插入位置"
          tip="AN/EM 位置由引擎映射到相近的前/后（设计 §5.2）"
          value={num(entry.position, 0)}
          onChange={(position) => onChange({ position })}
          options={POSITION_OPTIONS}
        />
      </div>

      <TextField
        label="内容"
        tip="命中后注入提示词的正文"
        textarea
        rows={8}
        value={entry.content ?? ''}
        onChange={(content) => onChange({ content })}
      />

      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <ToggleField
          label="常驻条目"
          tip="开启后跳过关键词判定，每轮必定注入（constant）"
          checked={entry.constant === true}
          onChange={(constant) => onChange({ constant })}
        />
        <ToggleField
          label="禁用条目"
          tip="开启后该条目不参与扫描（disable）"
          checked={entry.disable === true}
          onChange={(disable) => onChange({ disable })}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <NumberField
          label="顺序 order"
          tip="插入优先级，越大越靠前"
          value={num(entry.order, 100)}
          onChange={(order) => onChange({ order: order ?? 100 })}
          min={0}
        />
        <NumberField
          label="触发概率 %"
          tip="每次扫描按概率触发（probability）"
          value={num(entry.probability, 100)}
          onChange={(probability) => onChange({ probability: probability ?? 100 })}
          min={0}
        />
        {atDepth && (
          <NumberField
            label="注入深度"
            tip="距对话末尾的层数（depth，仅按深度注入时生效）"
            value={num(entry.depth, 4)}
            onChange={(depth) => onChange({ depth: depth ?? 4 })}
            min={0}
          />
        )}
      </div>

      {atDepth && (
        <SelectField
          label="消息角色"
          tip="深度注入时的消息角色（role）"
          value={num(entry.role, 0)}
          onChange={(role) => onChange({ role })}
          options={ROLE_OPTIONS}
        />
      )}

      <fieldset className="rounded-xl border border-[hsl(var(--border-soft))] p-3">
        <legend className="px-1 text-xs text-[hsl(var(--fg-muted))]">扫描设置覆盖（留空 = 跟随全局）</legend>
        <div className="grid grid-cols-3 gap-3">
          <NumberField
            label="扫描深度"
            tip="覆盖全局扫描深度：往回检查的聊天层数"
            value={entry.scanDepth ?? null}
            onChange={(scanDepth) => onChange({ scanDepth })}
            min={0}
          />
          <SelectField
            label="区分大小写"
            tip="覆盖全局大小写敏感设置"
            value={entry.caseSensitive == null ? '' : String(entry.caseSensitive)}
            onChange={(v) => onChange({ caseSensitive: v === '' ? null : v === 'true' })}
            options={OVERRIDE_OPTIONS}
          />
          <SelectField
            label="全词匹配"
            tip="覆盖全局全词匹配设置（仅对拉丁词生效）"
            value={entry.matchWholeWords == null ? '' : String(entry.matchWholeWords)}
            onChange={(v) => onChange({ matchWholeWords: v === '' ? null : v === 'true' })}
            options={OVERRIDE_OPTIONS}
          />
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <ToggleField
          label="不被递归扫描"
          tip="本条目内容不再触发其他条目（excludeRecursion）"
          checked={entry.excludeRecursion === true}
          onChange={(excludeRecursion) => onChange({ excludeRecursion })}
        />
        <ToggleField
          label="不触发递归"
          tip="本条目内容不进入后续递归扫描文本（preventRecursion）"
          checked={entry.preventRecursion === true}
          onChange={(preventRecursion) => onChange({ preventRecursion })}
        />
      </div>
    </div>
  );
}
