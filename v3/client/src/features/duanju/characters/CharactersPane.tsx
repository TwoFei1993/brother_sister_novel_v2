/**
 * 角色分区（共识 D6 / 资料第 3 课）：档案列表 + AI 提取 + 设定图生成
 *
 * - 「＋ 新增角色」：空白档案卡
 * - 「✨ 从人物关系提取」：审核卡 characterRelations + 剧本 → 角色档案 JSON（generateTextOnce）
 * - 每卡见 CharacterCard：档案编辑 / 设定图生成 / 主参考图选定
 */
import { useState } from 'react';
import { Plus, WandSparkles } from 'lucide-react';

import { useDuanjuStore } from '../store';
import { generateTextOnce } from '../../../api/llm';
import { useSettingsStore } from '../../../stores/settings';
import CharacterCard from './CharacterCard';
import { buildCharacterExtractMessages, parseCharacterExtract } from '../lib/characterExtract';
import type { DuanjuCharacter } from '@shared/duanju';

function newCharacter(): DuanjuCharacter {
  return {
    id: `char-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    profile: '',
    sheetImages: [],
    refImageId: null,
    updatedAt: Date.now(),
  };
}

export default function CharactersPane({ workId }: { workId: string }) {
  const { project, patch } = useDuanjuStore();
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!project) return null;

  async function addCharacter(): Promise<void> {
    await patch(workId, { characters: [...project!.characters, newCharacter()] });
  }

  /** AI 从剧本+人物关系提取角色档案（资料第 3 课：先有档案再有图） */
  async function extractCharacters(): Promise<void> {
    if (extracting) return;
    setExtracting(true);
    setError(null);
    try {
      const prefs = useSettingsStore.getState().llmPrefs;
      const raw = await generateTextOnce({
        source: prefs.source,
        model: prefs.model,
        messages: buildCharacterExtractMessages(
          project!.script.text,
          project!.reviewCards.characterRelations,
          project!.protagonists,
        ),
        thinking: false,
      });
      const list = parseCharacterExtract(raw);
      if (!list || list.length === 0) {
        setError('角色提取失败（模型未返回合法结果），请重试');
        return;
      }
      const existing = project!.characters;
      const merged = [...existing];
      for (const c of list) {
        // 同名角色不重复建
        if (!merged.some((x) => x.name === c.name)) {
          merged.push({
            id: `char-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: c.name,
            profile: c.profile,
            sheetImages: [],
            refImageId: null,
            updatedAt: Date.now(),
          });
        }
      }
      await patch(workId, { characters: merged });
    } catch (err) {
      setError(err instanceof Error ? err.message : '提取失败，请重试');
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl lg:max-w-5xl px-4 py-4" data-testid="duanju-characters">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void addCharacter()}
          className="flex h-9 items-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          新增角色
        </button>
        {project.script.text && (
          <button
            type="button"
            onClick={() => void extractCharacters()}
            disabled={extracting}
            className="flex h-9 items-center gap-1 rounded-lg border border-[hsl(var(--accent))] px-3 text-xs text-[hsl(var(--accent))] disabled:opacity-40"
            data-testid="characters-extract"
          >
            <WandSparkles className="h-3.5 w-3.5" aria-hidden />
            {extracting ? '提取中…' : '✨ 从剧本提取角色'}
          </button>
        )}
        <span className="text-xs text-[hsl(var(--fg-muted))]">
          {project.characters.length} 个角色 · 主参考图用于分镜人物一致性
        </span>
      </div>

      {error && (
        <p className="mb-3 text-xs text-[hsl(var(--danger))]" role="alert">
          {error}
        </p>
      )}

      {project.characters.length === 0 && (
        <p className="py-12 text-center text-sm text-[hsl(var(--fg-muted))]">
          还没有角色——手动新增，或点「从剧本提取角色」
        </p>
      )}

      <div className="flex flex-col gap-4">
        {project.characters.map((c) => (
          <CharacterCard key={c.id} workId={workId} character={c} />
        ))}
      </div>
    </div>
  );
}
