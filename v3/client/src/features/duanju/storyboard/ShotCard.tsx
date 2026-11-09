/**
 * 镜头卡（共识 D7/D8 → 成本优化后：分帧模式 / 资料第 5-6 课）
 *
 * - 帧区（FramesGrid）：分帧 2×2 + 单帧重roll + 拼图下载 + 帧描述编辑；旧整图兼容
 * - 字段编辑（景别/运镜/动作/站位/台词/声音/出场角色/场景）blur 保存 + 站位快览
 * - 即梦四件套：复制视频提示词 / 打开即梦 / 成品上传回传（D10）
 */
import { useRef, useState } from 'react';
import { ExternalLink, Upload } from 'lucide-react';

import { useDuanjuStore } from '../store';
import { uploadDuanjuVideo, duanjuFileUrl } from '../../../api/duanju';
import { buildVideoPrompt } from '../lib/prompts/prompts-storyboard';
import { parseStaging } from '../lib/cost/stagingMap';
import { isShotStale } from '../lib/stale';
import type { DuanjuShot } from '@shared/duanju';
import FramesGrid from './FramesGrid';

interface Props {
  workId: string;
  shot: DuanjuShot;
}

const JIMENG_URL = 'https://jimeng.jianying.com/';

export default function ShotCard({ workId, shot }: Props) {
  const { project, patch } = useDuanjuStore();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!project) return null;
  const stale = isShotStale(shot, project);
  const hasImage = (shot.frames?.length ?? 0) > 0 || !!shot.gridImage;
  const staging = parseStaging(
    shot.staging,
    shot.characterIds.map((cid) => project.characters.find((c) => c.id === cid)).filter((c): c is NonNullable<typeof c> => !!c),
  );

  async function save(next: Partial<DuanjuShot>): Promise<void> {
    const shots = project!.shots.map((s) => (s.id === shot.id ? { ...s, ...next, updatedAt: Date.now() } : s));
    await patch(workId, { shots });
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

  const zone = (names: string[], label: string, tone: string) =>
    names.length > 0 && (
      <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${tone}`}>
        {label}：{names.join('、')}
      </span>
    );

  return (
    <div className="rounded-xl border border-[hsl(var(--border-soft))] p-4" data-testid="duanju-shot-card">
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* 帧区（分帧 2×2 / 旧整图兼容） */}
        <div className="relative w-full shrink-0 sm:w-56 md:w-64">
          {stale && (
            <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-[hsl(var(--danger))] px-2 py-0.5 text-[11px] text-white">
              待刷新
            </span>
          )}
          <FramesGrid workId={workId} shot={shot} project={project} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void copyVideoPrompt()}
              disabled={!hasImage}
              className="flex h-9 items-center justify-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] text-xs disabled:opacity-40"
            >
              {copied ? '✓ 已复制' : '复制提示词'}
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
            <input
              type="number"
              min={1}
              max={120}
              value={shot.durationSec ?? 8}
              onChange={(e) => void save({ durationSec: Math.max(1, Math.min(120, Number(e.target.value) || 8)) })}
              aria-label="时长秒"
              title="预估时长（秒）——剧本导出时间轴依据"
              className="h-8 w-16 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-center outline-none"
            />
            <span className="text-[11px] text-[hsl(var(--fg-muted))]">秒</span>
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
          {/* 站位快览（零成本预检：生图前肉眼拦站位废图） */}
          {(staging.left.length > 0 || staging.center.length > 0 || staging.right.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="staging-map">
              {zone(staging.left, '左', 'bg-blue-500/15 text-blue-600')}
              {zone(staging.center, '中', 'bg-emerald-500/15 text-emerald-600')}
              {zone(staging.right, '右', 'bg-orange-500/15 text-orange-600')}
              {zone(staging.unknown, '未标', 'bg-[hsl(var(--bg))] text-[hsl(var(--fg-muted))]')}
            </div>
          )}
          <input
            defaultValue={shot.dialog}
            onBlur={(e) => e.target.value !== shot.dialog && void save({ dialog: e.target.value })}
            placeholder="台词（无则空）"
            className={inputCls}
            aria-label="台词"
          />
          <details className="text-xs text-[hsl(var(--fg-muted))]">
            <summary className="cursor-pointer">旧整图 prompt（兼容，新流程用帧描述）</summary>
            <textarea
              defaultValue={shot.gridPrompt}
              onBlur={(e) => e.target.value !== shot.gridPrompt && void save({ gridPrompt: e.target.value })}
              rows={4}
              className={`${inputCls} mt-1 font-mono text-xs leading-5`}
              aria-label="四宫格 prompt"
            />
          </details>
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
