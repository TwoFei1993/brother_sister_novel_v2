/**
 * OutlineWizard 一键导入集成测试（Word 导入实测反馈①⑥）：
 * - 反馈①：抽取预览区「一键导入角色卡+世界书」主按钮 → 串行 POST 角色卡（逐个）+ 世界书
 *   → 不跳转（仍在向导页），就地显示成功清单（已建卡名 + 世界书名）与「前往资产库」链接
 * - 反馈⑥时序B：本会话已创建作品（v3-wizard-created-work-id 锚点）→ 一键导入成功后
 *   自动 GET revision + PATCH 合并绑定 ids，并清除锚点
 * - 条件不满足（无背景/势力/矛盾）时主按钮禁用
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import OutlineWizard from '../OutlineWizard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OUTLINE = `一、故事背景：灵气复苏的大周王朝，凡人可修行问道。
哥哥（林昭）：天赋觉醒古龙血脉，性格沉稳坚毅。
妹妹（林婉儿）：精通上古阵法，心思缜密。`;

/** fetch mock：按「METHOD 路径」（缺省 GET）分发 JSON 响应，记录调用序列 */
function mockFetch(routes: Record<string, (init?: RequestInit) => unknown>): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const handler = routes[`${method} ${path}`] ?? routes[path];
    if (!handler) throw new Error(`unexpected fetch: ${method} ${path}`);
    return new Response(JSON.stringify(handler(init)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

/** 标准路由：2 张卡 + 世界书 + 绑定目标的 GET/PATCH */
function baseRoutes(log: { patched?: unknown }) {
  return {
    '/api/characters': (init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { name: string };
      return { id: `char-${body.name}`, name: body.name };
    },
    '/api/worldbooks': () => ({ id: 'wb-1', name: '大纲世界书' }),
    '/api/works/w1': () => ({
      id: 'w1',
      revision: 3,
      title: '旧作',
      mode: 'novel',
      genre: 'chuanyue',
      characterIds: ['char-existing'],
      worldbookIds: [],
      presetId: '',
      regexScriptIds: [],
      voiceMap: {},
      settings: {},
      createdAt: 0,
      updatedAt: 0,
    }),
    'PATCH /api/works/w1': (init?: RequestInit) => {
      log.patched = JSON.parse(String(init?.body));
      return { id: 'w1', revision: 4, title: '旧作' };
    },
  };
}

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function mountWizard(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/wizard']}>
        <Routes>
          <Route path="/wizard" element={<OutlineWizard />} />
          <Route path="/library" element={<div>LIBRARY_PAGE_SENTINEL</div>} />
          <Route path="/work/:id" element={<div>WORK_PAGE_SENTINEL</div>} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return container;
}

async function typeOutline(container: HTMLElement, text: string): Promise<void> {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="大纲文本"]');
  if (!textarea) throw new Error('missing outline textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(container: HTMLElement, testId: string): Promise<void> {
  const btn = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!btn) throw new Error(`missing button ${testId}`);
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('OutlineWizard 一键导入（反馈①：不跳转 + 就地清单）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('一键导入：串行建 2 卡 + 1 世界书，不跳转，就地显示成功清单与「前往资产库」链接', async () => {
    const routes = baseRoutes({});
    const fetchMock = mockFetch(routes);
    vi.stubGlobal('fetch', fetchMock);
    const c = await mountWizard();
    await typeOutline(c, OUTLINE);
    await click(c, 'extract-btn'); // 智能抽取 → 预览区出现

    const allBtn = c.querySelector<HTMLButtonElement>('[data-testid="import-all-btn"]');
    expect(allBtn?.disabled).toBe(false); // 有人物 + 有背景 → 可一键导入

    await click(c, 'import-all-btn');
    const calls = fetchMock.mock.calls.map((x) => String(x[0]));
    expect(calls).toEqual(['/api/characters', '/api/characters', '/api/worldbooks']); // 串行 2 卡 + 1 书

    const result = c.querySelector('[data-testid="import-all-result"]');
    expect(result).not.toBeNull(); // 就地成功清单
    expect(result?.textContent).toContain('林昭');
    expect(result?.textContent).toContain('林婉儿');
    expect(result?.textContent).toContain('大纲世界书');
    expect(result?.querySelector('[data-testid="goto-library"]')?.getAttribute('href')).toBe('/library');
    expect(c.textContent).not.toContain('LIBRARY_PAGE_SENTINEL'); // 未跳转
  });

  it('无背景/势力/矛盾：主按钮禁用（title 提示原因）', async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal('fetch', fetchMock);
    const c = await mountWizard();
    await typeOutline(c, '哥哥（林昭）：天赋觉醒古龙血脉，性格沉稳。'); // 只有人物
    await click(c, 'extract-btn');
    const allBtn = c.querySelector<HTMLButtonElement>('[data-testid="import-all-btn"]');
    expect(allBtn?.disabled).toBe(true);
    expect(allBtn?.title).toContain('背景');
  });
});

describe('OutlineWizard 自动绑定（反馈⑥时序B：先创建作品后建卡）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('锚点存在：一键导入成功后自动 GET revision + PATCH 合并绑定（保留既有 ids），并清除锚点', async () => {
    localStorage.setItem('v3-wizard-created-work-id', 'w1');
    const log: { patched?: unknown } = {};
    vi.stubGlobal('fetch', mockFetch(baseRoutes(log)));
    const c = await mountWizard();
    await typeOutline(c, OUTLINE);
    await click(c, 'extract-btn');
    await click(c, 'import-all-btn');

    const calls = vi.mocked(globalThis.fetch).mock.calls.map((x) => String(x[0]));
    expect(calls).toContain('/api/works/w1'); // GET 取 revision
    const patchCall = vi.mocked(globalThis.fetch).mock.calls.find((x) => String(x[0]) === '/api/works/w1' && x[1]?.method === 'PATCH');
    expect(patchCall).toBeDefined();
    const body = JSON.parse(String(patchCall?.[1]?.body)) as { revision: number; characterIds: string[]; worldbookIds: string[] };
    expect(body.revision).toBe(3);
    expect(body.characterIds).toEqual(['char-existing', 'char-林昭', 'char-林婉儿']); // 去重合并
    expect(body.worldbookIds).toEqual(['wb-1']);
    expect(log.patched).toBeDefined();
    expect(localStorage.getItem('v3-wizard-created-work-id')).toBeNull(); // 绑定完成清除锚点
  });

  it('无锚点：一键导入后不触发作品 PATCH', async () => {
    vi.stubGlobal('fetch', mockFetch(baseRoutes({})));
    const c = await mountWizard();
    await typeOutline(c, OUTLINE);
    await click(c, 'extract-btn');
    await click(c, 'import-all-btn');
    const calls = vi.mocked(globalThis.fetch).mock.calls.map((x) => String(x[0]));
    expect(calls.filter((p) => p.startsWith('/api/works'))).toEqual([]); // 无作品可绑定
  });
});
