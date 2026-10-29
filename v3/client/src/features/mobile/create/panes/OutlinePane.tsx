/**
 * 大纲分区：对话大纲·迭代聊天（P2.3）——聊某章怎么改→确认→生成新版本；建书向导在 AI 创作向导（/planner）。
 */
import { Map } from 'lucide-react';
import { Link } from 'react-router-dom';

import OutlineIterChat from '../OutlineIterChat';
import type { ChapterMsg } from './types';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

export function OutlinePane({
  work,
  chapters,
  onDone,
}: {
  work: Work;
  chapters: readonly ChapterMsg[];
  onDone: (msg: Message) => void;
}) {
  if (chapters.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <Map className="mx-auto h-10 w-10 text-[hsl(var(--fg-muted))]" strokeWidth={1.5} aria-hidden />
        <p className="mt-3 text-sm font-medium">对话大纲</p>
        <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[hsl(var(--fg-muted))]">
          先在「正文」分区写第一章，之后就能在这里和助手聊任何一章的修改。
        </p>
        <Link
          to="/planner"
          className="mt-4 inline-flex h-10 items-center rounded-xl border border-[hsl(var(--border-soft))] px-5 text-sm"
        >
          AI 创作向导 ↗
        </Link>
      </div>
    );
  }
  return <OutlineIterChat work={work} chapters={chapters.map((msg) => ({ msg }))} onDone={onDone} />;
}
