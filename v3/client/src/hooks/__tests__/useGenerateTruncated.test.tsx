/**
 * useGenerate 上下文截断提示测试（mock run 内核与管线层，与 useGenerate.test 的
 * fetch-stub 手法隔离——模块 mock 是文件级的，不能混入集成测试文件）
 * 覆盖：生成完成入库后 lastTruncated 记录组装期的 truncated；clearTruncated 复位
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Work } from '@shared/work';
import { defaultNovelSettings } from '@shared/work';

import { useGenerate, type UseGenerateResult } from '../useGenerate';

vi.mock('../generation-runtime', () => ({
  runGenerationStream: vi.fn(async (opts: { prepare: (ctx: { prefs: never; startedAt: number }) => Promise<{ finalize: () => Promise<unknown> }> }) => {
    const { finalize } = await opts.prepare({ prefs: [] as never, startedAt: Date.now() });
    return finalize();
  }),
}));

vi.mock('../generation-pipeline', () => ({
  loadAssembleAssets: vi.fn(async () => ({ preset: null, cards: [], worldbooks: [], regexScripts: [] })),
  buildMacroEnv: vi.fn(() => ({
    user: '作者',
    char: '小说家',
    getVar: () => undefined,
    setVar: () => undefined,
    scope: 'work' as const,
  })),
  scanAndAssemble: vi.fn(async () => ({ messages: [], promptTokens: 1200, truncated: true, activatedIds: [] })),
  finalizeGeneration: vi.fn(async () => ({ id: 'm1' })),
}));

vi.mock('../../api/llm', () => ({
  buildGenerateBody: vi.fn(() => ({})),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
let latest: UseGenerateResult | null = null;

function Probe(): null {
  latest = useGenerate();
  return null;
}

const workFixture: Work = {
  id: 'w1',
  revision: 1,
  title: '测试',
  mode: 'novel',
  genre: 'hunhe',
  characterIds: [],
  worldbookIds: [],
  presetId: '',
  regexScriptIds: [],
  settings: defaultNovelSettings,
  voiceMap: {},
  createdAt: 1,
  updatedAt: 1,
};

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  latest = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('useGenerate 上下文截断提示（usage.truncated 消费）', () => {
  it('生成完成入库后 lastTruncated=true，clearTruncated 复位', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(<Probe />);
    });
    expect(latest!.lastTruncated).toBe(false);

    let msg: unknown = null;
    await act(async () => {
      msg = await latest!.generateChapter(workFixture, [], '指令');
    });
    expect(msg).toEqual({ id: 'm1' }); // finalize 成功入库
    expect(latest!.lastTruncated).toBe(true); // 组装期截断被记录

    await act(async () => {
      latest!.clearTruncated();
    });
    expect(latest!.lastTruncated).toBe(false);
  });
});
