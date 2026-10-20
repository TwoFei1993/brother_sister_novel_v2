/**
 * WorkViewRouter 测试（jsdom + createRoot，模式同 ReadingView.test）
 * 覆盖：听书条三视图常驻（有章节时 A/B/C 均渲染、无章节不渲染）/
 *       长上下文质量警示（≥6 章出现、可关闭、<6 章不出现）。
 * useTts mock 掉引擎；useWorkbenchData / loadRegexScripts / api 层 mock 不触网。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@shared/message';
import { defaultNovelSettings, type Work } from '@shared/work';

import { useWorkStore } from '../../../stores/work';

vi.mock('../../../hooks/useTts', () => ({
  useTts: () => ({
    engine: {
      stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), startChapters: vi.fn(),
      prevChapter: vi.fn(), nextChapter: vi.fn(), refreshPlayback: vi.fn(),
    },
    playing: false,
    loading: false,
    chapterIndex: 0,
    currentIndex: -1,
    chapterCount: 0,
    voice: 'narrator-female-1',
    rate: 1,
    error: null,
  }),
  TtsChapterInput: {},
}));

vi.mock('../../../hooks/useWorkbenchData', () => ({
  useWorkbenchData: () => ({
    entryIndex: [], // 世界书条目索引（ActivatedList 的 entries 数组）
    quickDirectives: [],
    addQuickDirective: vi.fn(),
    removeQuickDirective: vi.fn(),
  }),
}));

vi.mock('../../../hooks/generation-pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks/generation-pipeline')>();
  return { ...actual, loadRegexScripts: vi.fn(async () => []) };
});

vi.mock('../../../api/works', () => ({ patchMessage: vi.fn(async () => undefined) }));
vi.mock('../../../lib/export', () => ({ exportTxt: vi.fn(async () => undefined) }));

import WorkViewRouter from '../WorkViewRouter';
import type { UseGenerateResult } from '../../../hooks/useGenerate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function chapterMsg(index: number): Message {
  const content = `第${index}章正文，情节推进与场景描写兼备的一段足够长的文字。`;
  return {
    id: `c${index}`,
    role: 'assistant',
    name: '小说家',
    content,
    createdAt: Date.now(),
    swipes: [content],
    swipeId: 0,
    chapter: { index, title: `第${index}章 标题` },
    directive: `第${index}章指令`,
    extra: {},
  };
}

function workFixture(): Work {
  return {
    id: 'w1',
    revision: 1,
    title: '路由测试',
    mode: 'novel',
    genre: 'hunhe',
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function genStub(): UseGenerateResult {
  return {
    streaming: false,
    buffer: '',
    error: null,
    partialKept: false,
    targetMessageId: null,
    generateChapter: vi.fn(),
    continueFromPartial: vi.fn(),
    swipeRegenerate: vi.fn(),
    runBatch: vi.fn(),
    runByOutline: vi.fn(),
    batch: null,
    stop: vi.fn(),
    clearError: vi.fn(),
    lastTruncated: false,
    clearTruncated: vi.fn(),
  };
}

const roots: Root[] = [];

async function renderRouter(chapterCount: number, view: 'a' | 'b' | 'c' = 'b'): Promise<HTMLElement> {
  useWorkStore.setState({
    messages: Array.from({ length: chapterCount }, (_, i) => chapterMsg(i + 1)),
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <WorkViewRouter
        work={workFixture()}
        currentView={view}
        gen={genStub()}
        hasMore={false}
        loadingOlder={false}
        loadOlder={() => undefined}
      />,
    );
  });
  return container;
}

beforeEach(() => {
  useWorkStore.setState({ messages: [] });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 1000 });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true, value: 0, writable: true });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 500 });
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  useWorkStore.setState({ messages: [] });
});

describe('WorkViewRouter 听书条三视图常驻', () => {
  it.each([
    ['a'], ['b'], ['c'],
  ] as ('a' | 'b' | 'c')[][])(('%s 视图：有章节时听书条渲染') as string, async (view) => {
    const c = await renderRouter(7, view);
    expect(c.querySelector('[data-testid="tts-bar"]')).not.toBeNull();
  });

  it('无章节时不渲染听书条', async () => {
    const c = await renderRouter(0, 'b');
    expect(c.querySelector('[data-testid="tts-bar"]')).toBeNull();
  });
});

describe('WorkViewRouter 长上下文质量警示', () => {
  it('≥6 章出现警示条，文案含章数，可手动关闭', async () => {
    const c = await renderRouter(7, 'b');
    const warn = c.querySelector('[data-testid="drift-warning"]');
    expect(warn).not.toBeNull();
    expect(warn?.textContent).toContain('7 章');

    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="drift-warning-close"]')!.click();
    });
    expect(c.querySelector('[data-testid="drift-warning"]')).toBeNull();
  });

  it('<6 章不出现警示条', async () => {
    const c = await renderRouter(5, 'b');
    expect(c.querySelector('[data-testid="drift-warning"]')).toBeNull();
  });
});
