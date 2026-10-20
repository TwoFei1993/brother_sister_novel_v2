/**
 * 章节大纲导入（Word 导入实测反馈）：粘贴/导入文本解析出 ≥3 章「第N章」结构时，
 * 展示章数预览与「创建作品并导入大纲」入口——输入书名 → POST /api/works
 * （settings 携带 chapterOutlines + pastedOutline=原文）→ 跳 /work/:id 直接开写。
 * 生成侧联动见 lib/outline/chapters.chapterOutlineDirective（每章 directive 追加本章要点）。
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { createWork } from '../../../api/works';
import { parseChapterOutlines, toChapterOutlineItems } from '../../../lib/outline/chapters';
import { defaultNovelSettings } from '@shared/work';

interface Props {
  /** 粘贴框原文（导入大纲的同时作为 pastedOutline 存入作品设定） */
  outline: string;
  /** 书名建议首条（无则空输入） */
  suggestedTitle?: string;
}

/** 最少章数门槛：低于此值不展示导入入口（避免零星「第N章」提及误触发） */
const MIN_CHAPTERS = 3;

export default function ChapterOutlineImport({ outline, suggestedTitle = '' }: Props) {
  const navigate = useNavigate();
  const chapters = useMemo(() => parseChapterOutlines(outline), [outline]);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(suggestedTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (chapters.length < MIN_CHAPTERS) return null;

  const create = async (): Promise<void> => {
    const name = title.trim();
    if (!name) {
      setError('请输入书名');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const work = await createWork({
        title: name,
        mode: 'novel',
        genre: 'chuanyue',
        settings: {
          ...defaultNovelSettings,
          pastedOutline: outline,
          chapterOutlines: toChapterOutlineItems(chapters),
        },
      });
      navigate(`/work/${work.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建作品失败，请重试');
      setBusy(false);
    }
  };

  return (
    <section aria-label="章节大纲导入" data-testid="chapter-outline-import" className="mb-4 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3">
      <p className="text-sm font-medium">识别到 {chapters.length} 章大纲</p>
      <ul className="mt-1 flex flex-col gap-0.5 text-xs text-[hsl(var(--fg-muted))]">
        {chapters.slice(0, 4).map((c) => (
          <li key={c.index}>
            第{c.index}章 {c.title}
          </li>
        ))}
        {chapters.length > 4 && <li>…等共 {chapters.length} 章</li>}
      </ul>
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          data-testid="outline-import-expand"
          className="mt-2 min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-4 text-sm font-medium transition-colors hover:border-[hsl(var(--accent))]"
        >
          创建作品并导入大纲
        </button>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <input
            aria-label="书名"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入书名"
            className="w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-2 text-sm outline-none focus:border-[hsl(var(--accent))]"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            data-testid="outline-import-create"
            className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? '创建中…' : '确认创建'}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
