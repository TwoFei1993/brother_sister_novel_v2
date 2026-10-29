/**
 * 角色配音面板（移动创作「资料」分区）：作品级 TTS 分声（work.voiceMap，桌面配音编辑器同源）
 *
 * - 首次进入（voiceMap 缺角色项）自动分配初始音色：MiniMax 池按名字性别轮替，旁白固定主持人女
 * - 🔍 识别正文角色：扫描章节「名字：」对白前缀，检出未配声角色一键配声（反馈③智能识别）
 * - 🤖 AI 智能分配：按角色卡人设让 LLM 从音色目录选声（反馈④），性别不符/幻觉 id 用启发式兜底
 * - 每行点开 VoicePicker 全量换声（Edge 免费 + MiniMax 全量）；「重新自动分配」一键重置
 * - 保存：GET 最新 work 取 revision → PATCH voiceMap（乐观锁，失败提示重试）
 */
import { useEffect, useState } from 'react';

import { apiFetch } from '../../../../api/client';
import { getAsset, listCharacters } from '../../../../api/library';
import { listMessages, updateWork } from '../../../../api/works';
import {
  ALL_VOICES,
  NARRATOR_CAST_ID,
  normalizeVoiceMap,
  scanSpeakers,
  type DetectedSpeaker,
} from '../../../../lib/tts/mobile-cast';
import { NARRATOR_VOICE_KEY, autoCastVoices } from '../../../../lib/tts/voice-route';
import type { CharacterAsset } from '@shared/card';
import type { Work } from '@shared/work';

