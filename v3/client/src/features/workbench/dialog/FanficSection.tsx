/**
 * 同人信息编辑区（用户需求 2026-11-22：软件理解「同人」——原著信息随书资料注入生成）：
 * 原著名称 / 衍生类型 / 同人要点三字段，仅同人题材书显示（父级按 work.genre 控制）。
 * 保存走 PATCH（revision 乐观锁）独立于抽屉主保存，409 提示刷新；成功回传新 Work 同步 store。
 * 原著详细设定（人物/世界观/时间线）引导录入世界书/角色卡——生成时自动扫描注入。
 */
import { useEffect, useState } from 'react';

import { apiFetch } from '../../../api/client';
import { updateWork } from '../../../api/works';
import { FANDOM_TYPE_LABELS, type FandomType, type Work } from '@shared/work';

export default function FanficSection({ work, onSaved }: { work: Work; onSaved: (w: Work) => void }) {
  const s = work.settings;
  const [source, setSource] = useState(s.fandomSource ?? '');
  const [type, setType] = useState<FandomType | ''>(s.fandomType ?? '');
  const [notes, setNotes] = useState(s.fandomNotes ?? '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 外部保存（或切换作品）→ revision 变化 → 本地编辑态与服务端对齐（同 StyleClonePanel）
  useEffect(() => {
    setSource(s.fandomSource ?? '');
    setType(s.fandomType ?? '');
    setNotes(s.fandomNotes ?? '');
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.revision]);

  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setErr(null);
    try {
      const latest = await apiFetch<Work>(`/api/works/${work.id}`);
      const updated = await updateWork(work.id, {
        revision: latest.revision,
        settings: {
          ...latest.settings,
          fandomSource: source.trim(),
          ...(type !== '' ? { fandomType: type } : { fandomType: undefined }),
          fandomNotes: notes.trim(),
        },
      });
      onSaved(updated);
      setDirty(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 py-1.5 text-sm outline-none focus:border-[hsl(var(--accent))]';

  return (
    <section className="border-t border-[hsl(var(--border-soft))] pt-4" data-testid="fanfic-section">
      <p className="mb-1 text-sm font-medium">同人信息</p>
      <p className="mb-3 text-xs text-[hsl(var(--fg-muted))]">
        原著信息与同人要点会注入每次生成（模型据此理解「同人」并忠于原著）。
        原著的详细设定（人物关系/世界观/时间线）建议录入世界书或角色卡，生成时自动扫描注入。
      </p>
      <label className="mb-3 block">
        <span className="mb-1 block text-xs text-[hsl(var(--fg-muted))]">原著名称</span>
        <input
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setDirty(true);
          }}
          placeholder="如：某小说 / 某影视 / 某动漫"
          aria-label="原著名称"
          data-testid="fanfic-source"
          className={inputCls}
        />
      </label>
      <label className="mb-3 block">
        <span className="mb-1 block text-xs text-[hsl(var(--fg-muted))]">衍生类型</span>
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as FandomType | '');
            setDirty(true);
          }}
          aria-label="衍生类型"
          data-testid="fanfic-type"
          className={inputCls}
        >
          <option value="">未指定</option>
          {Object.entries(FANDOM_TYPE_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="mb-3 block">
        <span className="mb-1 block text-xs text-[hsl(var(--fg-muted))]">同人要点（CP / 时间线 / 注意事项等）</span>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setDirty(true);
          }}
          placeholder="如：兄妹主线不变；时间线在原作大结局之后；反派 X 已死不再出现"
          aria-label="同人要点"
          data-testid="fanfic-notes"
          rows={3}
          maxLength={2000}
          className={inputCls}
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty}
          data-testid="fanfic-save"
          className="h-8 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium text-white disabled:opacity-40"
        >
          {saving ? '保存中…' : '保存同人信息'}
        </button>
        {dirty && <span className="text-[11px] text-amber-500">有未保存的更改</span>}
      </div>
      {err && <p className="mt-1 text-xs text-[hsl(var(--danger))]">{err}</p>}
    </section>
  );
}
