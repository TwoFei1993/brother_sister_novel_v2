/**
 * 试验台输入区（设计共识 2026-11-26 第 2.2 节；M2：带入设定、参考图）
 *
 * 简短提示词 + 参数（画面类型 / 通道 / 画幅 / 语言）+ 带入设定 + 参考图。
 * 通道默认跟随设置页的生图通道，试验台内可临时切换——不影响正式出图设置。
 */
import { useState } from 'react';
import { WandSparkles } from 'lucide-react';

import type { DuanjuCharacter, DuanjuScene } from '@shared/duanju';
import type { LabAspect, LabKind, LabProvider } from '@shared/duanju/lab';

import { ASPECT_LABELS, ASPECTS_BY_PROVIDER, LAB_PROVIDER_LABELS } from '../lib/lab/aspects';
import { LAB_KIND_LABELS } from '../lib/lab/prompts-lab';
import type { LabRefOption } from '../lib/lab/refs';
import { loadComfyConfig } from '../lib/comfy';
import type { LabInputState } from '../lib/lab/taskState';
import LabRefs from './LabRefs';

export type { LabInputState };

export const LAB_BRIEF_MAX = 300;

const PROVIDERS: readonly LabProvider[] = ['comfy', 'seedream', 'zhipu'];
const KINDS: readonly LabKind[] = ['free', 'character', 'scene', 'frame'];
const LANGUAGES: ReadonlyArray<{ id: 'zh' | 'en'; label: string }> = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
];

const chipCls = (on: boolean): string =>
  `min-h-8 rounded-full border px-3 text-xs transition-colors ${
    on
      ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
      : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
  }`;

const labelCls = 'mb-1.5 block text-xs text-[hsl(var(--fg-muted))]';

const toggleId = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

interface Props {
  workId: string;
  value: LabInputState;
  onChange: (next: LabInputState) => void;
  /** 扩写或出图进行中：参数锁定 */
  disabled: boolean;
  expanding: boolean;
  onExpand: () => void;
  /** 本作品的角色 / 场景（「带入设定」多选） */
  characters: readonly DuanjuCharacter[];
  scenes: readonly DuanjuScene[];
  refOptions: readonly LabRefOption[];
  addingRef: boolean;
  onUploadRef: (file: File) => void;
  onAddWorkRef: (option: LabRefOption) => void;
}

export default function LabInput({
  workId,
  value,
  onChange,
  disabled,
  expanding,
  onExpand,
  characters,
  scenes,
  refOptions,
  addingRef,
  onUploadRef,
  onAddWorkRef,
}: Props) {
  const [comfyUrl] = useState(() => loadComfyConfig().url);
  const aspects = ASPECTS_BY_PROVIDER[value.provider];

  function setProvider(provider: LabProvider): void {
    // 切通道：当前画幅不被新通道支持时回落到它的默认画幅（参考图不删，超出上限的那些只是不用）
    const supported = ASPECTS_BY_PROVIDER[provider];
    onChange({ ...value, provider, aspect: supported.includes(value.aspect) ? value.aspect : supported[0]! });
  }

  function assetChip(kind: 'character' | 'scene', id: string, name: string) {
    const on = kind === 'character' ? value.characterIds.includes(id) : value.sceneIds.includes(id);
    return (
      <button
        key={`${kind}-${id}`}
        type="button"
        aria-pressed={on}
        disabled={disabled}
        onClick={() =>
          kind === 'character'
            ? onChange({ ...value, characterIds: toggleId(value.characterIds, id) })
            : onChange({ ...value, sceneIds: toggleId(value.sceneIds, id) })
        }
        data-testid={`lab-asset-${kind}-${id}`}
        className={chipCls(on)}
      >
        {name}
      </button>
    );
  }

  return (
    <section
      className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4"
      data-testid="lab-input"
    >
      <label className="block">
        <span className={labelCls}>想画什么（一句话即可）</span>
        <textarea
          value={value.brief}
          onChange={(e) => onChange({ ...value, brief: e.target.value.slice(0, LAB_BRIEF_MAX) })}
          placeholder="例：雨夜霓虹街头，女剑客回头，风吹起她的长发"
          rows={3}
          disabled={disabled}
          data-testid="lab-brief"
          className="w-full resize-y rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-sm leading-6 outline-none focus:border-[hsl(var(--accent))] disabled:opacity-60"
        />
      </label>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <span className={labelCls}>画面类型</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="画面类型">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={value.kind === k}
                disabled={disabled}
                onClick={() => onChange({ ...value, kind: k })}
                data-testid={`lab-kind-${k}`}
                className={chipCls(value.kind === k)}
              >
                {LAB_KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className={labelCls}>通道</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="生图通道">
            {PROVIDERS.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={value.provider === p}
                disabled={disabled}
                onClick={() => setProvider(p)}
                data-testid={`lab-provider-${p}`}
                className={chipCls(value.provider === p)}
              >
                {LAB_PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
          {value.provider === 'comfy' && !comfyUrl.trim() && (
            <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400" data-testid="lab-comfy-unconfigured">
              本地引擎还没填地址——到设置页「本地引擎」填写，或切到云端通道
            </p>
          )}
        </div>

        <div>
          <span className={labelCls}>画幅</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="画幅">
            {aspects.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={value.aspect === a}
                disabled={disabled}
                onClick={() => onChange({ ...value, aspect: a })}
                data-testid={`lab-aspect-${a}`}
                className={chipCls(value.aspect === a)}
              >
                {ASPECT_LABELS[a]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className={labelCls}>提示词语言</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="提示词语言">
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={value.language === l.id}
                disabled={disabled}
                onClick={() => onChange({ ...value, language: l.id })}
                data-testid={`lab-language-${l.id}`}
                className={chipCls(value.language === l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {(characters.length > 0 || scenes.length > 0) && (
          <div>
            <span className={labelCls}>带入设定（选中的角色 / 场景档案进扩写）</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="带入设定" data-testid="lab-assets">
              {characters.map((c) => assetChip('character', c.id, c.name.trim() || '未命名角色'))}
              {scenes.map((s) => assetChip('scene', s.id, s.name.trim() || '未命名场景'))}
            </div>
          </div>
        )}

        <LabRefs
          workId={workId}
          provider={value.provider}
          value={value.refs}
          onChange={(refs) => onChange({ ...value, refs })}
          options={refOptions}
          disabled={disabled}
          adding={addingRef}
          onUpload={onUploadRef}
          onAddFromWork={onAddWorkRef}
        />
      </div>

      <button
        type="button"
        onClick={onExpand}
        disabled={disabled || !value.brief.trim()}
        data-testid="lab-expand"
        className="mt-4 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[hsl(var(--accent))] text-sm font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
      >
        <WandSparkles className="h-4 w-4" aria-hidden />
        {expanding ? 'AI 扩写中…' : '生成完整提示词'}
      </button>
    </section>
  );
}
