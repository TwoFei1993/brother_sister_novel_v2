import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { TypewriterPacer } from '../reading/typewriter';

describe('TypewriterPacer（打字机匀速器）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('逐字吐出 push 的内容，拼接结果与输入一致', () => {
    const emitted: string[] = [];
    const pacer = new TypewriterPacer((t) => emitted.push(t), 24, 2, 10, 30);

    pacer.push('第一段文字。');
    pacer.push('第二段文字。');
    vi.advanceTimersByTime(24 * 50);

    expect(emitted.join('')).toBe('第一段文字。第二段文字。');
    pacer.stop();
  });

  it('不会一次吐完大块内容（打字机效果，单 tick 封顶）', () => {
    const emitted: string[] = [];
    const pacer = new TypewriterPacer((t) => emitted.push(t), 24, 2, 10, 30);

    pacer.push('一'.repeat(1000));
    // 第一个 tick 只吐 min(30, max(2, 100)) = 30 个字
    vi.advanceTimersByTime(24);
    expect(emitted.join('').length).toBe(30);

    pacer.flushSync();
  });

  it('drained() 在缓冲区吐完后 resolve', async () => {
    const pacer = new TypewriterPacer(() => {}, 24, 2, 10, 30);
    pacer.push('一二三四五六七八九十');

    let resolved = false;
    const promise = pacer.drained().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(24 * 20);
    await promise;
    expect(resolved).toBe(true);
    pacer.stop();
  });

  it('空缓冲区时 drained() 立即 resolve', async () => {
    const pacer = new TypewriterPacer(() => {});
    pacer.stop();
    await pacer.drained();
  });

  it('flushSync() 立即吐完剩余内容且不丢字', () => {
    const emitted: string[] = [];
    const pacer = new TypewriterPacer((t) => emitted.push(t), 24, 2, 10, 30);

    pacer.push('完整'.repeat(200));
    vi.advanceTimersByTime(24 * 3); // 只吐了一部分
    const before = emitted.join('').length;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(400);

    pacer.flushSync();
    expect(emitted.join('')).toBe('完整'.repeat(200));

    // flush 之后 push 不再生效
    pacer.push('不应出现');
    vi.advanceTimersByTime(24 * 10);
    expect(emitted.join('')).toBe('完整'.repeat(200));
  });

  it('stop() 后 resolve 未决的 drained() 且后续 push 丢弃', async () => {
    const emitted: string[] = [];
    const pacer = new TypewriterPacer((t) => emitted.push(t), 24, 2, 10, 30);
    pacer.push('还没吐完的文字');

    let resolved = false;
    void pacer.drained().then(() => {
      resolved = true;
    });
    pacer.stop();

    await Promise.resolve();
    expect(resolved).toBe(true);

    pacer.push('停止后的内容');
    vi.advanceTimersByTime(24 * 10);
    expect(emitted.join('')).not.toContain('停止后的内容');
  });

  it('intervalMs=0 时 push 直通 emit（测试/降级路径）', () => {
    const emitted: string[] = [];
    const pacer = new TypewriterPacer((t) => emitted.push(t), 0);

    pacer.push('直通');
    pacer.push('内容');

    expect(emitted.join('')).toBe('直通内容');
    pacer.stop();
  });
});
