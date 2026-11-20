/**
 * 预设风格标签编辑器（深度测试补齐：PresetAsset.tags 此前无任何写入入口）
 *
 * - chips 显示当前 tags，点 × 删除；输入框 + Enter/按钮添加
 * - 常用标签快捷点击（通用/治愈/热血/古风/悬疑/权谋）
 * - 变更即 PATCH /api/presets/:id { tags }（独立于 raw 保存流，crud 浅合并语义）
 * - 「通用」标签 = 所有作品常驻推荐；其余标签按书风格关键词匹配推荐（StylePresetSection）
 */
import { useState } from 'react';
import { updatePresetTags } from '../../../api/library';

const QUICK_TAGS = ['通用', '治愈', '热血', '古风', '悬疑', '权谋'] as const;

export interface PresetTagEditorProps {
  presetId: string;
  tags: string[];
  /** 保存成功回传新 tags（父级同步状态） */
  onChanged: (tags: string[]) => void;
  notify: (kind: 'ok' | 'err', text: string) => void;
}

export default function PresetTagEditor({ presetId, tags, onChanged, notify }: PresetTagEditorProps) {
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (next: string[]) => {
    setSaving(true);
    try {
      await updatePresetTags(presetId, next);
      onChanged(next);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '标签保存失败');
    } finally {
      setSaving(false);
    }
  };

  const add = (raw: string) => {
    const tag = raw.trim().slice(0, 12);
    if (!tag || tags.includes(tag) || saving) return;
    void save([...tags, tag]);
    setInput('');
  };

  const remove = (tag: string) => {
    if (saving) return;
    void save(tags.filter((t) => t !== tag));
  };

  const unusedQuick = QUICK_TAGS.filter((t) => !tags.includes(t));

  return (
    <div
      aria-label="风格标签"
      data-testid="preset-tag-editor"
      className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface-2,transparent))] px-3 py-2"
    >
      <span className="text-xs text-[hsl(var(--fg-muted))]">风格标签：</span>
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full bg-[hsl(var(--accent))]/12 px-2 py-0.5 text-xs text-[hsl(var(--accent))]"
        >
          {tag}
          <button
            type="button"
            aria-label={`删除标签 ${tag}`}
            onClick={() => remove(tag)}
            className="text-[hsl(var(--fg-muted))] hover:text-red-400"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(input);
          }
        }}
        placeholder="加标签，回车确认"
        aria-label="新标签输入"
        className="min-w-[9rem] flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-transparent px-2 py-1 text-xs outline-none focus:border-[hsl(var(--accent))]"
      />
      {input.trim() && (
        <button
          type="button"
          onClick={() => add(input)}
          disabled={saving}
          className="min-h-[28px] rounded-lg bg-[hsl(var(--accent))] px-2 text-xs text-white disabled:opacity-40"
        >
          添加
        </button>
      )}
      {unusedQuick.length > 0 && (
        <span className="flex flex-wrap items-center gap-1">
          {unusedQuick.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => add(t)}
              disabled={saving}
              className="rounded-full border border-[hsl(var(--border-soft))] px-2 py-0.5 text-[11px] text-[hsl(var(--fg-muted))] transition-colors hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))] disabled:opacity-40"
            >
              +{t}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
