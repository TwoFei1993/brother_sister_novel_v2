/**
 * TtsBar 渲染测试（jsdom + createRoot，无 testing-library 依赖）
 * 覆盖：状态渲染（播放/暂停、章位、声音值）/ 控制回调 / 当前段高亮上报 / visible 显隐
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TtsBar from '../TtsBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
});

async function mountBar(props: Partial<Parameters<typeof TtsBar>[0]> = {}): Promise<HTMLElement> {
  const base: Parameters<typeof TtsBar>[0] = {
    playing: false,
    chapterIndex: 0,
    chapterCount: 2,
    voice: 'xiaoxiao',
    rate: 1,
    onPlayPause: vi.fn(),
    onStop: vi.fn(),
    onPrevChapter: vi.fn(),
    onNextChapter: vi.fn(),
    onRateChange: vi.fn(),
    onVoiceChange: vi.fn(),
    ...props,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<TtsBar {...base} />);
  });
  return container;
}

const q = (c: HTMLElement, id: string): HTMLElement => {
  const el = c.querySelector(`[data-testid="${id}"]`);
  if (!el) throw new Error(`missing [data-testid=${id}]`);
  return el as HTMLElement;
};

describe('TtsBar', () => {
  it('空闲态渲染播放键与章位；播放态切换为暂停', async () => {
    const c = await mountBar({ playing: false, chapterIndex: 1, chapterCount: 3 });
    expect(q(c, 'tts-play').getAttribute('aria-label')).toBe('播放');
    expect(q(c, 'tts-chapter-pos').textContent).toBe('2/3');

    const c2 = await mountBar({ playing: true });
    expect(q(c2, 'tts-play').getAttribute('aria-label')).toBe('暂停');
    // 首章无上一章、尾章无下一章
    expect(q(c2, 'tts-prev').hasAttribute('disabled')).toBe(true);
  });

  it('控制回调：停止/上一章/下一章/语速/声音', async () => {
    const onStop = vi.fn();
    const onPrevChapter = vi.fn();
    const onNextChapter = vi.fn();
    const onRateChange = vi.fn();
    const onVoiceChange = vi.fn();
    const c = await mountBar({
      playing: true,
      chapterIndex: 1,
      chapterCount: 3,
      onStop,
      onPrevChapter,
      onNextChapter,
      onRateChange,
      onVoiceChange,
    });

    await act(async () => {
      q(c, 'tts-stop').click();
      q(c, 'tts-prev').click();
      q(c, 'tts-next').click();
      q(c, 'tts-rate-0.8').click();
    });
    const voiceSel = q(c, 'tts-voice') as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(voiceSel, 'yunjian');
      voiceSel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onPrevChapter).toHaveBeenCalledTimes(1);
    expect(onNextChapter).toHaveBeenCalledTimes(1);
    expect(onRateChange).toHaveBeenCalledWith(0.8);
    expect(onVoiceChange).toHaveBeenCalledWith('yunjian');
  });

  it('当前段推进经 onParagraphChange 上报（含复位 -1）', async () => {
    const onParagraphChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const base: Parameters<typeof TtsBar>[0] = {
      playing: true,
      chapterIndex: 0,
      chapterCount: 2,
      currentIndex: 0,
      voice: 'xiaoxiao',
      rate: 1,
      onPlayPause: vi.fn(),
      onStop: vi.fn(),
      onPrevChapter: vi.fn(),
      onNextChapter: vi.fn(),
      onRateChange: vi.fn(),
      onVoiceChange: vi.fn(),
      onParagraphChange,
    };
    await act(async () => {
      root.render(<TtsBar {...base} />);
    });
    expect(onParagraphChange).toHaveBeenCalledWith(0, 0);

    await act(async () => {
      root.render(<TtsBar {...base} currentIndex={-1} />);
    });
    expect(onParagraphChange).toHaveBeenLastCalledWith(0, -1);
  });

  it('visible=false 不渲染', async () => {
    const c = await mountBar({ visible: false });
    expect(c.querySelector('[data-testid="tts-bar"]')).toBeNull();
  });
});
