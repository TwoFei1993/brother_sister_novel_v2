/**
 * 作品设置抽屉（写作台，设计 §4.4 / §7.1）
 *
 * - 作者注释：authorNote 文本域 + noteDepth 注入深度（酒馆 Author's Note 对齐）
 * - allowCardOverride 开关：允许角色卡覆盖预设（缺省开，§4.4 覆盖关系）
 * - 绑定管理：当前绑定的角色卡/世界书/预设名单（解绑编辑属 M3 资产库，此处只读展示）
 * 保存走 PATCH（revision 乐观锁），409 提示刷新；成功回传新 Work 给父级同步 store。
 */
import { useEffect, useState } from 'react';

import { updateWork } from '../../api/works';
import { listCharacters, listPresets, listWorldbooks, type LibraryAssetRef } from '../../api/library';
import type { Work } from '@shared/work';
import VoiceMapEditor from '../tts/VoiceMapEditor';

interface WorkSettingsSheetProps {
  work: Work;
  onClose: () => void;
  /** 保存成功（父级同步 workStore.setWork） */
  onSaved: (work: Work) => void;
}

/** id → name 映射辅助（绑定了但已删除的资产显示为占位） */
function nameOf(list: LibraryAssetRef[], id: string): string {
  return list.find((a) => a.id === id)?.name ?? `（已删除：${id.slice(0, 8)}…）`;
}

export default function WorkSettingsSheet({ work, onClose, onSaved }: WorkSettingsSheetProps) {
  const [note, setNote] = useState(work.settings.authorNote);
  const [noteDepth, setNoteDepth] = useState(String(work.settings.noteDepth));
  const [allowOverride, setAllowOverride] = useState(work.allowCardOverride !== false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<{
    characters: LibraryAssetRef[];
    worldbooks: LibraryAssetRef[];
    presets: LibraryAssetRef[];
  } | null>(null);

  // 打开时拉三类资产浅列表做 id→name 映射（失败不阻塞设置编辑，仅名单显示占位）
  useEffect(() => {
    let alive = true;
    Promise.all([listCharacters(), listWorldbooks(), listPresets()])
      .then(([characters, worldbooks, presets]) => {
        if (alive) setAssets({ characters, worldbooks, presets });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    const depth = Math.max(0, Math.floor(Number(noteDepth) || 0));
    try {
      const next = await updateWork(work.id, {
        revision: work.revision,
        settings: { ...work.settings, authorNote: note, noteDepth: depth },
        allowCardOverride: allowOverride,
      });
      onSaved(next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  const bindingRows: ReadonlyArray<{ label: string; names: string[] }> = [
    { label: '角色卡', names: work.characterIds.map((id) => nameOf(assets?.characters ?? [], id)) },
    { label: '世界书', names: work.worldbookIds.map((id) => nameOf(assets?.worldbooks ?? [], id)) },
    {
      label: '预设',
      names: work.presetId ? [nameOf(assets?.presets ?? [], work.presetId)] : ['（未绑定，生成用内置空预设）'],
    },
  ];

  return (
    <>
      <div onClick={onClose} aria-hidden="true" className="fixed inset-0 z-40 bg-black/50" />
      <aside
        aria-label="作品设置"
        data-testid="work-settings"
        className="safe-bottom fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-xl bg-[hsl(var(--surface))] p-5 shadow-xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:h-full sm:rounded-none sm:rounded-l-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">作品设置</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 min-w-9 items-center justify-center rounded text-sm text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          <section>
            <label htmlFor="author-note" className="mb-1 block text-sm font-medium">
              作者注释
            </label>
            <p className="mb-2 text-xs text-[hsl(var(--fg-muted))]">
              按深度注入到上下文（倒数第 N 条消息处），适合放置剧情走向与文风要求
            </p>
            <textarea
              id="author-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              data-testid="author-note"
              className="w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
              placeholder="例：本章起节奏加快，多写妹妹的心理活动…"
            />
            <div className="mt-2 flex items-center gap-2">
              <label htmlFor="note-depth" className="text-sm">
                注入深度
              </label>
              <input
                id="note-depth"
                type="number"
                min={0}
                value={noteDepth}
                onChange={(e) => setNoteDepth(e.target.value)}
                data-testid="note-depth"
                className="h-9 w-20 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-sm outline-none focus:border-[hsl(var(--accent))]"
              />
              <span className="text-xs text-[hsl(var(--fg-muted))]">条（酒馆默认 4）</span>
            </div>
          </section>

          <section className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">允许角色卡覆盖预设</p>
              <p className="text-xs text-[hsl(var(--fg-muted))]">
                开启后卡片 system_prompt / post_history_instructions 替换预设对应项（§4.4）
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={allowOverride}
              data-testid="allow-override"
              onClick={() => setAllowOverride((v) => !v)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors after:absolute after:-inset-1.5 after:content-[''] ${
                allowOverride ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--border-soft))]'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  allowOverride ? 'translate-x-5.5 left-0.5' : 'left-0.5'
                }`}
              />
            </button>
          </section>

          <section>
            <p className="mb-2 text-sm font-medium">绑定资产</p>
            <div className="space-y-2">
              {bindingRows.map((row) => (
                <div key={row.label} className="flex gap-2 text-sm">
                  <span className="w-14 shrink-0 text-[hsl(var(--fg-muted))]">{row.label}</span>
                  <span className="min-w-0 flex-1 break-words">
                    {row.names.length === 0 ? '（无）' : row.names.join('、')}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* TTS 分声绑定：独立 PATCH voiceMap（revision 乐观锁），保存后同步 store */}
          <section className="border-t border-[hsl(var(--border-soft))] pt-4">
            <VoiceMapEditor work={work} onSaved={onSaved} />
          </section>
        </div>

        {error && (
          <p data-testid="settings-error" className="mt-3 rounded-lg bg-[hsl(var(--danger))]/10 p-2 text-xs text-[hsl(var(--danger))]">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={save}
          disabled={saving}
          data-testid="settings-save"
          className="mt-4 h-10 shrink-0 rounded-lg bg-[hsl(var(--accent))] text-sm font-medium text-[hsl(var(--accent-fg))] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {saving ? '保存中…' : '保存设置'}
        </button>
      </aside>
    </>
  );
}
