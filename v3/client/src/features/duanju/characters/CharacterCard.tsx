/**
 * 角色卡（共识 D6 / 资料第 3 课）：档案编辑 + 设定图生成/重roll + 主参考图选定
 *
 * - 档案（名字/外观锚点）blur 保存并 bump updatedAt（stale 联动事实源）
 * - 「生成设定图」：MiniMax image-01（正面全身·无动作；server 持参考图逻辑）
 * - 主参考图：生四宫格时保持人物一致（Data URL，spike S8）；首图自动设为主参考
 */
import { useRef, useState } from 'react';
import { ImageIcon, Star, Trash2 } from 'lucide-react';

import { useDuanjuStore } from '../store';
import { useSettingsStore } from '../../../stores/settings';
import { generateDuanjuImage, uploadDuanjuImageFile, duanjuFileUrl } from '../../../api/duanju';
import { characterSheetPrompt } from '../lib/prompts/prompts-image';
import type { DuanjuCharacter } from '@shared/duanju';

interface Props {
  workId: string;
  character: DuanjuCharacter;
}

export default function CharacterCard({ workId, character }: Props) {
  const { project, patch, saving } = useDuanjuStore();
  const [generating, setGenerating] = useState(false);
  const sheetFileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  if (!project) return null;

  async function save(next: Partial<DuanjuCharacter>): Promise<void> {
    const characters = project!.characters.map((c) =>
      c.id === character.id ? { ...c, ...next, updatedAt: Date.now() } : c,
    );
    await patch(workId, { characters });
  }

  async function generateSheet(): Promise<void> {
    if (generating || !character.name.trim() || !character.profile.trim()) {
      if (!character.name.trim() || !character.profile.trim()) setError('先填角色名和外观锚点（生图一致性的事实源）');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const prompt = characterSheetPrompt(project!.style, character.name, character.profile);
      await generateDuanjuImage(workId, {
        kind: 'character',
        refId: character.id,
        prompt,
        aspectRatio: '3:4',
        provider: useSettingsStore.getState().llmPrefs.imageProvider,
      });
      // server 已把 project 随响应更新——拉最新
      await useDuanjuStore.getState().load(workId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  }

  /** 外部生图回流（豆包/即梦免费生成后上传，记入设定图候选） */
  async function onSheetPicked(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setGenerating(true);
    setError(null);
    try {
      await uploadDuanjuImageFile(workId, 'character', character.id, file);
      await useDuanjuStore.getState().load(workId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，请重试');
    } finally {
      setGenerating(false);
    }
  }

  async function removeCharacter(): Promise<void> {
    if (!confirm(`删除角色「${character.name || '未命名'}」及其设定图记录？`)) return;
    await patch(workId, { characters: project!.characters.filter((c) => c.id !== character.id) });
  }

  const inputCls =
    'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--accent))]';

  return (
    <div className="rounded-xl border border-[hsl(var(--border-soft))] p-4" data-testid="duanju-character-card">
      <div className="flex items-center gap-2">
        <input
          value={character.name}
          onChange={(e) => void save({ name: e.target.value })}
          placeholder="角色名（必填）"
          className="h-10 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm font-medium outline-none focus:border-[hsl(var(--accent))]"
          aria-label="角色名"
        />
        <button
          type="button"
          onClick={() => void generateSheet()}
          disabled={generating || saving}
          className="flex h-10 shrink-0 items-center gap-1 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
          data-testid="char-gen-sheet"
        >
          <ImageIcon className="h-3.5 w-3.5" aria-hidden />
          {generating ? '生成中 15-30s…' : character.sheetImages.length ? '再生成一张' : '生成设定图'}
        </button>
        <button
          type="button"
          onClick={() => void removeCharacter()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--danger))]"
          aria-label="删除角色"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <textarea
        defaultValue={character.profile}
        onBlur={(e) => {
          if (e.target.value !== character.profile) void save({ profile: e.target.value });
        }}
        placeholder="外观锚点：年龄身份/发色发型/瞳色/体型/标志性服装配饰——生图人物一致性的事实源"
        rows={3}
        className={`${inputCls} mt-2`}
        aria-label="角色档案"
      />

      {error && (
        <p className="mt-2 text-xs text-[hsl(var(--danger))]" role="alert">
          {error}
        </p>
      )}

      {/* 设定图区 */}
      <input
        ref={sheetFileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => void onSheetPicked(e)}
      />
      <button
        type="button"
        onClick={() => sheetFileRef.current?.click()}
        disabled={generating}
        className="mt-2 flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--fg-muted))] disabled:opacity-40"
        data-testid="char-upload-sheet"
      >
        ⬆ 上传外部生图（豆包/即梦免费生成后回流，自动计入设定图候选）
      </button>

      {character.sheetImages.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="char-sheets">
          {character.sheetImages.map((img) => {
            const isRef = character.refImageId === img.id;
            return (
              <div key={img.id} className="relative overflow-hidden rounded-lg border border-[hsl(var(--border-soft))]">
                <img src={duanjuFileUrl(workId, img.path)} alt={`${character.name} 设定图`} className="aspect-[3/4] w-full object-cover" />
                <button
                  type="button"
                  onClick={() => void save({ refImageId: isRef ? null : img.id })}
                  className={`absolute left-1.5 top-1.5 flex h-7 items-center gap-1 rounded-full px-2 text-[11px] backdrop-blur ${
                    isRef ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]' : 'bg-black/50 text-white/90'
                  }`}
                  aria-label={isRef ? '取消主参考图' : '设为主参考图'}
                >
                  <Star className={`h-3 w-3 ${isRef ? 'fill-current' : ''}`} aria-hidden />
                  {isRef ? '主参考' : '设为参考'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
