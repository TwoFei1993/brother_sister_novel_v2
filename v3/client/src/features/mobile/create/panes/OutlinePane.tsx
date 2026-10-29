/**
 * 大纲分区：对话大纲·迭代聊天（P2.3）——聊某章怎么改→确认→生成新版本。
 * 每本书的会话独立（不做通用向导跳转，反馈④）；通用「AI 创作向导」入口在书架/我的页。
 */
import { Map } from 'lucide-react';

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
          先在「正文」分区写第一章，之后就能在这里和助手聊任何一章的修改（助手会先读本书资料再聊）。
        </p>
      </div>
    );
  }
  return <OutlineIterChat work={work} chapters={chapters.map((msg) => ({ msg }))} onDone={onDone} />;
}