import VoicePicker from '../../VoicePicker';
import { aiAssignVoices, aiNormalizeSpeakers } from './voice-cast-ai';

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
  /** 绑定角色 id↔名字（AI 分配拉人设用） */
  const [chars, setChars] = useState<Array<{ id: string; name: string }>>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // —— 🔍 正文识别 ——
  const [detected, setDetected] = useState<DetectedSpeaker[] | null>(null);
  const [detectedPick, setDetectedPick] = useState<Record<string, boolean>>({});
  const [scanning, setScanning] = useState(false);
  // —— 🤖 AI 分配 ——
  const [aiBusy, setAiBusy] = useState(false);

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
        const bound = characters.filter((c) => work.characterIds.includes(c.id));
        const boundNames = bound.map((c) => c.name);
        // voiceMap 里已分配但未绑定的名字保留（历史角色不丢）
        const history = Object.keys(work.voiceMap).filter(
          (n) => n !== NARRATOR_VOICE_KEY && !boundNames.includes(n),
        );
        const all = [...boundNames, ...history];
        const prev = normalizeVoiceMap(work.voiceMap); // 旧连字符 id 自愈
        const next = withAutoAssign({ ...prev }, boundNames);
        const added = Object.keys(next).filter((k) => prev[k] !== next[k]);
        setChars(bound.map((c) => ({ id: c.id, name: c.name })));
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

  /** 🔍 扫描全部章节正文，检出未配声的说话人 */
  async function scanCharacters(): Promise<void> {
    if (scanning) return;
    setScanning(true);
    setError(null);
    try {
      const page = await listMessages(work.id, { tail: 100 });
      const paras: string[] = [];
      for (const m of page.messages) {
        for (const line of m.content.split('\n')) {
          const t = line.trim();
          if (t) paras.push(t);
        }
      }
      const known = new Set([...names, NARRATOR_VOICE_KEY]);
      const found = scanSpeakers(paras, known);
      if (found.length === 0) {
        setError('正文中没有发现未配声的新角色（对白需用「名字：」开头才会被识别）');
        return;
      }
      // AI 归并同一角色的不同写法、剔除非角色名（「镇国公坐到床边/低声道」都归镇国公）；失败降级正则结果
      let finalList = found;
      try {
        const normalized = await aiNormalizeSpeakers(found);
        if (normalized.length > 0) {
          const countOf = (n: string): number =>
            found.filter((d) => d.name.includes(n) || n.includes(d.name)).reduce((m, d) => Math.max(m, d.count), 0);
          finalList = normalized.map((name) => ({ name, count: countOf(name) }));
        }
      } catch {
        setError('AI 归并失败，已展示正则粗扫结果');
      }
      setDetected(finalList);
      setDetectedPick(Object.fromEntries(finalList.map((d) => [d.name, true])));
    } catch {
      setError('正文扫描失败，请重试');
    } finally {
      setScanning(false);
    }
  }

  /** 为勾选的识别结果配声（性别启发式池轮替）并入 cast */
  function assignDetected(): void {
    const pickedNames = (detected ?? []).filter((d) => detectedPick[d.name]).map((d) => d.name);
    if (pickedNames.length === 0) return;
    const auto = autoCastVoices(pickedNames);
    const next = { ...cast };
    for (const { name, voice } of auto) next[name] = voice;
    if (!next[NARRATOR_VOICE_KEY]) next[NARRATOR_VOICE_KEY] = NARRATOR_CAST_ID;
    setCast(next);
    setNames((ns) => [...ns, ...pickedNames.filter((n) => !ns.includes(n))]);
    setDetected(null);
    void persist(next);
  }

  /** 🤖 AI 智能分配：绑定角色（带人设）∪ 已配声名字 → LLM 从目录选声 → 幻觉/缺选用启发式兜底 */
  async function aiAssign(): Promise<void> {
    if (aiBusy) return;
    setAiBusy(true);
    setError(null);
    try {
      const briefs: Array<{ name: string; desc: string }> = [];
      const seen = new Set<string>();
      // 并行拉全量卡（串行 19 次 GET 太慢）；单卡失败降级为空人设
      const assets = await Promise.all(chars.map((c) => getAsset('characters', c.id).catch(() => null)));
      for (let i = 0; i < chars.length; i += 1) {
        const c = chars[i]!;
        seen.add(c.name);
        const asset = assets[i] as CharacterAsset | null;
        const d = asset?.card?.data ?? {};
        const desc = [d.description, d.personality].filter((x): x is string => typeof x === 'string' && x.trim() !== '').join('；');
        briefs.push({ name: c.name, desc });
      }
      // 未绑定但已在配音表的名字（识别/手动加入的）：按名字参与，无人设
      for (const n of names) {
        if (!seen.has(n)) briefs.push({ name: n, desc: '' });
      }
      const ai = await aiAssignVoices(briefs, ALL_VOICES);
      const next = { ...cast };
      const fallback = autoCastVoices(briefs.map((b) => b.name));
      for (const b of briefs) {
        next[b.name] = ai[b.name] || fallback.find((f) => f.name === b.name)?.voice || next[b.name] || NARRATOR_CAST_ID;
      }
      if (!next[NARRATOR_VOICE_KEY]) next[NARRATOR_VOICE_KEY] = NARRATOR_CAST_ID;
      setCast(next);
      void persist(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 分配失败，请重试');
    } finally {
      setAiBusy(false);
    }
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
      <div className="mb-2 flex gap-2">
        <button
          type="button"
          onClick={() => void scanCharacters()}
          disabled={scanning}
          data-testid="cast-scan-btn"
          className="h-8 flex-1 whitespace-nowrap rounded-lg border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--accent))] disabled:opacity-40"
        >
          {scanning ? '扫描中…' : '🔍 识别正文角色'}
        </button>
        <button
          type="button"
          onClick={() => void aiAssign()}
          disabled={aiBusy || (chars.length === 0 && names.length === 0)}
          data-testid="cast-ai-btn"
          className="h-8 flex-1 whitespace-nowrap rounded-lg border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--accent))] disabled:opacity-40"
        >
          {aiBusy ? 'AI 分配中…' : '🤖 AI 智能分配'}
        </button>
      </div>
      {error && <p className="mb-2 rounded-lg bg-[hsl(var(--danger))]/10 p-2 text-xs text-[hsl(var(--danger))]">{error}</p>}

      {/* 🔍 识别结果：勾选未配声角色 → 一键配声 */}
      {detected !== null && detected.length > 0 && (
        <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5" data-testid="cast-detected">
          <p className="mb-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            正文检出 {detected.length} 个未配声角色（按出现次数）
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {detected.map((d) => (
              <label key={d.name} className="flex items-center gap-1 rounded-full border border-amber-500/40 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
                <input
                  type="checkbox"
                  checked={detectedPick[d.name] ?? false}
                  onChange={(e) => setDetectedPick((p) => ({ ...p, [d.name]: e.target.checked }))}
                  data-testid={`detect-pick-${d.name}`}
                />
                {d.name} ×{d.count}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={assignDetected}
              data-testid="detect-assign-btn"
              className="h-8 flex-1 rounded-lg bg-amber-500 text-xs font-medium text-white"
            >
              为所选分配声音
            </button>
            <button type="button" onClick={() => setDetected(null)} className="h-8 flex-1 rounded-lg border border-amber-500/40 text-xs text-amber-700 dark:text-amber-400">
              忽略
            </button>
          </div>
        </div>
      )}

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

      {/* 换声弹层（全量音色：Edge 免费 + MiniMax 全量） */}
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
