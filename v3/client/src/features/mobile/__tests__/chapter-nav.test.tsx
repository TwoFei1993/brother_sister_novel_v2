/**
 * 章节导航域 + 残章提示 + 角色小传弹层测试（jsdom + createRoot，无 testing-library）
 *
 * - ChapterChips：渲染/高亮/点选回调
 * - ChapterDrawer：开合渲染、章号+字数、点选回调并关闭、遮罩关闭
 * - TextPane：截断启发式检出未写完的当前章 → 「⚠️ 未写完 + 接着写」提示条可见可点
 * - BindingsPane：绑定角色旁 📝 → 小传弹层回显 bio → 保存 PATCH 带 bio
 * 全部网络依赖模块级 mock，不触网。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../../api/client';
import { buildChapterMessage } from '../../../hooks/generation-flow';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

import { ChapterChips, ChapterDrawer } from '../create/panes/ChapterNav';
import { TextPane } from '../create/panes/TextPane';
import type { ChapterMsg, Gen } from '../create/panes/types';
import BindingsPane from '../create/BindingsPane';

vi.mock('../../../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../create/voice/MobileTtsBar', () => ({ default: () => <div data-testid="tts-bar-stub" /> }));
vi.mock('../../../stores/work', () => ({
  useWorkStore: { getState: () => ({ messages: [] as Message[], upsertLocal: vi.fn() }) },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLElement[] = [];

async function mount(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(element);
  });
  return container;
}

afterEach(async () => {
  await act(async () => {
    for (const r of roots) r.unmount();
  });
  for (const c of containers) c.remove();
  roots.length = 0;
  containers.length = 0;
  vi.restoreAllMocks();
  vi.mocked(apiFetch).mockReset();
});

const ch = (index: number, title: string, content: string): ChapterMsg => {
  const m = buildChapterMessage({ content, title, chapterIndex: index, promptTokens: 0, generationMs: 0 });
  return { ...m, id: `ch-${index}`, chapter: { index, title } };
};

const CHS = [ch(1, '雨夜', '雨夜的码头一片死寂。'), ch(2, '追兵', '追兵踏碎了泥泞。'), ch(3, '渡江', '船老大收了钱，一言不发。')] as ChapterMsg[];

describe('ChapterChips', () => {
  it('渲染全部章节 chip 且当前章高亮、点选回调带正确 id', async () => {
    const onPick = vi.fn();
    const c = await mount(<ChapterChips chapters={CHS} currentId="ch-2" onPick={onPick} />);
    const chips = c.querySelectorAll('[data-testid="chapter-chips"] button');
    expect(chips.length).toBe(3);
    expect(chips[1].className).toContain('accent');
    await act(async () => {
      chips[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPick).toHaveBeenCalledWith('ch-3');
  });
});

describe('ChapterDrawer', () => {
  it('open=false 不渲染任何内容', async () => {
    const c = await mount(<ChapterDrawer open={false} chapters={CHS} currentId="ch-1" onPick={vi.fn()} onClose={vi.fn()} />);
    expect(c.querySelector('[data-testid="chapter-drawer"]')).toBeNull();
  });

  it('open 渲染章节列表（章号+字数）、点选回调并关闭、点遮罩关闭', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const c = await mount(<ChapterDrawer open chapters={CHS} currentId="ch-2" onPick={onPick} onClose={onClose} />);
    const drawer = c.querySelector('[data-testid="chapter-drawer"]');
    expect(drawer).not.toBeNull();
    expect(c.querySelector('[data-testid="drawer-ch-2"]')?.textContent).toContain('第2章');
    expect(c.querySelector('[data-testid="drawer-ch-3"]')?.textContent).toContain('12 字');
    await act(async () => {
      c.querySelector('[data-testid="drawer-ch-3"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPick).toHaveBeenCalledWith('ch-3');
    expect(onClose).toHaveBeenCalled();
    await act(async () => {
      (c.querySelector('button[aria-label="关闭目录"]') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

const baseWork = { id: 'w1', title: '测试书', characterIds: [], worldbookIds: [] } as unknown as Work;

function makeGen(overrides: Partial<Gen> = {}): Gen {
  return {
    streaming: false,
    streamingWorkId: null,
    buffer: '',
    thinkingBuffer: '',
    partialKept: false,
    error: null,
    clearError: vi.fn(),
    generateChapter: vi.fn(),
    continueFromPartial: vi.fn(async () => null),
    swipeRegenerate: vi.fn(async () => null),
    runBatch: vi.fn(),
    runByOutline: vi.fn(),
    batch: null,
    ...overrides,
  };
}

describe('TextPane 残章提示', () => {
  it('当前章结尾无句末标点（≥30 字）→ 提示条与「接着写」可见，点击调 continueFromPartial', async () => {
    const content =
      '雨夜的码头一片死寂，船老大收了钱便解了缆，他攥紧手里的信跳上船头，回头望了一眼那座他再也回不去的城，然后头也不回地跳进了舱里';
    const gen = makeGen();
    const c = await mount(
      <TextPane work={baseWork} chapters={[ch(1, '信', content)]} current={ch(1, '信', content)} gen={gen} onPick={vi.fn()} onDone={vi.fn()} />,
    );
    const tip = c.querySelector('[data-testid="truncated-tip"]');
    expect(tip).not.toBeNull();
    expect(tip?.textContent).toContain('未写完');
    await act(async () => {
      (c.querySelector('[data-testid="truncated-tip"] button') as HTMLButtonElement).click();
    });
    expect(gen.continueFromPartial).toHaveBeenCalled();
  });

  it('写完的章（句号收尾）不显示残章提示', async () => {
    const content = '雨停了。他推开门，走进湿漉漉的巷子，把信塞进了怀里最深处，然后头也不回地离开了这座城。这一走，就是三年。';
    const c = await mount(
      <TextPane work={baseWork} chapters={[ch(1, '别', content)]} current={ch(1, '别', content)} gen={makeGen()} onPick={vi.fn()} onDone={vi.fn()} />,
    );
    expect(c.querySelector('[data-testid="truncated-tip"]')).toBeNull();
  });
});

describe('BindingsPane 角色小传弹层', () => {
  const work = { id: 'w1', title: '测试书', characterIds: ['c1'], worldbookIds: [], factionIds: [] } as unknown as Work;

  beforeEach(() => {
    vi.mocked(apiFetch).mockImplementation(async (url: string, init?: unknown) => {
      const opts = (init ?? {}) as { method?: string; body?: string };
      if (url === '/api/characters' || url === '/api/worldbooks' || url === '/api/factions') return [];
      if (url === '/api/characters/c1' && !opts.method) return { id: 'c1', name: '沈清晏', bio: '七岁丧母。' };
      if (url === '/api/works/w1' && !opts.method) return work;
      if (url === '/api/works') return [];
      return {};
    });
  });

  it('点 📝 打开弹层并回显已有小传，保存 PATCH 带 bio 字段', async () => {
    const c = await mount(<BindingsPane work={work} onUpdated={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    const editBtn = c.querySelector('[data-testid="bio-edit-c1"]') as HTMLButtonElement | null;
    expect(editBtn).not.toBeNull();
    await act(async () => {
      editBtn!.click();
      await Promise.resolve();
    });
    const area = c.querySelector('[data-testid="bio-textarea"]') as HTMLTextAreaElement;
    expect(area).not.toBeNull();
    expect(area.value).toBe('七岁丧母。');
    await act(async () => {
      // React 受控组件：须经原型 setter 赋值再触发 input，onChange 才生效
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(area, '七岁丧母，后随兄长逃亡江南。');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (c.querySelector('[data-testid="bio-save"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    const patchCall = vi.mocked(apiFetch).mock.calls.find(([, init]) => (init as { method?: string })?.method === 'PATCH' && String((init as { body?: string })?.body).includes('bio'));
    expect(patchCall).toBeDefined();
    expect(JSON.parse((patchCall![1] as { body: string }).body).bio).toContain('逃亡江南');
  });
});
