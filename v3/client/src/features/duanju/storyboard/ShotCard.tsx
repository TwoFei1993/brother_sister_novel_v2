/**
 * 镜头卡（frontend-design 精修版）：序号章 + 分组字段（mini-label 上置）+ 帧区/工具分列
 *
 * - 头部：S 序号章（accent 圆章）+ 景别/运镜/时长规格字段（mini-label 可辨）+ stale 角标
 * - 字段：动作对（起→终点）、站位/声音、台词、关联（角色/场景 select+badge）
 * - 工具列：ShotTools（复制→即梦/豆包→分镜图→传成品→成品播放）
 */
import { useRef, useState } from 'react';

import { useDuanjuStore } from '../store';
import { uploadDuanjuVideo, duanjuFileUrl } from '../../../api/duanju';
import { parseStaging } from '../lib/cost/stagingMap';
import { isShotStale } from '../lib/stale';
import type { DuanjuShot } from '@shared/duanju';
import FramesGrid from './FramesGrid';
import ShotTools from './ShotTools';

interface Props {
  workId: string;
  shot: DuanjuShot;
}

/** mini-label 字段：标签上置 10px，输入不再靠 placeholder 猜（可用性修正） */
function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-[hsl(var(--fg-muted))]">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2.5 py-1.5 text-[13px] outline-none focus:border-[hsl(var(--accent))]';

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
    const { buildVideoPrompt } = await import('../lib/prompts/prompts-storyboard');
    try {
      await navigator.clipboard.writeText(buildVideoPrompt(shot, project!));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('复制失败——请手动选择文本复制');
    }
  }

  /** 下载分镜图：旧整图 gridImage / 新分帧首帧（喂即梦） */
  function downloadGridImage(): void {
    const path = shot.gridImage?.path ?? shot.frames?.[0]?.image?.path;
    if (!path) return;
    const a = document.createElement('a');
    a.href = duanjuFileUrl(workId, path);
    a.download = `S${String(shot.index).padStart(2, '0')}.png`;
    a.click();
  }

  async function onVideoPicked(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
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

  const specInput =
    'h-8 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-1.5 text-center text-[13px] outline-none focus:border-[hsl(var(--accent))]';

  const zone = (names: string[], label: string, tone: string) =>
    names.length > 0 && (
      <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${tone}`}>
        {label}：{names.join('、')}
      </span>
    );

  return (
    <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]/60 p-3 sm:p-4" data-testid="duanju-shot-card">
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* 左列：帧区 + 工具组 */}
        <div className="w-full shrink-0 sm:w-60">
          <div className="relative">
            {stale && (
              <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-[hsl(var(--danger))] px-2 py-0.5 text-[11px] text-white">
                待刷新
              </span>
            )}
            <FramesGrid workId={workId} shot={shot} project={project} />
          </div>
          <div className="mt-2.5">
            <ShotTools
              workId={workId}
              shot={shot}
              hasImage={hasImage}
              copied={copied}
              uploading={uploading}
              fileRef={fileRef}
              onCopy={() => void copyVideoPrompt()}
              onUploadVideo={(e) => void onVideoPicked(e)}
              onOpenFilePicker={() => fileRef.current?.click()}
              onDownloadImage={downloadGridImage}
            />
          </div>
        </div>

        {/* 右列：字段组 */}
        <div className="min-w-0 flex-1">
          {/* 头部：序号章 + 规格字段 */}
          <div className="flex flex-wrap items-end gap-x-2 gap-y-2">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-[hsl(var(--accent))] text-sm font-bold text-[hsl(var(--accent))]"
              aria-label={`镜头 ${shot.index}`}
            >
              {shot.index}
            </span>
            <Field label="景别" className="w-[4.5rem]">
              <input value={shot.shotSize} onChange={(e) => void save({ shotSize: e.target.value })} className={specInput} />
            </Field>
            <Field label="运镜" className="w-[4.5rem]">
              <input value={shot.cameraMove} onChange={(e) => void save({ cameraMove: e.target.value })} className={specInput} />
            </Field>
            <Field label="时长(秒)" className="w-[3.5rem]" >
              <input
                type="number"
                min={1}
                max={120}
                value={shot.durationSec ?? 8}
                onChange={(e) => void save({ durationSec: Math.max(1, Math.min(120, Number(e.target.value) || 8)) })}
                title="预估时长——剧本导出时间轴依据"
                className={specInput}
              />
            </Field>
            <Field label="场景" className="min-w-[7rem] flex-1">
              <select
                value={shot.sceneId ?? ''}
                onChange={(e) => void save({ sceneId: e.target.value || null })}
                className="h-8 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-1.5 text-[13px] outline-none"
              >
                <option value="">未指定</option>
                {project.scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* 动作对 */}
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="动作起点">
              <input
                defaultValue={shot.actionStart}
                onBlur={(e) => e.target.value !== shot.actionStart && void save({ actionStart: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="动作终点">
              <input
                defaultValue={shot.actionEnd}
                onBlur={(e) => e.target.value !== shot.actionEnd && void save({ actionEnd: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="人物站位">
              <input
                defaultValue={shot.staging}
                onBlur={(e) => e.target.value !== shot.staging && void save({ staging: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="声音要求">
              <input
                defaultValue={shot.sound}
                onBlur={(e) => e.target.value !== shot.sound && void save({ sound: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>

          {/* 站位快览（零成本预检） */}
          {(staging.left.length > 0 || staging.center.length > 0 || staging.right.length > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="staging-map">
              {zone(staging.left, '左', 'bg-blue-500/15 text-blue-500')}
              {zone(staging.center, '中', 'bg-emerald-500/15 text-emerald-500')}
              {zone(staging.right, '右', 'bg-orange-500/15 text-orange-500')}
              {zone(staging.unknown, '未标', 'bg-[hsl(var(--bg))] text-[hsl(var(--fg-muted))]')}
            </div>
          )}

          <div className="mt-2">
            <Field label="台词">
              <input
                defaultValue={shot.dialog}
                onBlur={(e) => e.target.value !== shot.dialog && void save({ dialog: e.target.value })}
                placeholder="（无则留空）"
                className={inputCls}
              />
            </Field>
          </div>

          {/* 出场角色 chips + 增选 */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {shot.characterIds.map((cid) => (
              <button
                key={cid}
                type="button"
                onClick={() => void save({ characterIds: shot.characterIds.filter((x) => x !== cid) })}
                title="点击移除"
                className="h-7 rounded-full bg-[hsl(var(--accent))]/15 px-2.5 text-xs text-[hsl(var(--accent))]"
              >
                {project.characters.find((c) => c.id === cid)?.name ?? '?'} ✕
              </button>
            ))}
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
              aria-label="增选出场角色"
              className="h-7 rounded-full border border-dashed border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs text-[hsl(var(--fg-muted))] outline-none"
            >
              <option value="">+ 出场角色…</option>
              {project.characters
                .filter((c) => !shot.characterIds.includes(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>

          {/* 生图 prompt 折叠 */}
          <details className="mt-2 text-xs text-[hsl(var(--fg-muted))]">
            <summary className="cursor-pointer select-none">提示词（分帧 prompt 数据源，可改后重roll）</summary>
            <textarea
              defaultValue={shot.gridPrompt}
              onBlur={(e) => e.target.value !== shot.gridPrompt && void save({ gridPrompt: e.target.value })}
              rows={4}
              className={`${inputCls} mt-1 font-mono leading-5`}
              aria-label="四宫格 prompt"
            />
          </details>

          {error && (
            <p className="mt-2 text-xs text-[hsl(var(--danger))]" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
