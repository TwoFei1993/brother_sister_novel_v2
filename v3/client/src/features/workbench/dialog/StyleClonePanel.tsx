/**
 * 文风复刻面板（作品设置抽屉内嵌；自 WorkSettingsSheet 拆出）
 *
 * - 粘贴参考文字（建议 ≥200 字）→「分析文风」调 LLM 提炼画像（只提炼写法不复述内容）
 * - 画像预览可手改 →「保存到作品」写入 settings.styleGuide（PATCH，revision 乐观锁）
 * - 当前画像可手编辑 /「清除文风」置空即回默认文风
 */
import { useState } from 'react';

import { updateWork } from '../../../api/works';
import { MIN_SAMPLE_CHARS, analyzeStyle } from '../../../lib/style';
import { useSettingsStore } from '../../../stores/settings';
import type { Work } from '@shared/work';

interface StyleClonePanelProps {
  work: Work;
  /** 保存成功（父级同步 workStore.setWork） */
  onSaved: (work: Work) => void;
}

const textareaCls =
  'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-3 text-sm outline-none focus:border-[hsl(var(--accent))]';
const btnCls =
  'h-9 rounded-lg px-3 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40';

export default function StyleClonePanel({ work, onSaved }: StyleClonePanelProps) {
  const llmPrefs = useSettingsStore((s) => s.llmPrefs);
  const [sample, setSample] = useState('');
  const [profile, setProfile] = useState('');
  const [guide, setGuide] = useState(work.settings.styleGuide ?? '');
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = sample.trim().length > 0 && sample.trim().length < MIN_SAMPLE_CHARS;

  /** PATCH styleGuide（revision 乐观锁；置空 = 清除文风回默认） */
  async function saveGuide(value: string): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const next = await updateWork(work.id, {
        revision: work.revision,
        settings: { ...work.settings, styleGuide: value },
      });
      setGuide(value);
      setProfile('');
      onSaved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  /** 分析文风：LLM 提炼画像 → 预览（可手改后再保存） */
  async function runAnalyze(): Promise<void> {
    setAnalyzing(true);
    setError(null);
    try {
      setProfile(await analyzeStyle(llmPrefs, sample));
    } catch (err) {
      setError(err instanceof Error ? err.message : '分析失败，请重试');
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div data-testid="style-clone-panel">
      {/* 参考文字 → 分析 */}
      <label htmlFor="style-sample" className="mb-1 block text-sm font-medium">
        文风复刻
      </label>
      <p className="mb-2 text-xs text-[hsl(var(--fg-muted))]">
        粘贴一段参考文字（建议 {MIN_SAMPLE_CHARS} 字以上），只学习文风不学习内容
      </p>
      <textarea
        id="style-sample"
        value={sample}
        onChange={(e) => setSample(e.target.value)}
        rows={4}
        data-testid="style-sample"
        className={textareaCls}
        placeholder="例：粘贴一段你喜欢的小说开头…"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-[hsl(var(--fg-muted))]">
          {tooShort ? '字数偏少，画像可能不准' : `已粘贴 ${sample.trim().length} 字`}
        </span>
        <button
          type="button"
          onClick={runAnalyze}
          disabled={analyzing || sample.trim().length === 0}
          data-testid="style-analyze"
          className={`${btnCls} bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]`}
        >
          {analyzing ? '分析中…' : '分析文风'}
        </button>
      </div>

      {/* 画像预览（分析结果，可手改后保存） */}
      {profile && (
        <div className="mt-3">
          <label htmlFor="style-profile" className="mb-1 block text-sm font-medium">
            文风画像（可修改）
          </label>
          <textarea
            id="style-profile"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            rows={5}
            data-testid="style-profile"
            className={textareaCls}
          />
          <button
            type="button"
            onClick={() => saveGuide(profile.trim())}
            disabled={saving || profile.trim().length === 0}
            data-testid="style-save-profile"
            className={`${btnCls} mt-2 w-full border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))]`}
          >
            保存到作品
          </button>
        </div>
      )}

      {/* 当前画像：可手编辑 / 清除 */}
      <div className="mt-3">
        <label htmlFor="style-guide" className="mb-1 block text-sm font-medium">
          当前文风画像
        </label>
        {guide.trim() ? (
          <p className="mb-2 text-xs text-[hsl(var(--fg-muted))]">已启用，生成时以最高优先级注入</p>
        ) : (
          <p className="mb-2 text-xs text-[hsl(var(--fg-muted))]">未设置，使用默认文风</p>
        )}
        <textarea
          id="style-guide"
          value={guide}
          onChange={(e) => setGuide(e.target.value)}
          rows={4}
          data-testid="style-guide"
          className={textareaCls}
          placeholder="例：短句为主，动作为主，少用形容词…"
        />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => saveGuide(guide.trim())}
            disabled={saving}
            data-testid="style-save-guide"
            className={`${btnCls} flex-1 bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]`}
          >
            保存画像
          </button>
          <button
            type="button"
            onClick={() => saveGuide('')}
            disabled={saving || guide.trim().length === 0}
            data-testid="style-clear"
            className={`${btnCls} flex-1 border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))]`}
          >
            清除文风
          </button>
        </div>
      </div>

      {error && (
        <p data-testid="style-error" className="mt-2 rounded-lg bg-[hsl(var(--danger))]/10 p-2 text-xs text-[hsl(var(--danger))]">
          {error}
        </p>
      )}
    </div>
  );
}
