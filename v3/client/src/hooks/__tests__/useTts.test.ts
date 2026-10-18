/**
 * TTS 播放引擎测试（移植旧站 useEasyTTS 核心；网络与 Audio 全 mock，不触网）
 *
 * 覆盖：段落顺序连播 + voice/rate 换算 / 预取缓存命中（段落数=请求数）/
 * 多章自动推进 / stop 失效旧回调 / 语速即时切换重播当前段 / 无地址报错 / pause-resume
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { voiceIdToName } from '../../lib/voice-route';
import { useSettingsStore } from '../../stores/settings';
import { useTtsStore } from '../../stores/tts';
import { createTtsEngine, type TtsChapterInput } from '../useTts';

// ---------- mock 基建 ----------

interface FetchCall {
  url: string;
  body: { text?: string; voice?: string; rate?: string };
}

let fetchCalls: FetchCall[] = [];

function mockFetchOk(): void {
  let seq = 0;
  fetchCalls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    seq += 1;
    return {
      ok: true,
      json: async () => ({ success: true, data: { audio: `/media/seg-${seq}.mp3` } }),
    };
  }));
}

/** FakeAudio：记录实例顺序；onended 由测试手动触发驱动队列 */
const fakeAudios: FakeAudio[] = [];

class FakeAudio {
  src: string;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
    fakeAudios.push(this);
  }
  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {}
  removeAttribute(): void {}
}

/** 让微任务队列跑空（引擎是 async 链） */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const chapter = (text: string, voiceMap: Record<string, string> = {}): TtsChapterInput => ({
  text,
  voiceMap,
});

beforeEach(() => {
  vi.stubGlobal('Audio', FakeAudio);
  fakeAudios.length = 0;
  useTtsStore.getState().reset();
  useSettingsStore.setState({ config: { ttsBaseUrl: 'http://tts.test' } });
  mockFetchOk();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- 用例 ----------

describe('TTS 播放引擎（createTtsEngine）', () => {
  it('单章多段顺序连播：请求体 voice/rate 正确，预取使命中缓存（段落数=请求数）', async () => {
    const engine = createTtsEngine();
    engine.startChapters([chapter('哥哥：站住。\n「凭什么。」\n天黑了。', { 哥哥: 'yunjian' })]);
    await flush();

    expect(fakeAudios.length).toBe(1);
    expect(useTtsStore.getState().playing).toBe(true);
    expect(useTtsStore.getState().currentIndex).toBe(0);

    // 第 0 段请求：哥哥前缀 → 云健底层声；rate 换算 +0%
    expect(fetchCalls[0]).toMatchObject({
      url: 'http://tts.test/api/v1/tts/generate',
      body: { voice: voiceIdToName('yunjian'), rate: '+0%' },
    });

    // 第 0 段播完 → 第 1 段；seg1 已被预取填缓存（此时请求至多 seg0+seg1+预取seg2）
    fakeAudios[0].onended?.();
    await flush();
    expect(useTtsStore.getState().currentIndex).toBe(1);
    expect(fetchCalls.length).toBeLessThanOrEqual(3);

    fakeAudios[1].onended?.();
    await flush();
    // 第 2 段为旁白叙述 → 默认声晓晓
    const lastCall = fetchCalls[fetchCalls.length - 1];
    expect(lastCall.body.voice).toBe(voiceIdToName('xiaoxiao'));
    // 强断言：3 段连播完毕总共恰好 3 次请求（预取命中，播放零重复请求）
    expect(fetchCalls).toHaveLength(3);
  });

  it('多章连播自动进下一章，队尾播完复位', async () => {
    const engine = createTtsEngine();
    engine.startChapters([chapter('第一章内容'), chapter('第二章内容')]);
    await flush();
    expect(useTtsStore.getState().chapterIndex).toBe(0);

    fakeAudios[0].onended?.();
    await flush();
    expect(useTtsStore.getState().chapterIndex).toBe(1);
    expect(useTtsStore.getState().currentIndex).toBe(0);

    fakeAudios[1].onended?.();
    await flush();
    expect(useTtsStore.getState().playing).toBe(false);
    expect(useTtsStore.getState().currentIndex).toBe(-1);
  });

  it('stop 后旧音频 ended 回调失效，不再推进', async () => {
    const engine = createTtsEngine();
    engine.startChapters([chapter('甲段\n乙段')]);
    await flush();
    const callsAtStop = fetchCalls.length;

    engine.stop();
    expect(useTtsStore.getState().playing).toBe(false);
    expect(useTtsStore.getState().currentIndex).toBe(-1);

    fakeAudios[0].onended?.();
    await flush();
    expect(useTtsStore.getState().currentIndex).toBe(-1);
    expect(fetchCalls.length).toBe(callsAtStop); // 无新请求
  });

  it('语速即时切换：清缓存并重播当前段（新请求带新 rate）', async () => {
    const engine = createTtsEngine();
    engine.startChapters([chapter('一段\n二段')]);
    await flush();
    expect(useTtsStore.getState().currentIndex).toBe(0);

    useTtsStore.getState().setRate(1.5);
    engine.refreshPlayback(false);
    await flush();

    expect(useTtsStore.getState().currentIndex).toBe(0);
    const lastCall = fetchCalls[fetchCalls.length - 1];
    expect(lastCall.body.rate).toBe('+50%');
  });

  it('未配置 TTS 地址：报错且不发请求', async () => {
    useSettingsStore.setState({ config: {} });
    const engine = createTtsEngine();
    engine.startChapters([chapter('内容')]);
    await flush();

    expect(fetchCalls.length).toBe(0);
    expect(useTtsStore.getState().error).toContain('未配置 TTS');
    expect(useTtsStore.getState().playing).toBe(false);
  });

  it('pause/resume 切换 playing 状态', async () => {
    const engine = createTtsEngine();
    engine.startChapters([chapter('内容')]);
    await flush();

    engine.pause();
    expect(useTtsStore.getState().playing).toBe(false);

    engine.resume();
    expect(useTtsStore.getState().playing).toBe(true);
  });
});
