import { describe, expect, it } from 'vitest';

import { pickFramePath } from '../framePick';
import type { DuanjuShot } from '@shared/duanju';

const frame = (index: number, path: string): DuanjuShot['frames'][number] => ({
  index,
  image: { id: `f${index}`, path, prompt: '', createdAt: 0 },
  rolls: 0,
});

const shot = (frames: DuanjuShot['frames']): Pick<DuanjuShot, 'frames'> => ({ frames });

describe('pickFramePath（帧不全时的下标错位回归）', () => {
  it('四帧全齐：帧号-1 正确命中', () => {
    const s = shot([frame(1, 'F1.png'), frame(2, 'F2.png'), frame(3, 'F3.png'), frame(4, 'F4.png')]);
    expect(pickFramePath(s, 0)).toBe('F1.png');
    expect(pickFramePath(s, 2)).toBe('F3.png');
  });

  it('F1/F3/F4 有图时挑 F3：按帧号查命中 F3（旧下标取法会错拿到 F4）', () => {
    const s = shot([frame(1, 'F1.png'), frame(3, 'F3.png'), frame(4, 'F4.png')]);
    expect(pickFramePath(s, 2)).toBe('F3.png');
  });

  it('F2/F4 有图时挑 F4：命中 F4（旧下标取法越界兜底成 F2）', () => {
    const s = shot([frame(2, 'F2.png'), frame(4, 'F4.png')]);
    expect(pickFramePath(s, 3)).toBe('F4.png');
  });

  it('目标帧无图：返回 undefined（调用方兜底最早帧）', () => {
    const s = shot([frame(1, 'F1.png')]);
    expect(pickFramePath(s, 3)).toBeUndefined();
  });

  it('空帧数组与乱序数组', () => {
    expect(pickFramePath(shot([]), 0)).toBeUndefined();
    const shuffled = shot([frame(3, 'F3.png'), frame(1, 'F1.png')]);
    expect(pickFramePath(shuffled, 2)).toBe('F3.png');
  });
});
