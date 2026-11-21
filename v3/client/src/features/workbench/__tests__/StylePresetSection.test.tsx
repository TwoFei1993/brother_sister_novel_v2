/**
 * StylePresetSection 测试（模式同 StyleClonePanel.test：createRoot + act + data-testid + 原生事件）
 *
 * mock api/works（updateWork）+ stub globalThis.fetch 双路由：
 * - /api/presets → 预设浅列表 fixture
 * - /api/works/:id → 带最新 revision 的 work fixture（apply PATCH 前置 GET 用）；未知 URL 抛错
 *
 * 覆盖（Task 3 六用例）：① 首次自动推荐 ② 改风格推荐重跑（只增不删+置 dirty）
 * ③ 手动取消不弹回（dismissed D3①）④ 确认链路走弹窗 ⑤ 弹窗确认写入+弹窗内取消不弹回
 * （dismissed D3②）⑥ 主预设不参与清单
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { updateWork, type UpdateWorkSettingsInput } from '../../../api/works';
import type { StoryTone, Work } from '@shared/work';
import { defaultNovelSettings } from '@shared/work';

import StylePresetSection from '../StylePresetSection';

vi.mock('../../../api/works', () => ({
  updateWork: vi.fn(),
}));

const updateWorkMock = vi.mocked(updateWork);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

const PRESETS = [
  { id: 'g1', name: '通用基础', tags: ['通用'] },
  { id: 'm1', name: '番茄欢乐', tags: ['欢乐'] }, // tag 命中基调「欢乐轻松」
  { id: 'f1', name: '番茄极速', tags: [] }, // 仅当风格切「番茄·快节奏」时名称命中
  { id: 'o1', name: '古风正剧', tags: ['古风'] },
];

/** storyTones 枚举外的自由文本基调用例（组件仅做字符串匹配，无 schema 校验） */
const TONES_JOY = ['欢乐轻松'] as unknown as StoryTone[];
const TONES_JOY_HOT = ['欢乐轻松', '热血'] as unknown as StoryTone[];

