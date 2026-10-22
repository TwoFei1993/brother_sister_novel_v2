/**
 * 自动记忆管理（作品设置抽屉内）：
 * - 人物状态卡：AI 每 3 章自动抽取覆盖；作者可手动编辑（= 临时修正，下次自动抽取仍会覆盖）
 * - 伏笔登记：AI 自动抽取 + 人工勾选「已回收」；未回收项注入上下文提醒
 * 独立 PATCH（与主保存按钮解耦），乐观锁失败提示刷新。
 */
import { useState } from 'react';

import { updateWork } from '../../api/works';
import type { Work } from '@shared/work';
import type { Foreshadow } from '../../engine/prompt/novel/memory-extract';

interface MemorySectionProps {
  work: Work;
  onSaved: (work: Work) => void;
}

export default function MemorySection({ work, onSaved }: MemorySectionProps) {
  const [stateText, setStateText] = useState(work.settings.characterState ?? '');
  const [foreshadows, setForeshadows] = useState(work.settings.foreshadows ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  async function save(nextState: string, nextList: typeof foreshadows): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const next = await updateWork(work.id, {
        revision: work.revision,
        settings: { ...work.settings, characterState: nextState, foreshadows: nextList },
      });
      setStateText(next.settings.characterState ?? '');
      setForeshadows(next.settings.foreshadows ?? []);
      onSaved(next);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  function toggleResolved(id: string): void {
    setForeshadows((list) => list.map((f) => (f.id === id ? { ...f, resolved: !f.resolved } : f)));
  }

  function removeForeshadow(id: string): void {
    setForeshadows((list) => list.filter((f) => f.id !== id));
  }

  const openCount = foreshadows.filter((f) => !f.resolved).length;

  return (
    <section className="border-t border-[hsl(var(--border-soft))] pt-4" data-testid="memory-section">
      <p className="mb-1 text-sm font-medium">自动记忆（人物状态 + 伏笔）</p>
      <p className="mb-3 text-xs text-[hsl(var(--fg-muted))]">
        AI 每 3 章自动抽取人物现状与新伏笔并注入后续生成；手动编辑视为临时修正（下次自动抽取仍会覆盖）
      </p>

      <label htmlFor="character-state" className="mb-1 block text-xs text-[hsl(var(--fg-muted))]">
        人物状态卡
      </label>
      <textarea
        id="character-state"
        value={stateText}
        onChange={(e) => setStateText(e.target.value)}
        rows={4}
        data-testid="character-state"
        placeholder="尚未抽取。生成第 3 章后自动出现。"
        className="mb-3 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
      />

      {foreshadows.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs text-[hsl(var(--fg-muted))]">
            伏笔登记（未回收 {openCount} 条——已注入生成提醒）
          </p>
          <ul className="space-y-1" data-testid="foreshadow-list">
            {foreshadows.map((f: Foreshadow & { resolved?: boolean }) => (
              <li key={f.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-[hsl(var(--bg))]">
                <input
                  type="checkbox"
                  checked={f.resolved ?? false}
                  onChange={() => toggleResolved(f.id)}
                  aria-label={`标记已回收：${f.desc}`}
                  title={f.resolved ? '已回收（点击撤销）' : '标记为已回收'}
                  className="mt-0.5"
                />
                <span
                  className={`min-w-0 flex-1 text-sm ${f.resolved ? 'text-[hsl(var(--fg-muted))] line-through' : ''}`}
                >
                  {f.desc}
                  <span className="ml-2 whitespace-nowrap text-xs text-[hsl(var(--fg-muted))]">第{f.plantedAt}章埋</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeForeshadow(f.id)}
                  aria-label={`删除伏笔：${f.desc}`}
                  className="shrink-0 rounded px-1 text-xs text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="mb-2 rounded-lg bg-[hsl(var(--danger))]/10 p-2 text-xs text-[hsl(var(--danger))]" data-testid="memory-error">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void save(stateText, foreshadows)}
        disabled={saving}
        data-testid="memory-save"
        className="min-h-[36px] w-full rounded-lg border border-[hsl(var(--border-soft))] text-sm transition-colors hover:border-[hsl(var(--accent))] disabled:opacity-40"
      >
        {saving ? '保存中…' : savedFlash ? '✓ 已保存' : '保存记忆'}
      </button>
    </section>
  );
}
