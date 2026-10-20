/**
 * 批量人设导入面板：勾选展板条目（默认全选）→「生成 N 张角色卡」串行 POST
 * /api/characters（进度 x/N，单条失败跳过并汇总）→ 可选把分部/全局设定生成
 * 世界书草稿 → 全部成功时回调父级跳 /library。
 * 部分失败时保留失败名单，提供「重试失败项（N）」仅对失败条目重发
 * （服务端同名幂等，已导入的不会因重试产生重复卡）。
 */
import { useState } from 'react';

import { apiFetch } from '../../../api/client';
import {
  buildSheetCardDraft,
  buildSheetWorldbookDraft,
  type CharacterSheetEntry,
  type SheetDocument,
} from '../../../lib/outline/sheet';

interface Props {
  sheet: SheetDocument;
  /** ok 为成功数；failed 非空时父级不自动跳转（面板展示汇总报告） */
  onFinished: (ok: number, failed: string[]) => void;
}

export default function SheetImportPanel({ sheet, onFinished }: Props) {
  const entries = sheet.entries;
  const [checked, setChecked] = useState<boolean[]>(() => entries.map(() => true));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<{ ok: number; failed: string[] } | null>(null);
  const [failedEntries, setFailedEntries] = useState<CharacterSheetEntry[]>([]);
  const [note, setNote] = useState('');

  const selectedCount = checked.filter(Boolean).length;
  const allChecked = selectedCount === entries.length;

  const toggle = (i: number): void => setChecked((prev) => prev.map((v, j) => (j === i ? !v : v)));
  const toggleAll = (): void => setChecked(entries.map(() => !allChecked));

  /** 串行导入给定条目；list 缺省 = 按勾选（首次导入），显式传入 = 失败项重试 */
  const importCards = async (list?: CharacterSheetEntry[]): Promise<void> => {
    const checkedEntries = entries.filter((_, i) => checked[i]);
    const picked = list ?? checkedEntries;
    if (picked.length === 0) {
      setNote('请至少勾选一位角色');
      return;
    }
    setBusy(true);
    setNote('');
    setReport(null);
    setProgress({ done: 0, total: picked.length });
    const failed: CharacterSheetEntry[] = [];
    let ok = 0;
    for (const entry of picked) {
      try {
        await apiFetch('/api/characters', {
          method: 'POST',
          body: JSON.stringify({ name: entry.name, card: buildSheetCardDraft(entry) }),
        });
        ok += 1;
      } catch {
        failed.push(entry);
      }
      setProgress({ done: ok + failed.length, total: picked.length });
    }
    setBusy(false);
    setProgress(null);
    setReport({ ok, failed: failed.map((f) => f.name) });
    setFailedEntries(failed);
    if (failed.length === 0) onFinished(ok, []);
    else if (ok > 0) setNote(`已导入 ${ok} 张，失败 ${failed.length} 张（可重试仅导入失败项）`);
    else setNote('全部导入失败，请检查后端服务');
  };

  const createWorldbook = async (): Promise<void> => {
    setBusy(true);
    try {
      const draft = buildSheetWorldbookDraft(sheet);
      await apiFetch('/api/worldbooks', { method: 'POST', body: JSON.stringify(draft) });
      onFinished(0, []);
    } catch (err) {
      setNote(err instanceof Error ? err.message : '世界书生成失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="批量人设导入" className="flex flex-col gap-3">
      <div className="rounded-xl border border-[hsl(var(--accent))]/40 bg-[hsl(var(--accent))]/5 p-3 text-sm">
        已识别批量人设展板：共 <strong>{entries.length}</strong> 位角色，默认全选，可逐条取消。
      </div>

      <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3">
        <label className="mb-2 flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={busy} aria-label="全选角色" />
          全选（{selectedCount}/{entries.length}）
        </label>
        <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {entries.map((e, i) => (
            <li key={`${e.name}-${i}`}>
              <label className="flex cursor-pointer flex-col gap-0.5 rounded-lg border border-[hsl(var(--border-soft))] px-3 py-2 text-xs">
                <span className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked[i] ?? false}
                    onChange={() => toggle(i)}
                    disabled={busy}
                    aria-label={`选择${e.name}`}
                  />
                  <span className="text-sm font-medium">{e.name}</span>
                  {e.identity && <span className="text-[hsl(var(--fg-muted))]">{e.identity}</span>}
                  {e.age !== undefined && <span className="rounded bg-[hsl(var(--accent))]/10 px-1.5 text-[hsl(var(--accent))]">{e.age}岁</span>}
                  {e.group && <span className="rounded bg-[hsl(var(--fg-muted))]/10 px-1.5 text-[hsl(var(--fg-muted))]">{e.group}</span>}
                </span>
                {e.description && (
                  <span className="line-clamp-2 text-[hsl(var(--fg-muted))]">{e.description}</span>
                )}
              </label>
            </li>
          ))}
        </ul>
      </div>

      {progress && (
        <p role="status" className="text-sm text-[hsl(var(--accent))]">
          导入中 {progress.done}/{progress.total}…
        </p>
      )}
      {report && (
        <p role="status" className="text-sm text-emerald-500">
          导入完成：成功 {report.ok} 张{report.failed.length > 0 ? `，失败：${report.failed.join('、')}` : ''}
        </p>
      )}
      {note && <p className="text-sm text-red-400">{note}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void importCards()}
          disabled={busy || selectedCount === 0}
          data-testid="import-cards-btn"
          className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-white disabled:opacity-40"
        >
          {progress ? `导入中 ${progress.done}/${progress.total}…` : `生成 ${selectedCount} 张角色卡`}
        </button>
        {failedEntries.length > 0 && !busy && (
          <button
            type="button"
            onClick={() => void importCards(failedEntries)}
            data-testid="retry-failed-btn"
            className="min-h-[36px] rounded-lg border border-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent))]"
          >
            重试失败项（{failedEntries.length}）
          </button>
        )}
        <button
          type="button"
          onClick={() => void createWorldbook()}
          disabled={busy}
          className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-4 text-sm font-medium text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))] disabled:opacity-40"
        >
          分部与全局设定生成世界书
        </button>
        {report && report.failed.length > 0 && (
          <button
            type="button"
            onClick={() => onFinished(report.ok, report.failed)}
            className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-4 text-sm text-[hsl(var(--fg-muted))] hover:border-[hsl(var(--accent))]"
          >
            跳转资产库查看
          </button>
        )}
      </div>
    </section>
  );
}
