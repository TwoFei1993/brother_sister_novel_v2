/**
 * 阅读位置存取（自 Reader 拆出）：章节 + 滚动比例持久化，进入自动续读。
 * localStorage key 带版本号；隐私模式等读写失败静默（位置仅为体验优化）。
 */
const POS_KEY = 'm-reading-pos-v1';

export interface SavedPos {
  chapterMsgId: string;
  ratio: number;
}

export function loadPos(workId: string): SavedPos | null {
  try {
    const map = JSON.parse(localStorage.getItem(POS_KEY) ?? '{}') as Record<string, SavedPos>;
    const p = map[workId];
    return p && typeof p.chapterMsgId === 'string' ? p : null;
  } catch {
    return null;
  }
}

export function savePos(workId: string, pos: SavedPos): void {
  try {
    const map = JSON.parse(localStorage.getItem(POS_KEY) ?? '{}') as Record<string, SavedPos>;
    map[workId] = pos;
    localStorage.setItem(POS_KEY, JSON.stringify(map));
  } catch {
    /* 隐私模式等场景静默 */
  }
}

/** 引用快照截断：前后各留 12 字上下文（提高段落内唯一性，控制存储） */
export function snapshotQuote(text: string, start: number, end: number): string {
  const s = Math.max(0, start - 12);
  const e = Math.min(text.length, end + 12);
  return text.slice(s, e);
}
