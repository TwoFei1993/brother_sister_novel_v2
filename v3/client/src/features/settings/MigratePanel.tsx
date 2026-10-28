/**
 * 旧站数据迁移面板（Task 31）：novel_history JSON 文件 → POST /api/migrate/novel-history
 *
 * 流程：引导导出（旧站控制台命令）→ 选文件解析（接受裸数组或 {projects} 包装）
 * → 预览（作品/章节计数，跳过无效项）→ 确认迁移 → 结果展示（成功列表含作品名/章数）。
 * 服务端逐作品落盘为 Work + messages.jsonl，成功后书架立即可见。
 */
import { useRef, useState } from 'react';
import { Check } from 'lucide-react';

import { ApiError, apiFetch } from '../../api/client';

/** 预览行：从旧数据提取的最小展示信息 + 原始对象（确认迁移时原样提交） */
interface PreviewItem {
  title: string;
  chapterCount: number;
  raw: Record<string, unknown>;
}

interface MigrateResultDto {
  migrated: number;
  workIds: string[];
}

const inputCls =
  'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2.5 text-base outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]';

/** 从解析后的未知 JSON 提取作品数组：接受裸数组或 {projects: [...]} 包装 */
function extractProjects(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === 'object') {
    const projects = (data as { projects?: unknown }).projects;
    if (Array.isArray(projects)) return projects;
  }
  return [];
}

/** 单作品 → 预览行；无效（非对象/无 title）返回 null，调用方跳过并计数 */
function toPreview(raw: unknown, index: number): PreviewItem | null {
  if (raw === null || typeof raw !== 'object') return null;
  const title = (raw as { title?: unknown }).title;
  if (typeof title !== 'string' || title === '') return null;
  const chapters = (raw as { chapters?: unknown }).chapters;
  return {
    title,
    chapterCount: Array.isArray(chapters) ? chapters.length : 0,
    raw: raw as Record<string, unknown>,
  };
}

export default function MigratePanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<PreviewItem[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [result, setResult] = useState<MigrateResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    setPreviews(null);
    setSkipped(0);
    try {
      const projects = extractProjects(JSON.parse(await file.text()));
      if (projects.length === 0) {
        setError('文件里没有找到作品数据：请确认是旧站导出的 novel_history JSON');
        return;
      }
      const rows = projects.map(toPreview);
      const valid = rows.filter((r): r is PreviewItem => r !== null);
      setSkipped(rows.length - valid.length);
      setPreviews(valid);
    } catch {
      setError('文件解析失败：不是合法的 JSON 文件');
    } finally {
      if (fileRef.current) fileRef.current.value = ''; // 允许重选同一文件
    }
  }

  async function handleMigrate(): Promise<void> {
    if (migrating || !previews) return;
    setMigrating(true);
    setError(null);
    try {
      const body = previews.map((p) => p.raw);
      setResult(await apiFetch<MigrateResultDto>('/api/migrate/novel-history', {
        method: 'POST',
        body: JSON.stringify(body),
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '迁移失败，请稍后重试');
    } finally {
      setMigrating(false);
    }
  }

  return (
    <section aria-label="旧站数据迁移" className="rounded-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-5">
      <h3 className="mb-1 text-base font-semibold">旧站数据迁移</h3>
      <p className="mb-3 text-xs text-[hsl(var(--fg-muted))]">
        把旧版网页（localStorage）里的作品迁到当前站：章节正文、多版本、世界观与小说设定一并保留。
      </p>

      {/* 第一步：导出引导 */}
      <div className="mb-4 rounded-lg bg-[hsl(var(--bg))] p-3 text-xs leading-relaxed text-[hsl(var(--fg-muted))]">
        <p className="mb-1 font-medium text-[hsl(var(--fg))]">第一步 · 在旧站导出数据</p>
        <p>
          打开旧站页面，按 F12 打开浏览器控制台，粘贴执行下面的命令并回车，把输出的 JSON
          全选复制，存为 .json 文件：
        </p>
        <code className="mt-2 block overflow-x-auto rounded bg-[hsl(var(--surface))] p-2 text-[11px] text-[hsl(var(--accent))]">
          {`JSON.stringify({projects: JSON.parse(localStorage.getItem('novel_history'))})`}
        </code>
      </div>

      {/* 第二步：上传预览 */}
      <p className="mb-1 text-sm font-medium">第二步 · 上传导出的 JSON 文件</p>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        aria-label="选择旧站导出的 JSON 文件"
        onChange={(e) => void handleFileChange(e)}
        className={`${inputCls} file:mr-3 file:rounded-md file:border-0 file:bg-[hsl(var(--accent))]/15 file:px-3 file:py-1.5 file:text-sm file:text-[hsl(var(--accent))]`}
      />

      {error && (
        <p role="alert" className="mt-3 text-sm text-[hsl(var(--danger))]">
          {error}
        </p>
      )}

      {previews && (
        <div className="mt-4">
          <p className="mb-2 text-sm">
            检测到 <span className="font-semibold text-[hsl(var(--accent))]">{previews.length}</span>{' '}
            部作品、共{' '}
            <span className="font-semibold text-[hsl(var(--accent))]">
              {previews.reduce((sum, p) => sum + p.chapterCount, 0)}
            </span>{' '}
            章{skipped > 0 && `（另跳过 ${skipped} 项无效数据）`}：
          </p>
          <ul className="mb-4 max-h-56 overflow-y-auto rounded-lg bg-[hsl(var(--bg))] p-2 text-sm">
            {previews.map((p) => (
              <li key={p.title} className="flex justify-between gap-3 px-1 py-1">
                <span className="truncate">{p.title}</span>
                <span className="shrink-0 text-[hsl(var(--fg-muted))]">{p.chapterCount} 章</span>
              </li>
            ))}
          </ul>
          {!result && (
            <button
              type="button"
              disabled={migrating}
              onClick={() => void handleMigrate()}
              className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent-fg))] transition-opacity disabled:opacity-40"
            >
              {migrating ? '迁移中…' : '确认迁移'}
            </button>
          )}
        </div>
      )}

      {/* 第三步：结果（成功列表复用预览数据展示作品名/章数） */}
      {result && previews && (
        <div role="status" className="mt-4">
          <p className="mb-2 text-sm text-emerald-400">
            迁移完成：{result.migrated} 部作品已入库，去书架即可阅读。
          </p>
          <ul className="max-h-56 overflow-y-auto rounded-lg bg-[hsl(var(--bg))] p-2 text-sm">
            {previews.map((p) => (
              <li key={p.title} className="flex justify-between gap-3 px-1 py-1">
                <span className="flex min-w-0 items-center gap-1 text-emerald-400"><Check className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{p.title}</span></span>
                <span className="shrink-0 text-[hsl(var(--fg-muted))]">{p.chapterCount} 章</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
