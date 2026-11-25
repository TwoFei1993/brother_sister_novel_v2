/**
 * 音色试听单测（用户需求 2026-11-26：选声前先听一句）。
 * synthParaUrl 模块级 mock（不拉听书引擎的 store/播放器副作用）；Audio 用假类记录实例。
 * 覆盖：合成入参 / 同一时刻只播一个 / 再点正在播的即停止 / 合成失败与播放被拦截的状态复位。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { synthParaUrl } from '../tts-player';
import { getVoicePreview, previewVoice, stopVoicePreview } from '../voice-preview';

vi.mock('../tts-player', () => ({ synthParaUrl: vi.fn() }));

const synthMock = vi.mocked(synthParaUrl);

class FakeAudio {
  static instances: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  played = 0;
  paused = 0;
  constructor(
    public src: string,
    private playResult: Promise<void> = Promise.resolve(),
  ) {
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    this.played += 1;
    return this.playResult;
  }
  pause(): void {
    this.paused += 1;
  }
}

beforeEach(() => {
  FakeAudio.instances = [];
  synthMock.mockReset();
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('URL', { revokeObjectURL: vi.fn() }); // node 测试环境没有 blob URL API
  stopVoicePreview(); // 清掉上一用例残留的试听（须在 stub 之后：停止时会 revoke blob URL）
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('音色试听', () => {
  it('合成一句示例（speed=1）并播放', async () => {
    synthMock.mockResolvedValue('blob:voice-1');
    await previewVoice('mm:presenter_female');
    expect(synthMock).toHaveBeenCalledWith(expect.stringContaining('声音'), 'mm:presenter_female', 1);
    const el = FakeAudio.instances[0]!;
    expect(el.src).toBe('blob:voice-1');
    expect(el.played).toBe(1);
    expect(getVoicePreview()).toEqual({ status: 'playing', id: 'mm:presenter_female' });
  });

  it('同一时刻只播一个：换音色时前一个被暂停；再点正在播的即停止', async () => {
    synthMock.mockResolvedValueOnce('blob:a').mockResolvedValueOnce('blob:b');
    await previewVoice('xiaoxiao');
    await previewVoice('mm:presenter_male');
    expect(FakeAudio.instances[0]!.paused).toBe(1);
    expect(FakeAudio.instances[1]!.played).toBe(1);
    expect(getVoicePreview()).toEqual({ status: 'playing', id: 'mm:presenter_male' });
    await previewVoice('mm:presenter_male');
    expect(FakeAudio.instances[1]!.paused).toBe(1);
    expect(getVoicePreview()).toEqual({ status: 'idle' });
  });

  it('合成失败：抛人话错误，状态复位', async () => {
    synthMock.mockRejectedValue(new Error('TTS 502'));
    await expect(previewVoice('mm:presenter_female')).rejects.toThrow('语音服务暂时不可用');
    expect(getVoicePreview()).toEqual({ status: 'idle' });
  });

  it('播放被浏览器拦截：抛错且状态复位', async () => {
    synthMock.mockResolvedValue('blob:c');
    vi.stubGlobal('Audio', class extends FakeAudio {
      constructor(src: string) {
        super(src, Promise.reject(new Error('NotAllowedError')));
      }
    });
    await expect(previewVoice('xiaoxiao')).rejects.toThrow('浏览器拦截了播放');
    expect(getVoicePreview()).toEqual({ status: 'idle' });
  });
});
