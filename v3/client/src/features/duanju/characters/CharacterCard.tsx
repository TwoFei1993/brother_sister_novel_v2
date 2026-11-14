/**
 * 角色卡（共识 D6 / 资料第 3 课）：档案编辑 + 设定图生成/重roll + 主参考图选定
 *
 * - 档案（名字/外观锚点）blur 保存并 bump updatedAt（stale 联动事实源）
 * - 「生成设定图」：MiniMax image-01（正面全身·无动作；server 持参考图逻辑）
 * - 主参考图：生四宫格时保持人物一致（Data URL，spike S8）；首图自动设为主参考
 */
import { useRef, useState } from 'react';
import { ImageIcon, Star, Trash2, WandSparkles } from 'lucide-react';

import { useDuanjuStore } from '../store';
import CharacterStates from './CharacterStates';
import { useSettingsStore } from '../../../stores/settings';
import { generateDuanjuImage, uploadDuanjuImageFile, duanjuFileUrl, imageProviderForApi } from '../../../api/duanju';
import { anchorPortraitPrompt, characterSheetPrompt } from '../lib/prompts/prompts-image';
import { buildOutfitMessages } from '../lib/prompts/prompts-outfit';
import { MINIMAX_VOICES } from '../../../lib/tts/voice-catalog';
import { rebuildCharacterProfileMessages } from '../lib/characterExtract';
import { useBgLlmTask } from '../../../hooks/useBgLlmTask';
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

  /** 单角色档案重生成（用户需求 2026-11-11：重生成的是文字档案而非图片）——后台任务（切出安全） */
  const profileBg = useBgLlmTask(`char-profile-${workId}-${character.id}`, (text) => {
    void save({ profile: text.trim() });
  }, (msg) => setError(msg));

  /** 服装库 AI 生成（B5 闭环）：LLM 出 N 套白底商品图 prompt → 写 outfits → 逐套本地生图入 outfitImages */
  const [outfitBusy, setOutfitBusy] = useState(false);
  const outfitBg = useBgLlmTask(`char-outfit-${workId}-${character.id}`, async (raw) => {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      setError('服装库生成失败（模型未返回清单），请重试');
      return;
    }
    await save({ outfits: lines, outfitImages: [] });
    setOutfitBusy(true);
    try {
      // 逐套生图（Z-Image 秒级；LLM 输出行即完整生图 prompt——白底陈列规范已在 system 内）
      for (const line of lines) {
        await generateDuanjuImage(workId, { kind: 'outfit', refId: character.id, prompt: line, provider: imageProviderForApi() });
      }
      await useDuanjuStore.getState().load(workId);
    } catch (err) {
      setError(err instanceof Error ? `服装图部分失败：${err.message}` : '服装图生成失败');
    } finally {
      setOutfitBusy(false);
    }
  }, (msg) => setError(msg));

  function generateOutfits(): void {
    const busy = outfitBg.state?.status === 'submitting' || outfitBg.state?.status === 'running';
    if (busy || outfitBusy) return;
    if (!character.name.trim() || !character.profile.trim()) {
      setError('先填角色名和外观锚点（服装设计的依据）');
      return;
    }
    setError(null);
    const prefs = useSettingsStore.getState().llmPrefs;
    outfitBg.submit({
      source: prefs.source,
      model: prefs.model,
      messages: buildOutfitMessages(project!.style, character.name, character.profile, 6),
      thinking: false,
      params: { max_tokens: 2000 },
      label: `服装库·${character.name}`,
    });
  }

  if (!project) return null;

  async function save(next: Partial<DuanjuCharacter>): Promise<void> {
    const characters = project!.characters.map((c) =>
      c.id === character.id ? { ...c, ...next, updatedAt: Date.now() } : c,
    );
    await patch(workId, { characters });
  }

  function regenerateProfile(): void {
    const busy = profileBg.state?.status === 'submitting' || profileBg.state?.status === 'running';
    if (busy || !character.name.trim()) {
      if (!character.name.trim()) setError('先填角色名——重生成需要知道角色是谁');
      return;
    }
    setError(null);
    profileBg.submit({
      source: useSettingsStore.getState().llmPrefs.source,
      model: useSettingsStore.getState().llmPrefs.model,
      messages: rebuildCharacterProfileMessages(
        project!.script.text,
        character.name,
        character.profile,
        project!.reviewCards.characterRelations,
      ),
      thinking: false,
      params: { max_tokens: 2000 },
      label: `重生成档案·${character.name}`,
    });
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
        aspectRatio: '3:2',
        provider: imageProviderForApi(),
        sheetSplit: { style: project!.style, name: character.name, profile: character.profile },
      });
      // server 已把 project 随响应更新——拉最新
      await useDuanjuStore.getState().load(workId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  }

  /** 大头照锚点（B4）：正脸特写单视图——分帧参考通道 image1 用它脸最稳（三视图整图会摊小脸/拉远景） */
  async function generateAnchor(): Promise<void> {
    if (generating || !character.name.trim() || !character.profile.trim()) {
      if (!character.name.trim() || !character.profile.trim()) setError('先填角色名和外观锚点');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const prompt = anchorPortraitPrompt(project!.style, character.name, character.profile);
      await generateDuanjuImage(workId, {
        kind: 'character',
        refId: character.id,
        prompt,
        aspectRatio: '4:5',
        provider: imageProviderForApi(),
      });
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
          {generating ? '生成中…' : character.sheetImages.length ? '再生成一张' : '✨ 生成设定图'}
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

      {/* 连续性锁面（drama-skills P1-8）：跨镜不变外观的最小英文名词短语，逐字注入每帧/视频 prompt——字符串级一致防转述漂移 */}
      <input
        defaultValue={character.lockPhrase ?? ''}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v !== (character.lockPhrase ?? '')) void save({ lockPhrase: v || undefined });
        }}
        placeholder="连续性锁面（英文短语，如 long silver braid, amber eyes, navy school uniform）——逐字注入所有帧与视频提示词"
        className={`${inputCls} mt-2 font-mono text-xs`}
        aria-label="连续性锁面"
        data-testid="char-lock-phrase"
      />

      <CharacterStates workId={workId} character={character} />

      {/* 服装库（B5 闭环）：AI 生成清单+白底商品图 → 点选一套设当前穿着 */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-[hsl(var(--fg-muted))]">
          服装库（{character.outfits?.length ?? 0} 套）{character.currentOutfit ? ` · 当前：${character.currentOutfit.slice(0, 18)}${character.currentOutfit.length > 18 ? '…' : ''}` : ''}
        </summary>
        <button
          type="button"
          onClick={generateOutfits}
          disabled={outfitBg.state?.status === 'submitting' || outfitBg.state?.status === 'running' || outfitBusy}
          data-testid="char-gen-outfits"
          className="mt-1.5 flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--accent))] disabled:opacity-40"
          title="按角色人设 AI 设计 6 套服装（清单+白底商品图，本地免费）"
        >
          <WandSparkles className="h-3 w-3" aria-hidden />
          {outfitBg.state?.status === 'submitting' || outfitBg.state?.status === 'running'
            ? 'AI 设计服装中…（可切出）'
            : outfitBusy
              ? '生成服装图中…'
              : '✨ AI 设计 6 套服装'}
        </button>
        {(character.outfitImages?.length ?? 0) > 0 && (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {character.outfitImages!.map((img, i) => (
              <button
                key={img.id}
                type="button"
                onClick={() => void save({ currentOutfit: character.outfits?.[i] ?? character.currentOutfit })}
                title={character.outfits?.[i] ?? `第 ${i + 1} 套`}
                className={`h-24 w-24 shrink-0 overflow-hidden rounded-lg border ${
                  character.currentOutfit && character.outfits?.[i] === character.currentOutfit
                    ? 'border-[hsl(var(--accent))] ring-1 ring-[hsl(var(--accent))]'
                    : 'border-[hsl(var(--border-soft))]'
                }`}
              >
                <img src={duanjuFileUrl(workId, img.path)} alt={`服装 ${i + 1}`} className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        )}
        <textarea
          defaultValue={(character.outfits ?? []).join('\n')}
          onBlur={(e) => {
            const next = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
            if (next.join('\n') !== (character.outfits ?? []).join('\n')) void save({ outfits: next });
          }}
          placeholder={'每行一套服装（分帧生图时注入；也可手写后自行生图）：\n白色立领衬衫＋深灰百褶裙＋黑色乐福鞋'}
          rows={3}
          className={`${inputCls} mt-1.5`}
          aria-label="服装库"
        />
        <input
          defaultValue={character.currentOutfit ?? ''}
          onBlur={(e) => {
            if (e.target.value !== (character.currentOutfit ?? '')) void save({ currentOutfit: e.target.value.trim() || undefined });
          }}
          placeholder="当前穿着（点上方图自动填；分帧生图注入；空=用档案里的服装描述）"
          className={`${inputCls} mt-1.5`}
          aria-label="当前穿着"
        />
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="shrink-0 text-[11px] text-[hsl(var(--fg-muted))]">配音音色</span>
          <select
            defaultValue={character.voiceId ?? ''}
            onChange={(e) => void save({ voiceId: e.target.value || undefined })}
            className="h-8 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs outline-none"
            aria-label="配音音色"
            title="成片合成时该角色台词的 TTS 音色（minimax，跨镜头一致）——单人台词镜头自动生效；留空用 H3 生成原声"
          >
            <option value="">（不配音——用生成原声）</option>
            {MINIMAX_VOICES.map((v) => (
              <option key={v.voice} value={v.voice}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
      </details>

      {error && (
        <p className="mt-2 text-xs text-[hsl(var(--danger))]" role="alert">
          {error}
        </p>
      )}

      {/* 档案重生成（后台任务：切出安全） */}
      <div className="mt-2">
        <button
          type="button"
          onClick={regenerateProfile}
          disabled={profileBg.state?.status === 'submitting' || profileBg.state?.status === 'running'}
          data-testid="char-regen-profile"
          className="flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--accent))] disabled:opacity-40"
          title="结合剧本重新生成更详细的外观档案（生图一致性的事实源）"
        >
          <WandSparkles className="h-3 w-3" aria-hidden />
          {profileBg.state?.status === 'submitting' || profileBg.state?.status === 'running'
            ? `重生成中…（${profileBg.state.elapsedSec ?? 0}s，可切出）`
            : '✨ AI 重生成外观档案'}
        </button>
        <button
          type="button"
          onClick={() => void generateAnchor()}
          disabled={generating || saving}
          data-testid="char-gen-anchor"
          className="mt-1.5 flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--accent))] disabled:opacity-40"
          title="正脸大头照锚点（4:5）——分帧参考图建议选它：脸最稳，三视图整图会把景别往全身带"
        >
          <ImageIcon className="h-3 w-3" aria-hidden />
          生成大头照锚点
        </button>
      </div>

      {/* 设定图区 */}
      <input
        ref={sheetFileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => void onSheetPicked(e)}
      />
      <div className="mt-2">
        <button
          type="button"
          onClick={() => sheetFileRef.current?.click()}
          disabled={generating}
          className="flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--fg-muted))] disabled:opacity-40"
          data-testid="char-upload-sheet"
        >
          ⬆ 上传回流（外部生图归档）
        </button>
      </div>

      {character.sheetImages.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="char-sheets">
          {character.sheetImages.map((img) => {
            const isRef = character.refImageId === img.id;
            return (
              <div key={img.id} className="relative overflow-hidden rounded-lg border border-[hsl(var(--border-soft))]">
                <img src={duanjuFileUrl(workId, img.path)} alt={`${character.name} 设定图`} className="aspect-[3/2] w-full object-contain" />
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
