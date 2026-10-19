/**
 * 提示词管理器（Task 26 核心）
 *
 * 选中预设后按 prompt_order[0].order（character_id=100001 组）渲染：
 * - marker 型显示「系统位」徽标；启停 checkbox / 上下移动 / 展开编辑 / 删除（仅自定义）
 * - 新建自定义提示词（push 进 prompts 并追加到 order 尾部）
 * - 从预设 JSON 粘贴导入（新建资产路径，见 PromptForms）
 * - 实时 token 预览：assemblePrompt 干跑（空卡/空扫描/空历史）得总数，
 *   行级 countTokensApprox(宏替换后 content)
 * - 保存 PATCH /api/presets/:id（raw 整体替换）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TavernPreset, TavernPrompt } from '@shared/tavern';
import { defaultNovelSettings } from '@shared/work';

import type { MacroEnv } from '../../../engine/types';
import { countTokensApprox } from '../../../engine/budget';
import { substituteParams } from '../../../engine/prompt/macros';
import { assemblePrompt } from '../../../engine/prompt/assemble';
import { getPreset, updatePresetRaw } from '../../../api/library';

import PromptRow from './PromptRow';
import { NewPromptForm, PasteImportForm } from './PromptForms';
import { describePrompt, isSudachiPreset } from './guides/preset-guides';
import SudachiGuideCard from './guides/SudachiGuideCard';

/** 一期装配感知的 marker 集（与 assemble.ts blocks 键一致 + 常见占位符） */
const MARKER_IDS = new Set([
  'main', 'chatHistory', 'worldInfoBefore', 'worldInfoAfter',
  'charDescription', 'charPersonality', 'scenario', 'dialogueExamples', 'jailbreak',
]);

/** prompt_order 排序单元（从 TavernPreset 派生，shared 未单独导出该类型） */
type OrderEntry = NonNullable<TavernPreset['prompt_order']>[number]['order'][number];

const isMarker = (p: TavernPrompt | undefined): boolean =>
  p?.marker === true || (p !== undefined && MARKER_IDS.has(p.identifier));

/** 干跑宏环境：变量恒空、{{user}}/{{char}} 占位 */
const DRY_ENV: MacroEnv = {
  user: '你',
  char: '角色',
  getVar: () => undefined,
  setVar: () => undefined,
  scope: 'work',
};

const EMPTY_SCAN = { before: [], after: [], depthEntries: [], activatedIds: [] };

/** prompt_order 分组定位：优先 character_id=100001，回退首组 */
function orderGroupIndex(raw: TavernPreset): number {
  const groups = raw.prompt_order ?? [];
  const idx = groups.findIndex((g) => g.character_id === 100001);
  return idx >= 0 ? idx : 0;
}

/** 加载后规范化：无 prompt_order 时按 prompts 顺序全启用补建 */
function normalizePreset(raw: TavernPreset): TavernPreset {
  if (raw.prompt_order?.length) return raw;
  return {
    ...raw,
    prompt_order: [
      {
        character_id: 100001,
        order: raw.prompts.map((p) => ({ identifier: p.identifier, enabled: true })),
      },
    ],
  };
}

export interface PromptManagerProps {
  presetId: string;
  /** 粘贴导入成功后回传新资产（父级刷新列表并选中） */
  onImportedNew: (id: string, name: string) => void;
  /** 页面级内联提示条 */
  notify: (kind: 'ok' | 'err', text: string) => void;
}

