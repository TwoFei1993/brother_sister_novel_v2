/**
 * 分镜分区（共识 D7 / 资料第 5 课）：集选择 + AI 拆镜头 + 镜头卡列表 + 整集批量
 *
 * - 集下拉（project.episodes，剧本拆解产出，可手增）
 * - 「AI 拆镜头」：generateTextOnce → parseStoryboard（角色/场景名映射 id + gridPrompt 组装）
 * - 批量：BatchBar（预估确认 → ImageQueue 排队 → 逐镜头状态；D6 烧钱操作不自动跑）
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, WandSparkles } from 'lucide-react';

import { useDuanjuStore } from '../store';
import { useSettingsStore } from '../../../stores/settings';
import { useBgLlmTask } from '../../../hooks/useBgLlmTask';
import { buildStoryboardMessages, parseStoryboard } from '../lib/prompts/prompts-storyboard';
import { storyboardHealth } from '../lib/stale';
import ShotCard from './ShotCard';
import BatchBar from './BatchBar';

/** 提交拆镜头时记录目标集（onDone/恢复路径定位 patch 目标；切出回来仍可定位） */
const splitEpKey = (workId: string): string => `v3-storyboard-split-ep-${workId}`;

export default function StoryboardPane({ workId }: { workId: string }) {
  const { project, patch } = useDuanjuStore();
  const [epIndex, setEpIndex] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);

  const episode = useMemo(
    () => project?.episodes.find((e) => e.index === epIndex) ?? null,
    [project, epIndex],
  );
  const shots = useMemo(
    () =>
      project
        ? [...project.shots].filter((s) => s.episodeId === episode?.id).sort((a, b) => a.index - b.index)
        : [],
    [project, episode],
  );
  const health = useMemo(
    () => (project && episode ? storyboardHealth(project, episode.id) : { stale: 0, withImage: 0, total: 0 }),
    [project, episode],
  );

  /** 拆镜头结果应用（onDone 与切出恢复共用）：解析 → 替换该集镜头清单 */
  function applySplit(raw: string): void {
    const cur = useDuanjuStore.getState().project;
    const epId = localStorage.getItem(splitEpKey(workId));
    localStorage.removeItem(splitEpKey(workId));
    if (!cur || !epId) return;
    const list = parseStoryboard(raw, epId, cur);
    if (list.length === 0) {
      setError('拆镜头失败（模型未返回合法结果），请重试');
      return;
    }
    const others = cur.shots.filter((s) => s.episodeId !== epId);
    void patch(workId, { shots: [...others, ...list] });
  }

  // 拆镜头后台化（切出 App 继续生成）：slot 按作品隔离（同一作品一次拆一集，天然互斥）
  const bg = useBgLlmTask(
    `storyboard-split-${workId}`,
    applySplit,
    (msg) => setError(msg),
  );
  const splitting = bg.state?.status === 'submitting' || bg.state?.status === 'running';

  // 后台任务恢复（mount 一次）：切出期间完成的拆镜头自动回填
  useEffect(() => {
    bg.resume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

  if (!project) return null;

  async function addShot(): Promise<void> {
    if (!episode) return;
    const next = {
      id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      episodeId: episode.id,
      index: shots.length + 1,
      shotSize: '中景',
      cameraMove: '固定',
      actionStart: '',
      actionEnd: '',
      staging: '',
      dialog: '',
      sound: '',
      gridParts: [],
      gridPrompt: '',
      durationSec: 8,
      frames: [],
      characterIds: [],
      sceneId: null,
      updatedAt: Date.now(),
    };
    await patch(workId, { shots: [...project!.shots, next] });
  }

  /** AI 拆镜头（替换本集镜头清单；二次确认防误清）→ server 后台任务（切出安全） */
  async function splitShots(): Promise<void> {
    if (!episode || splitting) return;
    if (shots.length > 0 && !confirm(`本集已有 ${shots.length} 个镜头，重新拆解将替换，继续？`)) return;
    setError(null);
    const prefs = useSettingsStore.getState().llmPrefs;
    localStorage.setItem(splitEpKey(workId), episode.id);
    await bg.submit({
      source: prefs.source,
      model: prefs.model,
      messages: buildStoryboardMessages(
        `${episode.title}：${episode.synopsis}`,
        project!.script.text,
        project!.characters,
        project!.scenes,
      ),
      thinking: false,
      params: { max_tokens: 32000 },
      label: `拆镜头·第${episode.index}集`,
    });
  }

  return (
    <div className="mx-auto w-full max-w-4xl lg:max-w-6xl px-4 py-4" data-testid="duanju-storyboard">
      {/* 集选择 + 操作 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={epIndex}
          onChange={(e) => setEpIndex(Number(e.target.value))}
          aria-label="选择集"
          className="h-9 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none"
        >
          {project.episodes.map((ep) => (
            <option key={ep.id} value={ep.index}>
              第 {ep.index} 集《{ep.title}》
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void splitShots()}
          disabled={!episode || splitting}
          className="flex h-9 items-center gap-1 rounded-lg border border-[hsl(var(--accent))] px-3 text-xs text-[hsl(var(--accent))] disabled:opacity-40"
          data-testid="storyboard-split"
        >
          <WandSparkles className="h-3.5 w-3.5" aria-hidden />
          {splitting ? '拆解中…' : '✨ AI 拆镜头'}
        </button>
        <button
          type="button"
          onClick={() => void addShot()}
          disabled={!episode}
          className="flex h-9 items-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          手动加镜头
        </button>
        {shots.length > 0 && (
          <button
            type="button"
            onClick={() => setBatchOpen(true)}
            className="flex h-9 items-center gap-1 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium text-[hsl(var(--accent-fg))]"
            data-testid="storyboard-batch"
          >
            ⚡ 整集批量出图
          </button>
        )}
        <span className="text-xs text-[hsl(var(--fg-muted))]">
          {health.total} 镜 · {health.withImage} 已出图
          {health.stale > 0 && (
            <span className="ml-1 text-[hsl(var(--danger))]" data-testid="stale-count">
              · {health.stale} 待刷新（上游已改）
            </span>
          )}
        </span>
      </div>

      {error && (
        <p className="mb-3 text-xs text-[hsl(var(--danger))]" role="alert">
          {error}
        </p>
      )}

      {splitting && (
        <p className="mb-3 text-xs text-[hsl(var(--fg-muted))]" data-testid="split-bg-tip">
          ⏳ 拆解中（后台执行）——切出去干别的，回来自动回填镜头清单…
        </p>
      )}

      {shots.length === 0 && (
        <p className="py-12 text-center text-sm text-[hsl(var(--fg-muted))]">
          本集还没有镜头——「AI 拆镜头」按剧本自动拆，或手动加
        </p>
      )}

      <div className="flex flex-col gap-4">
        {shots.map((shot) => (
          <ShotCard key={shot.id} workId={workId} shot={shot} />
        ))}
      </div>

      {batchOpen && episode && (
        <BatchBar
          workId={workId}
          episodeTitle={`第 ${episode.index} 集《${episode.title}》`}
          shots={shots}
          onClose={() => setBatchOpen(false)}
        />
      )}
    </div>
  );
}
