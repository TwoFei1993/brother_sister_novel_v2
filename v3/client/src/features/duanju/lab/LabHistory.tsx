/**
 * 试验台结果与历史（设计共识 2026-11-26 第 2.2 节）：历史网格（最新在前）+ 点开查看与操作
 *
 * 操作：复制提示词 / 下载 / 再出一张（本地通道换 seed）/ 用同参数回填 / 设为参考图 / 删除
 */
import { useState } from 'react';
import { Copy, Download, ImagePlus, Repeat, RefreshCw, Trash2, X } from 'lucide-react';

import type { LabRecord } from '@shared/duanju/lab';
import { duanjuFileUrl } from '../../../api/duanju';
import { showToast } from '../../../lib/toast';
import { ASPECT_LABELS, LAB_PROVIDER_LABELS } from '../lib/lab/aspects';
import { LAB_KIND_LABELS } from '../lib/lab/prompts-lab';

interface Props {
  workId: string;
  /** null = 加载中 */
  records: LabRecord[] | null;
  /** 刚生成的那条（缩略图高亮，并自动打开） */
  lastId: string | null;
  /** 出图进行中：禁用「再出一张」「设为参考图」 */
  busy: boolean;
  onDelete: (record: LabRecord) => void;
  onReroll: (record: LabRecord) => void;
  onReuse: (record: LabRecord) => void;
  onUseAsRef: (record: LabRecord) => void;
}

const toolCls =
  'flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] px-2 text-[11px] text-[hsl(var(--fg-muted))] transition-colors hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--fg))] disabled:opacity-40';

export default function LabHistory({ workId, records, lastId, busy, onDelete, onReroll, onReuse, onUseAsRef }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  // 最新在前；打开的记录被删除后自动关闭
  const ordered = records ? [...records].reverse() : null;
  const open = ordered?.find((r) => r.id === openId) ?? null;

  async function copyPrompt(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      showToast('提示词已复制');
    } catch {
      showToast('复制失败——请长按提示词手动选择复制');
    }
  }

  return (
    <section className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4" data-testid="lab-history">
      {ordered === null && <p className="text-xs text-[hsl(var(--fg-muted))]">试验记录加载中…</p>}
      {ordered !== null && ordered.length === 0 && (
        <p className="py-6 text-center text-xs leading-5 text-[hsl(var(--fg-muted))]" data-testid="lab-empty">
          还没有试验记录——在上面输入一句话开始
        </p>
      )}
      {ordered !== null && ordered.length > 0 && (
        <>
          <h3 className="mb-2.5 text-sm font-semibold">试验记录（{ordered.length}）</h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {ordered.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setOpenId(r.id)}
                aria-label={`查看：${r.brief}`}
                data-testid={`lab-thumb-${r.id}`}
                className={`aspect-[3/4] overflow-hidden rounded-lg border bg-[hsl(var(--bg))] transition-colors ${
                  r.id === lastId ? 'border-[hsl(var(--accent))]' : 'border-[hsl(var(--border-soft))]'
                }`}
              >
                <img
                  src={duanjuFileUrl(workId, r.image.path)}
                  alt={r.brief}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        </>
      )}

      {open && (
        <div
          className="m-fade fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
          onClick={() => setOpenId(null)}
        >
          <div
            className="m-sheet safe-bottom flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-[hsl(var(--surface))] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="试验图详情"
            data-testid="lab-detail"
          >
            <div className="flex items-center justify-between border-b border-[hsl(var(--border-soft))] px-4 py-2.5">
              <p className="min-w-0 flex-1 truncate text-sm">{open.brief}</p>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                aria-label="关闭"
                className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg))]"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <img
                src={duanjuFileUrl(workId, open.image.path)}
                alt={open.brief}
                className="mx-auto max-h-[50vh] rounded-lg bg-black/30 object-contain"
                data-testid="lab-detail-image"
              />
              <p className="mt-2 text-xs text-[hsl(var(--fg-muted))]">
                {LAB_KIND_LABELS[open.kind]} · {LAB_PROVIDER_LABELS[open.provider]} · {ASPECT_LABELS[open.aspect]} ·{' '}
                {open.width}×{open.height}
                {open.provider === 'comfy' ? ` · seed ${open.seed}` : ''} · 用时 {open.elapsedSec}s
              </p>
              {open.refs.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5" data-testid="lab-detail-refs">
                  <span className="shrink-0 text-xs text-[hsl(var(--fg-muted))]">参考图：</span>
                  {open.refs.map((ref, i) => (
                    <img
                      key={ref.path}
                      src={duanjuFileUrl(workId, ref.path)}
                      alt={ref.caption || `参考图 ${i + 1}`}
                      title={`图${i + 1}：${ref.caption}`}
                      className="h-12 w-9 rounded border border-[hsl(var(--border-soft))] object-cover"
                    />
                  ))}
                </div>
              )}
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-2.5 text-xs leading-5" data-testid="lab-detail-prompt">
                {open.prompt}
              </pre>
              <div className="mt-3 flex gap-1.5">
                <button type="button" className={toolCls} onClick={() => void copyPrompt(open.prompt)} data-testid="lab-copy">
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  复制
                </button>
                <a className={toolCls} href={duanjuFileUrl(workId, open.image.path)} download={`lab-${open.id}.png`} data-testid="lab-download">
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  下载
                </a>
                <button
                  type="button"
                  className={toolCls}
                  disabled={busy}
                  onClick={() => onReroll(open)}
                  data-testid="lab-reroll"
                  title={open.provider === 'comfy' ? '同一提示词换一个随机种子再出一张' : '同一提示词再生成一张'}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  {open.provider === 'comfy' ? '换 seed 再出' : '再出一张'}
                </button>
                <button type="button" className={toolCls} disabled={busy} onClick={() => { onReuse(open); setOpenId(null); }} data-testid="lab-reuse">
                  <Repeat className="h-3.5 w-3.5" aria-hidden />
                  回填修改
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { onUseAsRef(open); setOpenId(null); }}
                  data-testid="lab-use-as-ref"
                  title="把这张图加到输入区的参考图里（以它为底图再改）"
                  className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--border-soft))] px-2 text-[11px] text-[hsl(var(--fg-muted))] transition-colors hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--fg))] disabled:opacity-40"
                >
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                  设为参考图
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (confirm('删除这条试验记录及其图片？')) {
                      onDelete(open);
                      setOpenId(null);
                    }
                  }}
                  data-testid="lab-delete"
                  className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--danger))]/50 px-2 text-[11px] text-[hsl(var(--danger))] disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  删除这条记录
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
