/**
 * 听书引擎回归（反馈：换章仍读旧章 / 点播放段落应有暂停）：
 * - 换章后 playerStart（不同 bookId）必须替换引擎里的 paras——旧实现 bookId 不含章节，
 *   换章 playFrom 走 seek，currentBook.paras 永远是开始播放那一章（点新章播旧章内容）
 * - playerPause 保留 idx（可恢复）；playerResume 从暂停段续播
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { playerPause, playerResume, playerStart, playerStop, type PlayerBook } from '../tts-player';

// MiniMax 合成走 fetch blob；Audio 由 jsdom 缺失 → stub 最小播放器（onended 立即触发，循环快速推进）
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

function bookOf(workId: string, chapterMsgId: string, paras: string[]): PlayerBook {
  return { workId, bookId: `${workId}:${chapterMsgId}`, title: '测试书', paras, voiceMap: { narrator: 'mm:n0', 星璃: 'mm:v1' } };
}

interface EngineDebug {
  hasBook: boolean;
  currentParas: readonly string[];
  snapshot: { playing: boolean; idx: number; bookId: string | null };
}

const engine = (): EngineDebug => (window as unknown as { __ttsPlayer: EngineDebug }).__ttsPlayer;

describe('听书引擎（换章/暂停）', () => {
  beforeEach(() => {
    playerStop();
  });

  it('换章 playerStart：bookId 与 paras 都替换为新章（修复点：旧实现 seek 不换 paras）', () => {
    playerStart(bookOf('w1', 'c3', ['第三章 甲', '第三章 乙']), 0);
    expect(engine().hasBook).toBe(true);
    expect(engine().currentParas).toEqual(['第三章 甲', '第三章 乙']);

    // 用户切到另一章再点段落 → useBookPlayer.playFrom → playerStart（bookId 不同）
    playerStart(bookOf('w1', 'c4', ['第四章 甲', '第四章 乙', '第四章 丙']), 1);
    expect(engine().currentParas).toEqual(['第四章 甲', '第四章 乙', '第四章 丙']);
    playerStop();
  });

  it('同章 playerStart（同 bookId）：seek 语义不破坏', () => {
    const c1 = bookOf('w1', 'c1', ['同章 一', '同章 二']);
    playerStart(c1, 0);
    playerStart(c1, 1); // 同 bookId → seek，paras 不变
    expect(engine().currentParas).toEqual(['同章 一', '同章 二']);
    playerStop();
  });

  it('playerPause 保留 idx；playerResume 从当前段续播', () => {
    playerStart(bookOf('w1', 'c1', ['段一', '段二', '段三']), 0);
    expect(engine().snapshot.playing).toBe(true);
    playerPause(); // 同步紧随（runLoop 的 set idx 同步写入）
    expect(engine().snapshot.playing).toBe(false);
    expect(engine().snapshot.idx).toBe(0); // idx 保留（恢复锚点）
    playerResume();
    expect(engine().snapshot.playing).toBe(true);
    playerStop();
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
