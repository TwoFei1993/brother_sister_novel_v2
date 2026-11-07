/**
 * 镜头卡（共识 D7/D8 / 资料第 5-6 课）
 *
 * - 四宫格图（aspect 1:1）：stale 角标（上游已改）；点击看大图
 * - 字段编辑（景别/运镜/动作/站位/台词/声音/出场角色/场景）blur 保存
 * - gridPrompt 可编辑（组装器产出后手改）→「生成/重roll四宫格」（修镜头=编辑后整张重roll）
 * - 即梦四件套：复制视频提示词 / 下载四宫格 / 打开即梦（新开页）
 */
import { useRef, useState } from 'react';
import { Download, ExternalLink, ImagePlus, RefreshCw, Upload } from 'lucide-react';

import { useDuanjuStore } from '../store';
import { generateDuanjuImage, uploadDuanjuVideo, duanjuFileUrl } from '../../../api/duanju';
import { buildVideoPrompt } from '../lib/prompts-storyboard';
import { isShotStale } from '../lib/stale';
import type { DuanjuShot } from '@shared/duanju';

interface Props {
  workId: string;
  shot: DuanjuShot;
}

const JIMENG_URL = 'https://jimeng.jianying.com/';

export default function ShotCard({ workId, shot }: Props) {
  const { project, patch } = useDuanjuStore();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!project) return null;
  const stale = isShotStale(shot, project);

  async function save(next: Partial<DuanjuShot>): Promise<void> {
    const shots = project!.shots.map((s) => (s.id === shot.id ? { ...s, ...next, updatedAt: Date.now() } : s));
    await patch(workId, { shots });
  }

  async function generateGrid(): Promise<void> {
    if (generating) return;
    if (!shot.gridPrompt.trim()) {
      setError('gridPrompt 为空——先完善镜头字段或用 AI 拆镜头生成');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      await generateDuanjuImage(workId, { kind: 'shot', refId: shot.id, prompt: shot.gridPrompt, aspectRatio: '1:1' });
      await useDuanjuStore.getState().load(workId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  }

  async function copyVideoPrompt(): Promise<void> {
    const text = buildVideoPrompt(shot, project!);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('复制失败——请手动选择文本复制');
    }
  }

  function downloadGrid(): void {
    if (!shot.gridImage) return;
    const a = document.createElement('a');
    a.href = duanjuFileUrl(workId, shot.gridImage!.path);
    a.download = `S${String(shot.index).padStart(2, '0')}.png`;
    a.click();
  }

  /** 成品视频回传（D10）：即梦生成后上传归档，卡内播放 */
  async function onVideoPicked(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ''; // 同文件可重复选
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      await uploadDuanjuVideo(workId, shot.id, file);
      await useDuanjuStore.getState().load(workId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，请重试');
    } finally {
      setUploading(false);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--accent))]';

  return (
    <div className="rounded-xl border border-[hsl(var(--border-soft))] p-4" data-testid="duanju-shot-card">
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* 四宫格区 */}
        <div className="w-full shrink-0 sm:w-56">
          <div className="relative overflow-hidden rounded-lg border border-[hsl(var(--border-soft))]">
            {shot.gridImage ? (
              <img
                src={duanjuFileUrl(workId, shot.gridImage.path)}
                alt={`镜头 ${shot.index} 四宫格`}
                className="aspect-square w-full object-cover"
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center bg-[hsl(var(--bg))] text-xs text-[hsl(var(--fg-muted))]">
                未生成
              </div>
            )}
            {stale && (
              <span className="absolute left-1.5 top-1.5 rounded-full bg-[hsl(var(--danger))] px-2 py-0.5 text-[11px] text-white">
                待刷新
              </span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void generateGrid()}
              disabled={generating}
              className="flex h-9 items-center justify-center gap-1 rounded-lg bg-[hsl(var(--accent))] text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
              data-testid="shot-gen-grid"
            >
              {generating ? (
                '生成中…'
              ) : shot.gridImage ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  重roll
                </>
              ) : (
                <>
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                  生成四宫格
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => void copyVideoPrompt()}
              disabled={!shot.gridImage}
              className="flex h-9 items-center justify-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] text-xs disabled:opacity-40"
            >
              {copied ? '✓ 已复制' : '复制提示词'}
            </button>
            <button
              type="button"
              onClick={downloadGrid}
              disabled={!shot.gridImage}
              className="flex h-9 items-center justify-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] text-xs disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              下载图
            </button>
            <a
              href={JIMENG_URL}
              target="_blank"
              rel="noreferrer"
              className="flex h-9 items-center justify-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] text-xs"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              打开即梦
            </a>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="col-span-2 flex h-9 items-center justify-center gap-1 rounded-lg border border-dashed border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--fg-muted))] disabled:opacity-40"
              data-testid="shot-upload-video"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden />
              {uploading ? '上传中…' : shot.finalVideo ? '替换成品视频' : '上传即梦成品视频'}
            </button>
            <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime" hidden onChange={(e) => void onVideoPicked(e)} />
          </div>
          {shot.finalVideo && (
            <video
              src={duanjuFileUrl(workId, shot.finalVideo.path)}
              controls
              playsInline
              preload="metadata"
              className="mt-2 w-full rounded-lg border border-[hsl(var(--border-soft))]"
              data-testid="shot-final-video"
            />
          )}
        </div>

        {/* 字段区 */}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--fg-muted))]">
            <span className="font-medium text-[hsl(var(--fg))]">镜头 {shot.index}</span>
            <input
              value={shot.shotSize}
              onChange={(e) => void save({ shotSize: e.target.value })}
              aria-label="景别"
              className="h-8 w-20 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-center outline-none"
            />
            <input
              value={shot.cameraMove}
              onChange={(e) => void save({ cameraMove: e.target.value })}
              aria-label="运镜"
              className="h-8 w-20 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-center outline-none"
            />
            {/* 出场角色多选 */}
            <select
              multiple={false}
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const has = shot.characterIds.includes(e.target.value);
                void save({
                  characterIds: has
                    ? shot.characterIds.filter((x) => x !== e.target.value)
                    : [...shot.characterIds, e.target.value],
                });
              }}
              aria-label="出场角色"
              className="h-8 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 outline-none"
            >
              <option value="">+ 角色…</option>
              {project.characters
                .filter((c) => !shot.characterIds.includes(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <select
              value={shot.sceneId ?? ''}
              onChange={(e) => void save({ sceneId: e.target.value || null })}
              aria-label="场景"
              className="h-8 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 outline-none"
            >
              <option value="">场景…</option>
              {project.scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {shot.characterIds.length > 0 && (
              <span className="rounded-full bg-[hsl(var(--accent))]/15 px-2 py-0.5 text-[hsl(var(--accent))]">
                {shot.characterIds
                  .map((cid) => project.characters.find((c) => c.id === cid)?.name)
                  .filter(Boolean)
                  .join('·')}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              defaultValue={shot.actionStart}
              onBlur={(e) => e.target.value !== shot.actionStart && void save({ actionStart: e.target.value })}
              placeholder="动作起点"
              className={inputCls}
              aria-label="动作起点"
            />
            <input
              defaultValue={shot.actionEnd}
              onBlur={(e) => e.target.value !== shot.actionEnd && void save({ actionEnd: e.target.value })}
              placeholder="动作终点"
              className={inputCls}
              aria-label="动作终点"
            />
            <input
              defaultValue={shot.staging}
              onBlur={(e) => e.target.value !== shot.staging && void save({ staging: e.target.value })}
              placeholder="人物站位"
              className={inputCls}
              aria-label="人物站位"
            />
            <input
              defaultValue={shot.sound}
              onBlur={(e) => e.target.value !== shot.sound && void save({ sound: e.target.value })}
              placeholder="声音要求（环境/动作/对白）"
              className={inputCls}
              aria-label="声音要求"
            />
          </div>
          <input
            defaultValue={shot.dialog}
            onBlur={(e) => e.target.value !== shot.dialog && void save({ dialog: e.target.value })}
            placeholder="台词（无则空）"
            className={inputCls}
            aria-label="台词"
          />
          <textarea
            defaultValue={shot.gridPrompt}
            onBlur={(e) => e.target.value !== shot.gridPrompt && void save({ gridPrompt: e.target.value })}
            placeholder="四宫格生图 prompt（AI 拆镜头自动组装；可手改后重roll=修镜头）"
            rows={4}
            className={`${inputCls} font-mono text-xs leading-5`}
            aria-label="四宫格 prompt"
          />
          {error && (
            <p className="text-xs text-[hsl(var(--danger))]" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
