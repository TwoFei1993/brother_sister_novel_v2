/**
 * 角色分区（共识 D6 / 资料第 3 课）：档案列表 + AI 提取 + 设定图生成
 *
 * - 「＋ 新增角色」：空白档案卡
 * - 「✨ 从人物关系提取」：审核卡 characterRelations + 剧本 → 角色档案 JSON（generateTextOnce）
 * - 每卡见 CharacterCard：档案编辑 / 设定图生成 / 主参考图选定
 */
import { useEffect, useState } from 'react';
import { Plus, WandSparkles } from 'lucide-react';

import { useDuanjuStore } from '../store';
import { generateTextOnce } from '../../../api/llm';
import { useSettingsStore } from '../../../stores/settings';
import CharacterCard from './CharacterCard';
import { ImageQueue } from '../lib/imageQueue';
import { characterSheetPrompt } from '../lib/prompts-image';
import { ImagePlus } from 'lucide-react';
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
  /** 一键全部出图（反馈 #8）：并发 2 队列，进行中切 tab 不中断（pane 常驻挂载） */
  const [queue] = useState(() => new ImageQueue());
  const [batching, setBatching] = useState(0); // 剩余任务数（0=空闲）

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
        {/* 画风（反馈 #8：设定图界面可改，改后全项目生效） */}
        <label className="flex items-center gap-1.5 text-xs text-[hsl(var(--fg-muted))]">
          画风
          <select
            value={project.style}
            onChange={(e) => void patch(workId, { style: e.target.value })}
            className="h-9 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs outline-none"
            data-testid="style-select"
          >
            {['动漫风', '3D 卡通', '写实', '国漫', '水墨'].map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </label>
        {/* 一键全部角色出图（反馈 #8） */}
        {project.characters.some((c) => c.name.trim() && c.profile.trim()) && (
          <button
            type="button"
            onClick={() => {
              const targets = project!.characters.filter((c) => c.name.trim() && c.profile.trim());
              queue.setOnProject(() => useDuanjuStore.getState().load(workId));
              setBatching(targets.length);
              queue.enqueue(
                workId,
                targets.map((c) => ({
                  input: {
                    kind: 'character' as const,
                    refId: c.id,
                    prompt: characterSheetPrompt(project!.style, c.name, c.profile),
                    aspectRatio: '3:4',
                    provider: useSettingsStore.getState().llmPrefs.imageProvider,
                  },
                  label: c.name,
                })),
              );
            }}
            disabled={batching > 0}
            className="flex h-9 items-center gap-1 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
            data-testid="characters-batch-gen"
          >
            <ImagePlus className="h-3.5 w-3.5" aria-hidden />
            {batching > 0 ? `批量生成中 剩${batching}…` : '⚡ 一键全部出设定图'}
          </button>
        )}
      </div>

      {batching > 0 && <QueueProgress queue={queue} onIdle={() => setBatching(0)} />}

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

/** 队列进度条（一键全部出图时显示；idle 时回调清零） */
function QueueProgress({ queue, onIdle }: { queue: ImageQueue; onIdle: () => void }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const un = queue.subscribe(() => setTick((t) => t + 1));
    return () => {
      un();
    };
  }, [queue]);
  const states = queue.snapshot();
  const done = [...states.values()].filter((x) => x.status === 'done').length;
  const fail = [...states.values()].filter((x) => x.status === 'fail').length;
  const total = states.size;
  useEffect(() => {
    if (total > 0 && done + fail >= total) onIdle();
  }, [total, done, fail, onIdle]);
  if (total === 0) return null;
  return (
    <p className="mb-3 text-xs text-[hsl(var(--fg-muted))]" data-testid="char-batch-progress">
      批量出图：{done}/{total} 成功{fail > 0 ? ` · 失败 ${fail}` : ''}
    </p>
  );
}
