/**
 * 作品级 TTS 分声绑定面板（设计 §7.3 voiceMap / Task 29）
 *
 * - 每个绑定角色一行：角色名 + 声音下拉（未设置 = 跟随旁白声）
 * - 旁白默认声单独一行；保存 PATCH work.voiceMap（revision 乐观锁，返回全量 Work）
 * - 保存成功经 onSaved 上抛（宿主同步 workStore）；本组件不直接订阅 store
 */
import { useCallback, useEffect, useState } from 'react';

import { listCharacters, type LibraryAssetRef } from '../../api/library';
import { updateWork } from '../../api/works';
import { OPTION_CLS } from '../../components/ui-select';
import type { Work } from '@shared/work';
import { NARRATOR_VOICE_KEY, VOICES } from '../../lib/tts/voice-route';

interface VoiceMapEditorProps {
  work: Work;
  /** 保存成功回调（参数为服务端返回的更新后 Work） */
  onSaved?: (work: Work) => void;
}

/** 一行绑定：角色名 + 声音 id（''=未设置，路由时回退旁白声） */
interface VoiceRow {
  name: string;
  voice: string;
}

const selectCls =
  'h-9 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-sm outline-none focus:border-[hsl(var(--accent))]';

function toRows(work: Work, characters: LibraryAssetRef[]): VoiceRow[] {
  const bound = characters.filter((c) => work.characterIds.includes(c.id));
  // 绑定角色优先；voiceMap 里存在但不在绑定列表的名字也列出（历史绑定不丢失；narrator 键除外）
  const names = [
    ...bound.map((c) => c.name),
    ...Object.keys(work.voiceMap).filter((n) => n !== NARRATOR_VOICE_KEY && !bound.some((c) => c.name === n)),
  ];
  return names.map((name) => ({ name, voice: work.voiceMap[name] ?? '' }));
}

export default function VoiceMapEditor({ work, onSaved }: VoiceMapEditorProps) {
  const [rows, setRows] = useState<VoiceRow[]>([]);
  const [narratorVoice, setNarratorVoice] = useState(work.voiceMap[NARRATOR_VOICE_KEY] ?? '');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCharacters()
      .then((characters) => {
        if (cancelled) return;
        setRows(toRows(work, characters));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // work.voiceMap 初值仅在挂载时取（保存后宿主以新 Work 重挂）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setRowVoice = useCallback((name: string, voice: string) => {
    setRows((rs) => rs.map((r) => (r.name === name ? { ...r, voice } : r)));
  }, []);

  async function handleSave(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setSaveMsg(null);
    const voiceMap: Record<string, string> = {};
    for (const r of rows) if (r.voice) voiceMap[r.name] = r.voice;
    if (narratorVoice) voiceMap[NARRATOR_VOICE_KEY] = narratorVoice;
    try {
      const updated = await updateWork(work.id, { revision: work.revision, voiceMap });
      setSaveMsg({ kind: 'ok', text: '已保存' });
      onSaved?.(updated);
    } catch {
      setSaveMsg({ kind: 'err', text: '保存失败，请稍后重试' });
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <section aria-label="TTS 分声绑定" className="p-4">
        <p role="alert" className="text-sm text-[hsl(var(--danger))]">
          角色列表加载失败，请刷新重试
        </p>
      </section>
    );
  }

  return (
    <section aria-label="TTS 分声绑定" className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold">TTS 分声绑定</h3>
        <p className="mt-1 text-xs text-[hsl(var(--fg-muted))]">
          为角色分配不同声音；正文中的对白段落按说话人自动选声，未设置的角色与旁白使用默认声。
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-[hsl(var(--fg-muted))]">角色加载中…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[hsl(var(--fg-muted))]">本作品尚未绑定角色卡，仅旁白声生效。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.name} className="flex items-center justify-between gap-3" data-testid={`voice-row-${row.name}`}>
              <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
              <select
                aria-label={`${row.name} 的声音`}
                data-testid={`voice-select-${row.name}`}
                value={row.voice}
                onChange={(e) => setRowVoice(row.name, e.target.value)}
                className={selectCls}
              >
                <option value="" className={OPTION_CLS}>未设置（用旁白声）</option>
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id} className={OPTION_CLS}>
                    {v.name}（{v.gender === 'female' ? '女' : '男'}）
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-[hsl(var(--border-soft))] pt-3">
        <span className="text-sm">旁白默认声</span>
        <select
          aria-label="旁白默认声音"
          data-testid="narrator-voice"
          value={narratorVoice}
          onChange={(e) => setNarratorVoice(e.target.value)}
          className={selectCls}
        >
          <option value="" className={OPTION_CLS}>跟随播放条（晓晓）</option>
          {VOICES.map((v) => (
            <option key={v.id} value={v.id} className={OPTION_CLS}>
              {v.name}（{v.gender === 'female' ? '女' : '男'}）
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving || loading}
          data-testid="voice-map-save"
          onClick={() => void handleSave()}
          className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent-fg))] transition-opacity disabled:opacity-40"
        >
          {saving ? '保存中…' : '保存绑定'}
        </button>
        {saveMsg && (
          <p role={saveMsg.kind === 'err' ? 'alert' : 'status'} className="text-sm">
            {saveMsg.text}
          </p>
        )}
      </div>
    </section>
  );
}
