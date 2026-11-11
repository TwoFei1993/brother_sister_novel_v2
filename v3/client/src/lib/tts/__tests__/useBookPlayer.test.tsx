/**
 * useBookPlayer 交互语义回归（反馈：点正在播放的段落应有暂停）：
 * - 播放中点同段 → pause（旧实现 playerSeek 重启该段：1-3s 合成静默，感知像「停止」）
 * - 暂停中点同段 → seek 恢复；点其他段 → 跳段
 * - 换章（bookId 不同）→ start 换 paras，旧章视图回空闲
 *
 * 挂载方式对齐项目既有 hook 测试（createRoot + IS_REACT_ACT_ENVIRONMENT，@testing-library 与本项目 React 19 配置不兼容）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { playerStop, useBookPlayer, type PlayerBook, type UseBookPlayerView } from '../tts-player';

class FakeAudio {
  onended: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {
    this.onended?.();
  });
  pause = vi.fn();
}

vi.stubGlobal('Audio', FakeAudio);
vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:fake', revokeObjectURL: () => undefined });
vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['x']), { status: 200 })));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bookOf = (chapterMsgId: string): PlayerBook => ({
  workId: 'w1',
  bookId: `w1:${chapterMsgId}`,
  title: '书',
  paras: ['一', '二', '三'],
  voiceMap: {},
});

const roots: Root[] = [];
let view: UseBookPlayerView | null = null;

function Probe({ book }: { book: PlayerBook }) {
  view = useBookPlayer(book);
  return null;
}

async function renderPlayer(book: PlayerBook): Promise<void> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<Probe book={book} />);
  });
}

describe('useBookPlayer 点段交互', () => {
  beforeEach(() => {
    playerStop();
    view = null;
  });

  it('播放中点同段 → pause（而非重启该段）', async () => {
    await renderPlayer(bookOf('c1'));
    act(() => view!.playFrom(2)); // 从第 3 段启动
    expect(view!.playing).toBe(true);
    expect(view!.playingIdx).toBe(2);
    act(() => view!.playFrom(2)); // 再点同一段
    expect(view!.playing).toBe(false);
    expect(view!.paused).toBe(true);
    expect(view!.playingIdx).toBe(2); // 锚点保留
    playerStop();
  });

  it('暂停中点其他段 → 跳段播放', async () => {
    await renderPlayer(bookOf('c1'));
    act(() => view!.playFrom(0));
    act(() => view!.playFrom(0)); // 同段 → 暂停
    expect(view!.paused).toBe(true);
    act(() => view!.playFrom(1)); // 点其他段 → 跳段
    expect(view!.playing).toBe(true);
    expect(view!.playingIdx).toBe(1);
    playerStop();
  });

  it('换章（bookId 不同）→ start 换 paras，旧章视图回空闲', async () => {
    await renderPlayer(bookOf('c1'));
    act(() => view!.playFrom(0));
    expect(view!.playing).toBe(true);
    await renderPlayer(bookOf('c2')); // 同作品不同章（Reader 换章后的新 book 视图）
    act(() => view!.playFrom(1));
    expect(view!.playing).toBe(true);
    expect(view!.playingIdx).toBe(1);
    playerStop();
  });
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  vi.clearAllMocks();
});