export default function PromptManager({ presetId, onImportedNew, notify }: PromptManagerProps) {
  const [raw, setRaw] = useState<TavernPreset | null>(null);
  const [presetName, setPresetName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  // ---------- 加载 ----------
  useEffect(() => {
    let alive = true;
    setRaw(null);
    setPresetName('');
    setDirty(false);
    setExpandedId(null);
    getPreset(presetId)
      .then((a) => {
        if (alive) {
          setRaw(normalizePreset(a.raw));
          setPresetName(a.name);
        }
      })
      .catch((err: unknown) => {
        notifyRef.current('err', err instanceof Error ? err.message : '预设加载失败');
      });
    return () => {
      alive = false;
    };
  }, [presetId]);

  // ---------- 结构化变更（全部落 dirty） ----------
  const patchRaw = useCallback((fn: (draft: TavernPreset) => TavernPreset) => {
    setRaw((prev) => (prev ? fn(prev) : prev));
    setDirty(true);
  }, []);

  /** order 数组原位变换（定位 character_id=100001 组） */
  const mutateOrder = useCallback(
    (fn: (order: OrderEntry[]) => OrderEntry[]) => {
      patchRaw((draft) => {
        const gi = orderGroupIndex(draft);
        const groups = [...(draft.prompt_order ?? [])];
        const group = groups[gi];
        if (!group) return draft;
        groups[gi] = { ...group, order: fn(group.order) };
        return { ...draft, prompt_order: groups };
      });
    },
    [patchRaw],
  );

  const handleToggleEnabled = (index: number) => {
    mutateOrder((order) =>
      order.map((e, i) => (i === index ? { ...e, enabled: !e.enabled } : e)),
    );
  };

  const handleMove = (index: number, dir: -1 | 1) => {
    mutateOrder((order) => {
      const next = [...order];
      const target = index + dir;
      if (target < 0 || target >= next.length) return order;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleChangePrompt = (identifier: string, patch: Partial<TavernPrompt>) => {
    patchRaw((draft) => ({
      ...draft,
      prompts: draft.prompts.map((p) => (p.identifier === identifier ? { ...p, ...patch } : p)),
    }));
  };

  const handleDeletePrompt = (identifier: string) => {
    patchRaw((draft) => ({
      ...draft,
      prompts: draft.prompts.filter((p) => p.identifier !== identifier),
    }));
    mutateOrder((order) => order.filter((e) => e.identifier !== identifier));
    setExpandedId((cur) => (cur === identifier ? null : cur));
  };

  const handleCreate = (input: Pick<TavernPrompt, 'name' | 'content' | 'role'>) => {
    const identifier =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    patchRaw((draft) => ({
      ...draft,
      prompts: [...draft.prompts, { marker: false, ...input, identifier }],
    }));
    mutateOrder((order) => [...order, { identifier, enabled: true }]);
  };

  const handleSave = async () => {
    if (!raw) return;
    setSaving(true);
    try {
      await updatePresetRaw(presetId, raw);
      setDirty(false);
      notifyRef.current('ok', '预设已保存');
    } catch (err) {
      notifyRef.current('err', err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // ---------- token 预览（干跑 + 行级近似） ----------
  const promptsById = useMemo(() => {
    const map = new Map<string, TavernPrompt>();
    for (const p of raw?.prompts ?? []) map.set(p.identifier, p);
    return map;
  }, [raw]);

  const dryRun = useMemo(() => {
    if (!raw) return null;
    try {
      return assemblePrompt({
        preset: raw,
        cards: [],
        allowCardOverride: false,
        worldbookScan: EMPTY_SCAN,
        workSettings: defaultNovelSettings,
        history: [],
        macroEnv: DRY_ENV,
        budgetTokens: 200_000,
      });
    } catch {
      return null;
    }
  }, [raw]);

  const rowTokens = useCallback((p: TavernPrompt | undefined): number | null => {
    const content = p?.content;
    if (typeof content !== 'string' || !content.trim()) return null;
    return countTokensApprox(substituteParams(content, DRY_ENV));
  }, []);

  // ---------- 渲染 ----------
  if (!raw) {
    return <p className="py-8 text-center text-sm text-[hsl(var(--fg-muted))]">预设加载中…</p>;
  }

  const order = raw.prompt_order?.[orderGroupIndex(raw)]?.order ?? [];

  return (
    <section aria-label="提示词管理器" className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">
          提示词管理器
          {dirty && (
            <span className="ml-2 rounded bg-amber-400/15 px-1.5 py-0.5 align-middle text-[10px] text-amber-500">
              未保存
            </span>
          )}
        </h3>
        <span className="text-xs text-[hsl(var(--fg-muted))]">
          预估总 token：{dryRun ? `~${dryRun.usage.promptTokens}` : '—'}
          {dryRun?.usage.truncated ? '（历史已截断）' : ''}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="ml-auto min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </header>

      <div className="flex flex-wrap gap-2">
        <NewPromptForm onCreate={handleCreate} />
        <PasteImportForm
          onImported={(id, name) => {
            notifyRef.current('ok', `已导入新预设「${name}」`);
            onImportedNew(id, name);
          }}
          onError={(msg) => notifyRef.current('err', msg)}
        />
      </div>

      {isSudachiPreset(presetName) && <SudachiGuideCard />}

      <ol className="flex flex-col gap-2">
        {order.map((entry, index) => {
          const prompt = promptsById.get(entry.identifier);
          const name = typeof prompt?.name === 'string' && prompt.name ? prompt.name : entry.identifier;
          return (
            <PromptRow
              key={entry.identifier}
              identifier={entry.identifier}
              name={name}
              description={describePrompt(entry.identifier, name)}
              enabled={entry.enabled}
              marker={isMarker(prompt)}
              role={typeof prompt?.role === 'string' ? prompt.role : 'system'}
              tokens={rowTokens(prompt)}
              expanded={expandedId === entry.identifier}
              isFirst={index === 0}
              isLast={index === order.length - 1}
              prompt={prompt}
              onChange={(patch) => handleChangePrompt(entry.identifier, patch)}
              onToggleEnabled={() => handleToggleEnabled(index)}
              onMove={(dir) => handleMove(index, dir)}
              onToggleExpand={() =>
                setExpandedId((cur) => (cur === entry.identifier ? null : entry.identifier))
              }
              onDelete={() => handleDeletePrompt(entry.identifier)}
            />
          );
        })}
      </ol>
      {order.length === 0 && (
        <p className="py-6 text-center text-sm text-[hsl(var(--fg-muted))]">该预设暂无排序列表</p>
      )}
    </section>
  );
}
