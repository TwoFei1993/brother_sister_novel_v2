/**
 * 新建作品弹窗（设计 §7.1 / 新建流程）：标题 + 模式 + 题材 + 绑定选择
 *
 * - 模式单选：互动小说（novel）/ 对话写作（chat），创建后锁定不可切换
 * - 题材：shared GenreType 枚举，驱动卡片渐变与后续主题
 * - 绑定：角色卡/世界书/预设下拉（GET 浅列表，均可留空；预设默认绑定逻辑属后续任务）
 * - 提交：POST /api/works → 跳 /work/:id
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { createWork } from '../../api/works';
import { listCharacters, listWorldbooks, listPresets, type LibraryAssetRef } from '../../api/library';
import { ApiError } from '../../api/client';
import type { WorkMode } from '@shared/work';
import { GENRE_OPTIONS } from './genres';

interface NewWorkDialogProps {
  onClose: () => void;
}

const MODE_CHOICES: ReadonlyArray<{ value: WorkMode; label: string; hint: string }> = [
  { value: 'novel', label: '互动小说', hint: '指令驱动 · 章节续写' },
  { value: 'chat', label: '对话写作', hint: '酒馆式角色扮演' },
];

const BINDING_FIELDS = [
  { key: 'characterIds', label: '角色卡', listKey: 'characters' },
  { key: 'worldbookIds', label: '世界书', listKey: 'worldbooks' },
  { key: 'presetId', label: '预设', listKey: 'presets' },
] as const;

type BindingKey = (typeof BINDING_FIELDS)[number]['key'];

const EMPTY_BINDINGS: Record<BindingKey, string> = {
  characterIds: '',
  worldbookIds: '',
  presetId: '',
};

const EMPTY_OPTIONS: Record<BindingKey, LibraryAssetRef[]> = {
  characterIds: [],
  worldbookIds: [],
  presetId: [],
};

export default function NewWorkDialog({ onClose }: NewWorkDialogProps) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<WorkMode>('novel');
  const [genre, setGenre] = useState<string>(GENRE_OPTIONS[0].value);
  const [bindings, setBindings] = useState<Record<BindingKey, string>>(EMPTY_BINDINGS);
  const [options, setOptions] = useState<Record<BindingKey, LibraryAssetRef[]>>(EMPTY_OPTIONS);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 资产选项并行拉取；单类失败降级为空列表（不阻塞建作品）
  useEffect(() => {
    let alive = true;
    Promise.all([listCharacters(), listWorldbooks(), listPresets()])
      .then(([characters, worldbooks, presets]) => {
        if (!alive) return;
        setOptions({ characterIds: characters, worldbookIds: worldbooks, presetId: presets });
      })
      .catch(() => {
        if (alive) setOptionsFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  function setBinding(key: BindingKey, value: string): void {
    setBindings((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const work = await createWork({
        title: trimmed,
        mode,
        genre,
        characterIds: bindings.characterIds ? [bindings.characterIds] : [],
        worldbookIds: bindings.worldbookIds ? [bindings.worldbookIds] : [],
        presetId: bindings.presetId,
      });
      navigate(`/work/${work.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建失败，请重试');
      setSubmitting(false);
    }
  }

  const selectClass =
    'h-11 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm text-[hsl(var(--fg))] outline-none focus:border-[hsl(var(--accent))]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={submitting ? undefined : onClose}
      role="presentation"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        role="dialog"
        aria-modal="true"
        aria-label="新建作品"
        onClick={(e) => e.stopPropagation()}
        className="safe-bottom max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-6 shadow-2xl"
      >
        <h2 className="mb-5 text-lg font-semibold">新建作品</h2>

        {/* 标题 */}
        <label className="mb-4 block">
          <span className="mb-1.5 block text-sm text-[hsl(var(--fg-muted))]">标题</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="给作品起个名字"
            autoFocus
            maxLength={60}
            className="h-11 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-base outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
          />
        </label>

        {/* 模式单选 */}
        <div className="mb-4" role="radiogroup" aria-label="作品模式">
          <span className="mb-1.5 block text-sm text-[hsl(var(--fg-muted))]">模式（创建后不可切换）</span>
          <div className="grid grid-cols-2 gap-2">
            {MODE_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={mode === choice.value}
                onClick={() => setMode(choice.value)}
                className={`flex min-h-14 flex-col items-start justify-center rounded-lg border px-3 py-2 text-left transition-colors ${
                  mode === choice.value
                    ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/15'
                    : 'border-[hsl(var(--border-soft))] hover:border-[hsl(var(--fg-muted))]'
                }`}
              >
                <span className="text-sm font-medium">{choice.label}</span>
                <span className="text-xs text-[hsl(var(--fg-muted))]">{choice.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 题材 */}
        <label className="mb-4 block">
          <span className="mb-1.5 block text-sm text-[hsl(var(--fg-muted))]">题材</span>
          <select value={genre} onChange={(e) => setGenre(e.target.value)} className={selectClass}>
            {GENRE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {/* 绑定选择（均可留空） */}
        <fieldset className="mb-4">
          <legend className="mb-1.5 text-sm text-[hsl(var(--fg-muted))]">
            绑定资源（可留空，稍后在作品内调整）
          </legend>
          {optionsFailed && (
            <p className="mb-2 text-xs text-[hsl(var(--fg-muted))]">
              资源列表加载失败，可先创建后到作品设置中绑定
            </p>
          )}
          <div className="space-y-2">
            {BINDING_FIELDS.map((field) => (
              <label key={field.key} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-sm">{field.label}</span>
                <select
                  value={bindings[field.key]}
                  onChange={(e) => setBinding(field.key, e.target.value)}
                  className={selectClass}
                >
                  <option value="">不绑定</option>
                  {options[field.key].map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="mb-3 text-sm text-[hsl(var(--danger))]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-11 rounded-lg px-5 text-sm text-[hsl(var(--fg-muted))] transition-colors hover:text-[hsl(var(--fg))] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!title.trim() || submitting}
            className="h-11 rounded-lg bg-[hsl(var(--accent))] px-6 text-sm font-medium text-[hsl(var(--accent-fg))] transition-opacity disabled:opacity-40"
          >
            {submitting ? '创建中…' : '创建作品'}
          </button>
        </div>
      </form>
    </div>
  );
}
