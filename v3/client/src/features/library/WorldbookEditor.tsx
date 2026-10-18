/**
 * 世界书编辑器（Task 27）
 *
 * 全屏弹层：左侧条目列表（条目名[comment]/启停开关/常驻灯/order 值/上下移），
 * 右侧 EntryEditor 表单。列表顺序 = uid 升序（酒馆 UI 同语义），
 * 上下移通过交换相邻条目 uid 实现（record 数字键按升序枚举，交换 uid 即交换顺序）。
 * 保存：PATCH /api/worldbooks/:id 整体替换 raw（server 顶层浅合并，name/id 保留）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TavernWorldInfoEntry, TavernWorldInfoFile } from '@shared/tavern';
import type { WorldbookAsset } from '@shared/worldbook';

import { apiFetch } from '../../api/client';

import EditorShell from './EditorShell';
import EntryEditor from './EntryEditor';

const getWorldbook = (id: string): Promise<WorldbookAsset> => apiFetch<WorldbookAsset>(`/api/worldbooks/${id}`);

const updateWorldbookRaw = (id: string, raw: TavernWorldInfoFile): Promise<WorldbookAsset> =>
  apiFetch<WorldbookAsset>(`/api/worldbooks/${id}`, { method: 'PATCH', body: JSON.stringify({ raw }) });

/** uid 升序列表（entries record → 数组；显示顺序与酒馆一致；无 uid 的脏数据跳过） */
function sortedEntries(raw: TavernWorldInfoFile): TavernWorldInfoEntry[] {
  return Object.values(raw.entries)
    .filter((e): e is TavernWorldInfoEntry => typeof e === 'object' && e !== null && typeof e.uid === 'number')
    .sort((a, b) => a.uid - b.uid);
}

/** 交换两个条目的 uid（上下移的落盘语义） */
function swapEntries(raw: TavernWorldInfoFile, uidA: number, uidB: number): TavernWorldInfoFile {
  const a = raw.entries[String(uidA)];
  const b = raw.entries[String(uidB)];
  if (!a || !b) return raw;
  const entries = { ...raw.entries };
  entries[String(uidA)] = { ...b, uid: uidA };
  entries[String(uidB)] = { ...a, uid: uidB };
  return { ...raw, entries };
}

/** 新条目默认值：对齐酒馆 world-info.js newWorldInfoEntryDefinition（全字段显式声明，分组紧凑排版） */
export function makeNewEntry(uid: number): TavernWorldInfoEntry {
  return {
    uid, key: [], keysecondary: [], comment: '', content: '',
    constant: false, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true,
    order: 100, position: 0, disable: false, ignoreBudget: false,
    excludeRecursion: false, preventRecursion: false,
    matchPersonaDescription: false, matchCharacterDescription: false,
    matchCharacterPersonality: false, matchCharacterDepthPrompt: false,
    matchScenario: false, matchCreatorNotes: false, delayUntilRecursion: false,
    probability: 100, useProbability: true, depth: 4,
    outletName: '', group: '', groupOverride: false, groupWeight: 100,
    scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null,
    automationId: '', role: null, sticky: 0, cooldown: 0, delay: 0,
    characterFilterNames: [], characterFilterTags: [], characterFilterExclude: false,
    triggers: [],
  };
}

// ---------- 条目列表行 ----------

interface EntryRowProps {
  entry: TavernWorldInfoEntry;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onToggleDisable: () => void;
  onMove: (dir: -1 | 1) => void;
}

const MOVE_CLS = 'text-[10px] text-[hsl(var(--fg-muted))] disabled:opacity-30';

function EntryRow({ entry, selected, isFirst, isLast, onSelect, onToggleDisable, onMove }: EntryRowProps) {
  const label = entry.comment || `条目 #${entry.uid}`;
  const enabled = entry.disable !== true;
  return (
    <li
      data-entry-row={entry.uid}
      data-entry-comment={entry.comment ?? ''}
      className={`mb-1 rounded-lg border px-2 py-1.5 ${selected ? 'border-[hsl(var(--accent))]'
        : 'border-transparent hover:border-[hsl(var(--border-soft))]'} ${enabled ? '' : 'opacity-50'}`}
    >
      <div className="flex items-center gap-1.5">
        <input
          type="checkbox"
          aria-label={`启用 ${label}`}
          checked={enabled}
          onChange={onToggleDisable}
          className="h-4 w-4 shrink-0 accent-[hsl(var(--accent))]"
        />
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate text-left text-sm text-[hsl(var(--fg))]">
          {entry.constant === true && (
            <span
              data-constant="true"
              aria-label={`${label} 常驻`}
              className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-400 align-middle"
              title="常驻条目：每轮必定注入"
            />
          )}
          <span className="align-middle">{label}</span>
        </button>
        <span className="shrink-0 text-[10px] text-[hsl(var(--fg-muted))]" title="order 插入优先级">
          {entry.order ?? 100}
        </span>
        <div className="flex shrink-0 flex-col leading-none">
          <button type="button" aria-label={`上移 ${label}`} disabled={isFirst} onClick={() => onMove(-1)} className={MOVE_CLS}>▲</button>
          <button type="button" aria-label={`下移 ${label}`} disabled={isLast} onClick={() => onMove(1)} className={MOVE_CLS}>▼</button>
        </div>
      </div>
    </li>
  );
}

// ---------- 编辑器主组件 ----------

export interface WorldbookEditorProps {
  worldbookId: string;
  onClose: () => void;
  /** 保存成功后回调（父级刷新列表摘要） */
  onSaved: () => void;
  notify: (kind: 'ok' | 'err', text: string) => void;
}

