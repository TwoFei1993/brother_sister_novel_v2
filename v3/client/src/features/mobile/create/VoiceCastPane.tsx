/**
 * 角色配音面板（移动创作「资料」分区）：作品级 TTS 分声（work.voiceMap，桌面配音编辑器同源）
 *
 * - 首次进入（voiceMap 缺角色项）自动分配初始音色：MiniMax 池按名字性别轮替，旁白固定主持人女
 * - 每行点开 VoicePicker 全量换声（Edge 免费 + MiniMax）；「重新自动分配」一键重置
 * - 保存：GET 最新 work 取 revision → PATCH voiceMap（乐观锁，失败提示重试）
 */
import { useEffect, useState } from 'react';

import { apiFetch } from '../../../api/client';
import { listCharacters } from '../../../api/library';
import { updateWork } from '../../../api/works';
import { ALL_VOICES, NARRATOR_CAST_ID, normalizeVoiceMap } from '../../../lib/tts/mobile-cast';
import { NARRATOR_VOICE_KEY, autoCastVoices } from '../../../lib/tts/voice-route';
import type { Work } from '@shared/work';

import VoicePicker from '../VoicePicker';

interface Props {
  work: Work;
  /** 保存成功回调（宿主同步 workStore） */
  onUpdated: (w: Work) => void;
}

/** 音色 id → 展示名（未知 id 原样展示） */
function voiceName(id: string | undefined): string {
  if (!id) return '未设置';
  return ALL_VOICES.find((v) => v.id === id)?.name ?? id;
}

export default function VoiceCastPane({ work, onUpdated }: Props) {
  const [cast, setCast] = useState<Record<string, string>>({});
  const [names, setNames] = useState<string[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** PATCH voiceMap（乐观锁：取最新 work；失败仅提示，本地已更新） */
  async function persist(next: Record<string, string>): Promise<void> {
    try {
      const latest = await apiFetch<Work>(`/api/works/${work.id}`);
      const updated = await updateWork(work.id, { revision: latest.revision, voiceMap: next });
      onUpdated(updated);
    } catch {
      setError('配音保存失败（可能版本冲突），改动未同步');
    }
  }

  /** 组装音色表：保留已有分配，缺失角色自动补（初始=全缺 → 自动分配初始版本） */
  function withAutoAssign(base: Record<string, string>, characterNames: string[]): Record<string, string> {
    const missing = characterNames.filter((n) => !base[n]);
    if (missing.length === 0) {
      return base[NARRATOR_VOICE_KEY] ? base : { ...base, [NARRATOR_VOICE_KEY]: NARRATOR_CAST_ID };
    }
    const auto = autoCastVoices(missing);
    const next = { ...base };
    for (const { name, voice } of auto) next[name] = voice;
    if (!next[NARRATOR_VOICE_KEY]) next[NARRATOR_VOICE_KEY] = NARRATOR_CAST_ID;
    return next;
  }

  useEffect(() => {
    let alive = true;
    setError(null);
    listCharacters()
      .then((characters) => {
        if (!alive) return;
        const bound = characters.filter((c) => work.characterIds.includes(c.id)).map((c) => c.name);
        // voiceMap 里已分配但未绑定的名字保留（历史角色不丢）
        const history = Object.keys(work.voiceMap).filter(
          (n) => n !== NARRATOR_VOICE_KEY && !bound.includes(n),
        );
        const all = [...bound, ...history];
        const prev = normalizeVoiceMap(work.voiceMap); // 旧连字符 id 自愈
        const next = withAutoAssign({ ...prev }, bound);
        const added = Object.keys(next).filter((k) => prev[k] !== next[k]);
        setNames(all);
        setCast(next);
        if (added.length > 0) void persist(next); // 自动分配/修复了音色才写回
      })
      .catch(() => {
        if (alive) setError('角色列表加载失败');
      });
    return () => {
      alive = false;
    };
    // 初始化仅在挂载/换书时执行一次（换声走 setCast + persist，不回灌本 effect）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id]);

  function assign(name: string, voice: string): void {
    const next = { ...cast, [name]: voice };
    setCast(next);
    setPicking(null);
    void persist(next);
  }

  function reassignAll(): void {
    const next = withAutoAssign({}, names);
    setCast(next);
    void persist(next);
  }

  const rows = [NARRATOR_VOICE_KEY, ...names];

  return (
    <section className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4" data-testid="voice-cast-pane">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="m-serif text-sm font-semibold">角色配音</h2>
        <button
          type="button"
          onClick={reassignAll}
          data-testid="cast-auto-btn"
          className="rounded-lg border border-[hsl(var(--border-soft))] px-2.5 py-1 text-xs text-[hsl(var(--accent))]"
        >
          ↻ 重新自动分配
        </button>
      </div>
      <p className="mb-2 text-xs leading-5 text-[hsl(var(--fg-muted))]">
        点角色换声；对白按说话人自动选声。首次进入已自动分配初始音色，可随时修改。
      </p>
      {error && <p className="mb-2 rounded-lg bg-[hsl(var(--danger))]/10 p-2 text-xs text-[hsl(var(--danger))]">{error}</p>}
      <ul className="flex flex-col gap-1">
        {rows.map((name) => {
          const isNarrator = name === NARRATOR_VOICE_KEY;
          return (
            <li key={name}>
              <button
                type="button"
                onClick={() => setPicking(name)}
                data-testid={isNarrator ? 'cast-row-narrator' : `cast-row-${name}`}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-[hsl(var(--bg))]"
              >
                <span className="min-w-0 flex-1 truncate">{isNarrator ? '旁白' : name}</span>
                <span className="shrink-0 rounded-full bg-[hsl(var(--accent))]/10 px-2 py-0.5 text-xs text-[hsl(var(--accent))]">
                  {voiceName(cast[name])}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* 换声弹层（全量音色：Edge 免费 + MiniMax 高清） */}
      {picking && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setPicking(null)}>
          <div
            className="max-h-[75vh] w-full overflow-y-auto rounded-t-2xl bg-[hsl(var(--surface))] p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
            data-testid="cast-sheet"
          >
            <h3 className="mb-2 text-sm font-semibold">为「{picking === NARRATOR_VOICE_KEY ? '旁白' : picking}」选择音色</h3>
            <VoicePicker current={cast[picking] ?? ''} onChange={(id) => assign(picking, id)} />
          </div>
        </div>
      )}
    </section>
  );
}