function workFixture(opts: { stylePresetIds?: string[]; tones?: StoryTone[]; revision?: number } = {}): Work {
  return {
    id: 'w1',
    revision: opts.revision ?? 1,
    title: '测试作品',
    mode: 'novel',
    genre: 'hunhe',
    characterIds: [],
    worldbookIds: [],
    presetId: 'main-preset', // 主预设：fixture 无对应预设 → 清单不渲染对应行（用例⑥）
    regexScriptIds: [],
    settings: {
      ...defaultNovelSettings,
      subGenre: '都市异能',
      storyTones: opts.tones ?? TONES_JOY,
      ...(opts.stylePresetIds !== undefined ? { stylePresetIds: opts.stylePresetIds } : {}),
    },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

/** GET /api/works/:id（PATCH 前置）返回的「服务端最新」work，测试可覆写 */
let serverWork: Work;

function installFetchStub(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/presets')) {
        return { ok: true, status: 200, json: async () => PRESETS } as unknown as Response;
      }
      if (/\/api\/works\/[^/]+$/.test(url)) {
        return { ok: true, status: 200, json: async () => serverWork } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

interface Harness {
  container: HTMLElement;
  rerender: (work: Work) => Promise<void>;
}

async function mountSection(work: Work): Promise<Harness> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (w: Work): void => root.render(<StylePresetSection work={w} onSaved={() => undefined} />);
  await act(async () => {
    render(work);
  });
  return {
    container,
    rerender: async (w: Work) => {
      await act(async () => {
        render(w);
      });
    },
  };
}

/** 主清单行 checkbox（弹窗内 checkbox 需走 dialogCheckbox） */
function listCheckbox(h: Harness, id: string): HTMLInputElement {
  const el = h.container.querySelector<HTMLInputElement>(`[data-testid="preset-pick-list"] [data-preset-id="${id}"]`);
  if (!el) throw new Error(`missing list checkbox ${id}`);
  return el;
}

function dialogCheckbox(h: Harness, id: string): HTMLInputElement {
  const el = h.container.querySelector<HTMLInputElement>(
    `[data-testid="preset-confirm-dialog"] [data-preset-id="${id}"]`,
  );
  if (!el) throw new Error(`missing dialog checkbox ${id}`);
  return el;
}

async function clickTestid(h: Harness, testid: string): Promise<void> {
  const el = h.container.querySelector(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`missing element ${testid}`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** checkbox 原生 click（jsdom 执行激活行为翻转 checked → React onChange） */
async function toggleCheckbox(el: HTMLInputElement): Promise<void> {
  await act(async () => {
    el.click();
  });
}

/** select 切换：原生 value setter 绕过 tracker 后派发 change（React onChange） */
async function selectStyle(h: Harness, value: string): Promise<void> {
  const select = h.container.querySelector<HTMLSelectElement>('[data-testid="work-style-select"]');
  if (!select) throw new Error('missing style select');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('StylePresetSection', () => {
  beforeEach(() => {
    updateWorkMock.mockReset();
    serverWork = workFixture();
    installFetchStub();
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots) root.unmount();
    });
    roots.length = 0;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('① 首次自动推荐：通用+tag命中预设自动勾选，未确认提示条可见', async () => {
    const h = await mountSection(workFixture());
    expect(listCheckbox(h, 'g1').checked).toBe(true); // 通用常驻
    expect(listCheckbox(h, 'm1').checked).toBe(true); // tag「欢乐」命中基调「欢乐轻松」
    expect(listCheckbox(h, 'f1').checked).toBe(false); // 无 tag 且名称未命中
    expect(listCheckbox(h, 'o1').checked).toBe(false); // tag「古风」不命中
    expect(h.container.querySelector('[data-testid="preset-hint"]')).not.toBeNull();
  });

  it('② 改风格推荐重跑：新命中预设只增不删并入打「新」徽标，并置 dirty（确认按钮可点）', async () => {
    const h = await mountSection(workFixture());
    await selectStyle(h, 'fanqie'); // 「番茄·快节奏」拆词 → f1 名称命中
    const f1 = listCheckbox(h, 'f1');
    expect(f1.checked).toBe(true);
    expect(f1.closest('label')?.querySelector('[data-testid="preset-new-rec"]')).not.toBeNull();
    expect(listCheckbox(h, 'm1').checked).toBe(true); // 只增不删
    expect(listCheckbox(h, 'g1').checked).toBe(true);
    const apply = h.container.querySelector<HTMLButtonElement>('[data-testid="style-apply"]');
    expect(apply?.disabled).toBe(false); // 自动合并须置 dirty，否则确认链路走不通
  });

  it('③ 手动取消的预设不再被推荐自动加回（dismissed D3①）', async () => {
    const h = await mountSection(workFixture());
    await toggleCheckbox(listCheckbox(h, 'm1'));
    expect(listCheckbox(h, 'm1').checked).toBe(false);
    // 新数组引用的 storyTones rerender → 推荐重跑 effect 真正执行
    await h.rerender(workFixture({ tones: TONES_JOY_HOT }));
    expect(listCheckbox(h, 'm1').checked).toBe(false); // dismissed 生效，不偷偷加回
    expect(listCheckbox(h, 'g1').checked).toBe(true); // 其余推荐不受影响
  });

  it('④ 确认链路走弹窗：点确认应用先开弹窗，不直接 PATCH', async () => {
    const h = await mountSection(workFixture());
    await clickTestid(h, 'style-apply');
    expect(h.container.querySelector('[data-testid="preset-confirm-dialog"]')).not.toBeNull();
    expect(updateWorkMock).not.toHaveBeenCalled();
  });

  it('⑤ 弹窗确认写入最终勾选；弹窗内取消的预设保存后不弹回（dismissed D3②）', async () => {
    updateWorkMock.mockResolvedValue(workFixture({ stylePresetIds: ['g1'], revision: 2 }));
    const h = await mountSection(workFixture());
    await clickTestid(h, 'style-apply');
    await toggleCheckbox(dialogCheckbox(h, 'm1')); // 弹窗内取消 m1
    await clickTestid(h, 'preset-confirm-ok');
    expect(updateWorkMock).toHaveBeenCalledTimes(1);
    const input = updateWorkMock.mock.calls[0]![1] as UpdateWorkSettingsInput;
    expect(input.revision).toBe(1); // PATCH 前置 GET 取到的最新 revision
    expect(input.settings?.stylePresetIds).toEqual(['g1']); // 弹窗最终勾选（不含 m1）
    expect(input.settings?.writingStyle).toBe('default');
    // 保存后的 work 回流（新引用 storyTones）→ 重跑不把 m1 并回；提示条消失
    await h.rerender(workFixture({ stylePresetIds: ['g1'], tones: TONES_JOY_HOT, revision: 2 }));
    expect(listCheckbox(h, 'm1').checked).toBe(false);
    expect(listCheckbox(h, 'g1').checked).toBe(true);
    expect(h.container.querySelector('[data-testid="preset-hint"]')).toBeNull();
  });

  it('⑥ 主预设不参与清单：work.presetId 无对应预设，清单行数=4', async () => {
    const h = await mountSection(workFixture());
    const rows = h.container.querySelectorAll('[data-testid="preset-pick-list"] label');
    expect(rows.length).toBe(4);
  });
});