export default function WorldbookEditor({ worldbookId, onClose, onSaved, notify }: WorldbookEditorProps) {
  const [name, setName] = useState('');
  const [raw, setRaw] = useState<TavernWorldInfoFile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  // ---------- 加载 ----------
  useEffect(() => {
    let alive = true;
    setRaw(null);
    setDirty(false);
    setSelectedUid(null);
    getWorldbook(worldbookId)
      .then((asset) => {
        if (!alive) return;
        setName(asset.name);
        setRaw(asset.raw);
        setSelectedUid(sortedEntries(asset.raw)[0]?.uid ?? null);
      })
      .catch((err: unknown) => {
        notifyRef.current('err', err instanceof Error ? err.message : '世界书加载失败');
      });
    return () => {
      alive = false;
    };
  }, [worldbookId]);

  // ---------- 结构化变更 ----------
  const patchRaw = useCallback((fn: (draft: TavernWorldInfoFile) => TavernWorldInfoFile) => {
    setRaw((prev) => (prev ? fn(prev) : prev));
    setDirty(true);
  }, []);

  const patchEntry = useCallback(
    (uid: number, patch: Partial<TavernWorldInfoEntry>) => {
      patchRaw((draft) => {
        const cur = draft.entries[String(uid)];
        if (!cur) return draft;
        return { ...draft, entries: { ...draft.entries, [String(uid)]: { ...cur, ...patch } } };
      });
    },
    [patchRaw],
  );

  const moveEntry = useCallback(
    (uid: number, dir: -1 | 1) => {
      patchRaw((draft) => {
        const list = sortedEntries(draft);
        const neighbor = list[list.findIndex((e) => e.uid === uid) + dir];
        return neighbor ? swapEntries(draft, uid, neighbor.uid) : draft;
      });
    },
    [patchRaw],
  );

  /** 新建：uid 取现有最大值 +1（空书从 0 起），插入后直接选中 */
  const createEntry = useCallback(() => {
    if (!raw) return;
    const uid = Object.values(raw.entries).reduce<number>(
      (m, e) => Math.max(m, typeof e?.uid === 'number' ? e.uid : -1),
      -1,
    ) + 1;
    patchRaw((draft) => ({ ...draft, entries: { ...draft.entries, [String(uid)]: makeNewEntry(uid) } }));
    setSelectedUid(uid);
  }, [raw, patchRaw]);

  const deleteEntry = useCallback(
    (entry: TavernWorldInfoEntry) => {
      if (!window.confirm(`确定删除条目「${entry.comment || `条目 #${entry.uid}`}」？`)) return;
      patchRaw((draft) => {
        const entries = { ...draft.entries };
        delete entries[String(entry.uid)];
        return { ...draft, entries };
      });
      setSelectedUid((cur) => (cur === entry.uid ? null : cur));
    },
    [patchRaw],
  );

  const handleSave = async () => {
    if (!raw) return;
    setSaving(true);
    try {
      await updateWorldbookRaw(worldbookId, raw);
      setDirty(false);
      notifyRef.current('ok', '世界书已保存');
      onSaved();
    } catch (err) {
      notifyRef.current('err', err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const entries = useMemo(() => (raw ? sortedEntries(raw) : []), [raw]);
  const selected = entries.find((e) => e.uid === selectedUid) ?? null;

  return (
    <EditorShell title={`世界书 · ${name || worldbookId}`} dirty={dirty} saving={saving} onClose={onClose} onSave={() => void handleSave()}>
      {!raw ? (
        <p className="p-8 text-center text-sm text-[hsl(var(--fg-muted))]">世界书加载中…</p>
      ) : (
        <div className="grid h-full grid-cols-1 md:grid-cols-[280px_1fr]">
          {/* 左：条目列表 */}
          <aside aria-label="条目列表" className="flex min-h-0 flex-col border-b border-[hsl(var(--border-soft))] md:border-b-0 md:border-r">
            <div className="p-2">
              <button
                type="button"
                data-testid="entry-create"
                onClick={createEntry}
                className="min-h-[36px] w-full rounded-lg bg-[hsl(var(--accent))] px-3 text-sm font-medium text-white"
              >
                新建条目
              </button>
            </div>
            <ol className="flex-1 overflow-y-auto px-2 pb-2">
              {entries.map((entry, index) => (
                <EntryRow
                  key={entry.uid}
                  entry={entry}
                  selected={entry.uid === selectedUid}
                  isFirst={index === 0}
                  isLast={index === entries.length - 1}
                  onSelect={() => setSelectedUid(entry.uid)}
                  onToggleDisable={() => patchEntry(entry.uid, { disable: !entry.disable })}
                  onMove={(dir) => moveEntry(entry.uid, dir)}
                />
              ))}
              {entries.length === 0 && (
                <li className="py-6 text-center text-xs text-[hsl(var(--fg-muted))]">暂无条目，点击「新建条目」添加</li>
              )}
            </ol>
          </aside>

          {/* 右：条目表单 */}
          <section aria-label="条目编辑" className="min-h-0 overflow-y-auto p-4">
            {selected ? (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-[hsl(var(--fg))]">编辑条目 #{selected.uid}</h3>
                  <button
                    type="button"
                    data-testid="entry-delete"
                    onClick={() => deleteEntry(selected)}
                    className="ml-auto min-h-[32px] rounded-lg border border-red-400/40 px-3 text-xs text-red-400 hover:bg-red-400/10"
                  >
                    删除条目
                  </button>
                </div>
                <EntryEditor entry={selected} onChange={(patch) => patchEntry(selected.uid, patch)} />
              </>
            ) : (
              <p className="py-8 text-center text-sm text-[hsl(var(--fg-muted))]">从左侧选择一个条目进行编辑</p>
            )}
          </section>
        </div>
      )}
    </EditorShell>
  );
}
