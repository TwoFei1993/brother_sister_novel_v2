/**
 * 场景分区（共识 D6 / 资料第 4 课）：场景档案列表 + 场景图生成 + AI 提取（后台化）
 *
 * 场景 = 后续分镜的画面氛围基准（空间/光影/道具统一）。卡内：名字/spec 编辑 +
 * 「生成场景图」（16:9 横版概念图）。「从剧本提取场景」走 server 后台任务（切出安全）。
 */
import { Plus, Trash2, ImageIcon, WandSparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useDuanjuStore } from '../store';
import { generateDuanjuImage, duanjuFileUrl } from '../../../api/duanju';
import { sceneImagePrompt } from '../lib/prompts/prompts-image';
import { buildSceneExtractMessages, parseSceneExtract, rebuildSceneSpecMessages } from '../lib/sceneExtract';
import { useBgLlmTask } from '../../../hooks/useBgLlmTask';
import { useSettingsStore } from '../../../stores/settings';
import type { DuanjuScene } from '@shared/duanju';

function newScene(): DuanjuScene {
  return {
    id: `scene-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    spec: '',
    images: [],
    updatedAt: Date.now(),
  };
}

export default function ScenesPane({ workId }: { workId: string }) {
  const { project, patch, saving } = useDuanjuStore();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 场景介绍重生成：同一时间只跑一个任务；写回目标持久化 localStorage（跨组件卸载/重挂恢复——ref 方案会丢结果） */
  const PENDING_KEY = `scene-spec-pending-${workId}`;
  const specBg = useBgLlmTask(
    `scene-spec-${workId}`,
    (text) => {
      const sid = localStorage.getItem(PENDING_KEY);
      localStorage.removeItem(PENDING_KEY);
      if (!sid) return;
      void (async () => {
        const scenes = (useDuanjuStore.getState().project?.scenes ?? []).map((s) =>
          s.id === sid ? { ...s, spec: text.trim(), updatedAt: Date.now() } : s,
        );
        await useDuanjuStore.getState().patch(workId, { scenes });
      })();
    },
    (msg: string) => setError(msg),
  );

  /** 单场景介绍重生成（用户需求 2026-11-11：重生成文字描述而非图片）——后台任务（切出安全） */
  function regenerateSpec(scene: DuanjuScene): void {
    if (specBg.state?.status === 'submitting' || specBg.state?.status === 'running') return;
    if (!project!.script.text.trim()) {
      setError('剧本为空——先在剧本 tab 写/生成剧本');
      return;
    }
    setError(null);
    localStorage.setItem(PENDING_KEY, scene.id);
    specBg.submit({
      source: useSettingsStore.getState().llmPrefs.source,
      model: useSettingsStore.getState().llmPrefs.model,
      messages: rebuildSceneSpecMessages(project!.script.text, scene.name, scene.spec),
      thinking: false,
      params: { max_tokens: 2000 },
      label: `重写场景介绍·${scene.name || '未命名'}`,
    });
  }

  // 场景提取后台化（切出 App 继续生成，回来轮询取结果自动合并）
  const bg = useBgLlmTask(
    `scenes-extract-${workId}`,
    (raw) => {
      const cur = useDuanjuStore.getState().project;
      if (!cur) return;
      const list = parseSceneExtract(raw);
      if (!list || list.length === 0) {
        setError('场景提取失败（模型未返回合法结果），请重试');
        return;
      }
      void (async () => {
        const merged = [...cur.scenes];
        for (const sc of list) {
          if (!merged.some((x) => x.name === sc.name)) {
            merged.push({
              id: `scene-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: sc.name,
              spec: sc.spec,
              images: [],
              updatedAt: Date.now(),
            });
          }
        }
        await useDuanjuStore.getState().patch(workId, { scenes: merged });
      })();
    },
    (msg: string) => setError(msg),
  );

  if (!project) return null;

  async function saveScene(id: string, next: Partial<DuanjuScene>): Promise<void> {
    const scenes = project!.scenes.map((s) => (s.id === id ? { ...s, ...next, updatedAt: Date.now() } : s));
    await patch(workId, { scenes });
  }

  async function addScene(): Promise<void> {
    await patch(workId, { scenes: [...project!.scenes, newScene()] });
  }

  async function removeScene(id: string): Promise<void> {
    if (!confirm('删除该场景及其图片记录？')) return;
    await patch(workId, { scenes: project!.scenes.filter((s) => s.id !== id) });
  }

  async function generateSceneImage(scene: DuanjuScene): Promise<void> {
    if (!scene.name.trim() || !scene.spec.trim()) {
      setError('先填场景名和空间描述');
      return;
    }
    setBusyId(scene.id);
    setError(null);
    try {
      const prompt = sceneImagePrompt(project!.style, scene.name, scene.spec);
      await generateDuanjuImage(workId, { kind: 'scene', refId: scene.id, prompt, aspectRatio: '16:9' });
      await useDuanjuStore.getState().load(workId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请重试');
    } finally {
      setBusyId(null);
    }
  }

  /** AI 从剧本提取场景（反馈 #9：初始生成就该有，不应手填），同名去重——后台任务（切出安全） */
  function extractScenes(): void {
    if (bg.state?.status === 'submitting' || bg.state?.status === 'running') return;
    if (!project!.script.text.trim()) {
      setError('剧本为空——先在剧本 tab 写/生成剧本');
      return;
    }
    setError(null);
    const prefs = useSettingsStore.getState().llmPrefs;
    bg.submit({
      source: prefs.source,
      model: prefs.model,
      messages: buildSceneExtractMessages(project!.script.text),
      thinking: false,
      params: { max_tokens: 16000 },
      label: '场景提取',
    });
  }

  const inputCls =
    'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--accent))]';

  return (
    <div className="mx-auto w-full max-w-3xl lg:max-w-5xl px-4 py-4" data-testid="duanju-scenes">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void addScene()}
          className="flex h-9 items-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          新增场景
        </button>
        {project.script.text.trim() && (
          <button
            type="button"
            onClick={() => extractScenes()}
            disabled={bg.state?.status === 'submitting' || bg.state?.status === 'running'}
            className="flex h-9 items-center gap-1 rounded-lg border border-[hsl(var(--accent))] px-3 text-xs text-[hsl(var(--accent))] disabled:opacity-40"
            data-testid="scenes-extract"
          >
            <WandSparkles className="h-3.5 w-3.5" aria-hidden />
            {bg.state?.status === 'submitting' || bg.state?.status === 'running'
              ? `后台提取中…（${bg.state.elapsedSec ?? 0}s，可切出）`
              : '✨ 从剧本提取场景'}
          </button>
        )}
        <span className="text-xs text-[hsl(var(--fg-muted))]">
          {project.scenes.length} 个场景 · 空间/光影/道具统一，分镜氛围基准
        </span>
      </div>

      {error && (
        <p className="mb-3 text-xs text-[hsl(var(--danger))]" role="alert">
          {error}
        </p>
      )}

      {project.scenes.length === 0 && (
        <p className="py-12 text-center text-sm text-[hsl(var(--fg-muted))]">
          还没有场景——点「从剧本提取场景」自动识别，或手动新增
        </p>
      )}

      <div className="flex flex-col gap-4">
        {project.scenes.map((scene) => (
          <div key={scene.id} className="rounded-xl border border-[hsl(var(--border-soft))] p-4" data-testid="duanju-scene-card">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={scene.name}
                onChange={(e) => void saveScene(scene.id, { name: e.target.value })}
                placeholder="场景名（必填）"
                className="h-10 min-w-[8rem] flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm font-medium outline-none focus:border-[hsl(var(--accent))]"
                aria-label="场景名"
              />
              <button
                type="button"
                onClick={() => regenerateSpec(scene)}
                disabled={specBg.state?.status === 'submitting' || specBg.state?.status === 'running' || saving}
                className="flex h-10 shrink-0 items-center gap-1 rounded-lg border border-[hsl(var(--accent))]/50 px-3 text-xs text-[hsl(var(--accent))] disabled:opacity-40"
                title="结合剧本重写更详细的场景视觉档案（生图提示词的数据源）"
              >
                <WandSparkles className="h-3.5 w-3.5" aria-hidden />
                {pendingSceneRef.current === scene.id && (specBg.state?.status === 'running' || specBg.state?.status === 'submitting')
                  ? `重写中…（${specBg.state.elapsedSec ?? 0}s）`
                  : '✨ 重写介绍'}
              </button>
              <button
                type="button"
                onClick={() => void generateSceneImage(scene)}
                disabled={busyId === scene.id || saving}
                className="flex h-10 shrink-0 items-center gap-1 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
                data-testid="scene-gen"
              >
                <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                {busyId === scene.id ? '生成中…' : scene.images.length ? '再生成一张' : '生成场景图'}
              </button>
              <button
                type="button"
                onClick={() => void removeScene(scene.id)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--danger))]"
                aria-label="删除场景"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <textarea
              defaultValue={scene.spec}
              onBlur={(e) => {
                if (e.target.value !== scene.spec) void saveScene(scene.id, { spec: e.target.value });
              }}
              placeholder="空间结构 / 光影基调 / 关键道具 / 色彩（例：狭小货舱，红色警报灯旋转，管线杂乱，冷金属质感）"
              rows={2}
              className={`${inputCls} mt-2`}
              aria-label="场景描述"
            />
            {scene.images.length > 0 && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {scene.images.map((img) => (
                  <img
                    key={img.id}
                    src={duanjuFileUrl(workId, img.path)}
                    alt={`${scene.name} 概念图`}
                    className="aspect-[7/4] w-full rounded-lg border border-[hsl(var(--border-soft))] object-contain"
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
