/**
 * 阅读进度 hook（自 Reader 拆出）：续读恢复 + 滚动监听 + 跳章落位置。
 * 章节列表异步到达后一次性恢复上次位置；滚动时节流（500ms）保存「章 id + 比例」。
 */
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { loadPos, savePos } from './reading-pos';

interface PublishedChapterLike {
  msg: { id: string; chapter: { index: number } };
}

export function useReaderProgress(
  id: string | undefined,
  chapters: readonly PublishedChapterLike[],
  articleRef: RefObject<HTMLElement | null>,
) {
  const [chapterIdx, setChapterIdx] = useState(0);
  const [resumeTip, setResumeTip] = useState<string | null>(null);
  /** 首次进入（无续读记录）显示操作引导 */
  const [hintOpen, setHintOpen] = useState(false);
  const [scrollPct, setScrollPct] = useState(0);
  const resumeDoneRef = useRef(false);

  // —— 续读：章节加载后恢复上次位置（一次性） ——
  useEffect(() => {
    if (resumeDoneRef.current || chapters.length === 0 || !id) return;
    resumeDoneRef.current = true;
    const saved = loadPos(id);
    const idx = saved ? chapters.findIndex((c) => c.msg.id === saved.chapterMsgId) : -1;
    if (idx < 0) {
      setHintOpen(true);
      setTimeout(() => setHintOpen(false), 4000);
    }
    if (idx >= 0) {
      setChapterIdx(idx);
      setResumeTip(`已续读至 第${chapters[idx]!.msg.chapter.index}章`);
      setTimeout(() => setResumeTip(null), 2600);
      requestAnimationFrame(() => {
        const main = articleRef.current?.closest('main');
        const ratio = Math.min(0.95, Math.max(0, saved!.ratio));
        if (main) main.scrollTop = main.scrollHeight * ratio;
      });
    }
  }, [chapters, id, articleRef]);

  // —— 滚动监听：章内百分比 + 节流保存位置 ——
  useEffect(() => {
    const main = articleRef.current?.closest('main');
    if (!main) return;
    let last = 0;
    const onScroll = (): void => {
      const max = main.scrollHeight - main.clientHeight;
      const ratio = max > 0 ? main.scrollTop / max : 0;
      setScrollPct(Math.round(ratio * 100));
      const now = Date.now();
      if (now - last < 500) return;
      last = now;
      const cur = chapters[chapterIdx];
      if (cur && id) savePos(id, { chapterMsgId: cur.msg.id, ratio });
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, [chapters, chapterIdx, id, articleRef]);

  function jumpTo(idx: number): void {
    const n = chapters.length;
    if (n === 0) return;
    const next = Math.max(0, Math.min(n - 1, idx));
    setChapterIdx(next);
    requestAnimationFrame(() => articleRef.current?.scrollIntoView({ block: 'start' }));
    const cur = chapters[next];
    if (cur && id) savePos(id, { chapterMsgId: cur.msg.id, ratio: 0 });
  }

  return { chapterIdx, jumpTo, scrollPct, resumeTip, hintOpen };
}
