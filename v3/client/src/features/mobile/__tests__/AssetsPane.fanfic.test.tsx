/**
 * 手机资料页的同人原著区测试（用户需求 2026-11-27：说到哈利波特等原著要能搜设定并查看）：
 * fanfic 题材书在资料页显示同人信息区（原著名 + 联网搜索录入世界书按钮）；
 * 非同人书不显示。与桌面共用同一 FanficSection 组件。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Work } from '@shared/work';

import { AssetsPane } from '../create/panes/AssetsPane';

vi.mock('../../api/client', () => ({ apiFetch: vi.fn(async () => ({})) }));

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

/** 最小 Work 夹具：仅本测试用到的字段（渲染级断言，不触网） */
function makeWork(overrides: Record<string, unknown> = {}): Work {
  return {
    id: 'w-test',
    revision: 1,
    title: '测试书',
    mode: 'novel',
    genre: 'fanfic',
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: {
      fandomSource: '哈利·波特',
      storyTones: [],
      chapterOutlines: [],
    },
    voiceMap: {},
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as Work;
}

describe('手机资料页同人原著区', () => {
  it('fanfic 书显示同人信息区：原著名输入 + 联网搜索按钮（与桌面共用 FanficSection）', () => {
    act(() => root.render(<AssetsPane work={makeWork()} nextIndex={1} onUpdated={() => undefined} />));
    expect(host.querySelector('[data-testid="fanfic-section"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="fanfic-source"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="fanfic-import"]')).not.toBeNull();
  });

  it('原著名称已填会预填进输入框（可直接点导入）', () => {
    act(() => root.render(<AssetsPane work={makeWork()} nextIndex={1} onUpdated={() => undefined} />));
    const input = host.querySelector<HTMLInputElement>('[data-testid="fanfic-source"]')!;
    expect(input.value).toBe('哈利·波特');
    expect(host.querySelector<HTMLButtonElement>('[data-testid="fanfic-import"]')!.disabled).toBe(false);
  });

  it('非 fanfic 书不显示同人区', () => {
    act(() => root.render(<AssetsPane work={makeWork({ genre: 'xianxia' })} nextIndex={1} onUpdated={() => undefined} />));
    expect(host.querySelector('[data-testid="fanfic-section"]')).toBeNull();
  });
});
