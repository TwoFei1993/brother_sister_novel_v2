/**
 * 场景分区（共识 D6 / 资料第 4 课）：场景档案列表 + 场景图生成
 *
 * 场景 = 后续分镜的画面氛围基准（空间/光影/道具统一）。卡内：名字/spec 编辑 +
 * 「生成场景图」（16:9 横版概念图）。AI 提取场景与角色提取同构（Phase 2 简版：手动建）。
 */
import { Plus, Trash2, ImageIcon } from 'lucide-react';

import { useDuanjuStore } from '../store';
import { generateDuanjuImage, duanjuFileUrl } from '../../../api/duanju';
import { sceneImagePrompt } from '../lib/prompts-image';
import { useState } from 'react';
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

  const inputCls =
    'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--accent))]';

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4" data-testid="duanju-scenes">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void addScene()}
          className="flex h-9 items-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          新增场景
        </button>
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
          还没有场景——新增一个（例：飞船货舱 / 黄昏荒原 / 悬崖边）
        </p>
      )}

      <div className="flex flex-col gap-4">
        {project.scenes.map((scene) => (
          <div key={scene.id} className="rounded-xl border border-[hsl(var(--border-soft))] p-4" data-testid="duanju-scene-card">
            <div className="flex items-center gap-2">
              <input
                value={scene.name}
                onChange={(e) => void saveScene(scene.id, { name: e.target.value })}
                placeholder="场景名（必填）"
                className="h-10 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm font-medium outline-none focus:border-[hsl(var(--accent))]"
                aria-label="场景名"
              />
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
                    className="aspect-video w-full rounded-lg border border-[hsl(var(--border-soft))] object-cover"
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
