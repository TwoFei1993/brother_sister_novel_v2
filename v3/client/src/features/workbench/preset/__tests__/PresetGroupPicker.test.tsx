/**
 * PresetGroupPicker 测试（主预设文风/情感基调/附加选项按书选择；桌面与移动端共用）。
 * 模式同 StylePresetSection.test：createRoot + act + data-testid + 原生事件；
 * mock api/works（updateWork）+ stub globalThis.fetch（/api/presets/:id 与 /api/works/:id）。
 * fixture 按 Sudachi-Next-Preset 真实排版构造。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { updateWork, type UpdateWorkSettingsInput } from '../../../../api/works';
import type { TavernPreset } from '@shared/tavern';
import { defaultNovelSettings, type Work } from '@shared/work';

import PresetGroupPicker from '../PresetGroupPicker';

vi.mock('../../../../api/works', () => ({
  updateWork: vi.fn(),
}));

const updateWorkMock = vi.mocked(updateWork);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const PID = 'main-preset';

type Row = [identifier: string, name: string, content: string, enabled?: boolean];
const SUDACHI_LIKE: Row[] = [
  ['main', '🐳主提示', 'MAIN', true],
  ['h-style', '—\\📖文风设定===', '{{//单选}}', true],
  ['sub-new', '===📬新文===', '', true],
  ['n-light', '🔖N-轻小说', '<writing_style>日系轻小说</writing_style>', true],
  ['n-romance', '🌸N-恋爱', '<writing_style>恋爱</writing_style>', false],
  ['sub-old', '===📭老文===', '', true],
  ['drama', '🔥短剧式', '{{setvar::style::短剧式}}', false],
  ['luxun', '🖋鲁迅式', '{{setvar::style::鲁迅式}}', false],
  ['h-tone', '—\\🕰情感基调===', '<keynote>情感基调</keynote>', true],
  ['tone-general', '⚫通用', '<tone>自然平衡</tone>', true],
  ['tone-joy', '⚫欢快', '<tone>欢快明亮</tone>', false],
  ['h-addon', '--\\📌附加选项===', '{{//可多选}}', true],
  ['anti-sf', '❎反科幻', '<anti_sci-fi/>', true],
  ['vivid', '🍈生动化', '<vivid/>', false],
];
/** 无分组标题的预设（如 Default） */
const PLAIN: Row[] = [
  ['main', 'Main Prompt', 'Write the story', true],
  ['jailbreak', 'Post-History', 'Only prose', true],
];

function presetOf(rows: Row[]): { id: string; name: string; tags: string[]; raw: TavernPreset } {
  return {
    id: PID,
    name: 'Sudachi-Next-Preset',
    tags: [],
    raw: {
      prompts: rows.map(([identifier, name, content]) => ({ identifier, name, role: 'system', content, system_prompt: true })),
      prompt_order: [{ character_id: 100001, order: rows.map(([identifier, , , enabled]) => ({ identifier, enabled: enabled ?? false })) }],
    },
  };
}

function workFixture(opts: { presetId?: string; overrides?: Record<string, boolean>; revision?: number } = {}): Work {
  return {
    id: 'w1',
    revision: opts.revision ?? 1,
    title: '测试作品',
    mode: 'novel',
    genre: 'hunhe',
    characterIds: [],
    worldbookIds: [],
    presetId: opts.presetId === undefined ? PID : opts.presetId,
    regexScriptIds: [],
    settings: {
      ...defaultNovelSettings,
      ...(opts.overrides ? { presetPromptOverrides: opts.overrides } : {}),
    },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

let serverWork: Work;
let presetRows: Row[];
let presetFetchFails: boolean;

function installFetchStub(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === `/api/presets/${PID}`) {
        if (presetFetchFails) throw new Error('网络错误');
        return { ok: true, status: 200, json: async () => presetOf(presetRows) } as unknown as Response;
      }
      if (url === '/api/works/w1') {
        return { ok: true, status: 200, json: async () => serverWork } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function mountPicker(work: Work, onSaved: (w: Work) => void = () => undefined): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<PresetGroupPicker work={work} onSaved={onSaved} />);
  });
  return container;
}

function member(container: HTMLElement, id: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`[data-testid="preset-member-${id}"]`);
  if (!el) throw new Error(`missing member ${id}`);
  return el;
}

async function click(el: Element | null | undefined, what = 'element'): Promise<void> {
  if (!el) throw new Error(`missing ${what}`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function save(container: HTMLElement): Promise<void> {
  await click(container.querySelector('[data-testid="preset-overrides-save"]'), 'save button');
}

function savedOverrides(): Record<string, boolean> | undefined {
  return updateWorkMock.mock.calls[updateWorkMock.mock.calls.length - 1]![1].settings?.presetPromptOverrides;
}

beforeEach(() => {
  updateWorkMock.mockReset();
  updateWorkMock.mockResolvedValue(workFixture({ revision: 2 }));
  presetRows = SUDACHI_LIKE;
  presetFetchFails = false;
  serverWork = workFixture();
  installFetchStub();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('PresetGroupPicker', () => {
  it('未绑定主预设 → 不渲染任何内容', async () => {
    const container = await mountPicker(workFixture({ presetId: '' }));
    expect(container.querySelector('[data-testid="preset-overrides"]')).toBeNull();
  });

  it('主预设没有分组标题 → 提示无可选项，不显示列表与保存', async () => {
    presetRows = PLAIN;
    const container = await mountPicker(workFixture());
    expect(container.querySelector('[data-testid="preset-overrides-empty"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="preset-group-style"]')).toBeNull();
    expect(container.querySelector('[data-testid="preset-overrides-save"]')).toBeNull();
  });

  it('按预设默认显示勾选态；子分区名（新文/老文）展示；文风与基调展开、附加选项折叠', async () => {
    const container = await mountPicker(workFixture());
    expect(member(container, 'n-light').checked).toBe(true);
    expect(member(container, 'drama').checked).toBe(false);
    expect(member(container, 'tone-general').checked).toBe(true);
    expect(container.querySelector('[data-testid="preset-group-style"]')?.getAttribute('data-open')).toBe('true');
    expect(container.querySelector('[data-testid="preset-group-tone"]')?.getAttribute('data-open')).toBe('true');
    expect(container.querySelector('[data-testid="preset-group-addon"]')?.getAttribute('data-open')).toBe('false');
    expect(container.querySelector('[data-testid="preset-member-vivid"]')).toBeNull(); // 折叠时成员不渲染
    expect(container.textContent).toContain('新文');
    expect(container.textContent).toContain('老文');
    expect(container.textContent).toContain('Sudachi-Next-Preset');
  });

  it('文风单选：选「短剧式」→ 默认的 N-轻小说取消、标「已改」；保存写入覆盖表', async () => {
    const onSaved = vi.fn();
    const container = await mountPicker(workFixture(), onSaved);
    await click(member(container, 'drama'), 'drama');
    expect(member(container, 'drama').checked).toBe(true);
    expect(member(container, 'n-light').checked).toBe(false);
    expect(container.textContent).toContain('已改');
    expect(updateWorkMock).not.toHaveBeenCalled(); // 未点保存不写库
    await save(container);
    expect(savedOverrides()).toEqual({ drama: true, 'n-light': false });
    expect(onSaved).toHaveBeenCalledTimes(1);
    const button = container.querySelector<HTMLButtonElement>('[data-testid="preset-overrides-save"]');
    expect(button?.disabled).toBe(true); // 保存后无未保存更改
  });

  it('情感基调多选：默认「通用」保留，再勾「欢快」两条并存', async () => {
    const container = await mountPicker(workFixture());
    await click(member(container, 'tone-joy'), 'tone-joy');
    expect(member(container, 'tone-general').checked).toBe(true);
    expect(member(container, 'tone-joy').checked).toBe(true);
    await save(container);
    expect(savedOverrides()).toEqual({ 'tone-joy': true });
  });

  it('附加选项：点展开后可勾选', async () => {
    const container = await mountPicker(workFixture());
    await click(container.querySelector('[data-testid="preset-group-toggle-addon"]'), 'addon toggle');
    expect(container.querySelector('[data-testid="preset-group-addon"]')?.getAttribute('data-open')).toBe('true');
    await click(member(container, 'vivid'), 'vivid');
    expect(member(container, 'vivid').checked).toBe(true);
    await save(container);
    expect(savedOverrides()).toEqual({ vivid: true });
  });

  it('已有覆盖表的书 → 打开即显示覆盖后的勾选态', async () => {
    const container = await mountPicker(workFixture({ overrides: { drama: true, 'n-light': false } }));
    expect(member(container, 'drama').checked).toBe(true);
    expect(member(container, 'n-light').checked).toBe(false);
  });

  it('加载失败 → 错误提示 + 重试后恢复', async () => {
    presetFetchFails = true;
    const container = await mountPicker(workFixture());
    const error = container.querySelector('[data-testid="preset-overrides-error"]');
    expect(error?.textContent).toContain('主预设加载失败');
    presetFetchFails = false;
    await click(error?.querySelector('button'), 'retry button');
    expect(container.querySelector('[data-testid="preset-overrides-error"]')).toBeNull();
    expect(member(container, 'n-light').checked).toBe(true);
  });

  it('保存失败 → 显示错误、勾选与「未保存」提示保留，可再次保存成功', async () => {
    const container = await mountPicker(workFixture());
    await click(member(container, 'tone-joy'), 'tone-joy');
    updateWorkMock.mockRejectedValueOnce(new Error('网络错误'));
    await save(container);
    expect(container.textContent).toContain('网络错误');
    expect(member(container, 'tone-joy').checked).toBe(true);
    expect(container.textContent).toContain('有未保存的更改');
    await save(container);
    expect(updateWorkMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('有未保存的更改');
  });

  it('外部保存导致 revision 变化：草稿未修改时同步服务端值；已修改时保留草稿', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const render = async (w: Work): Promise<void> => {
      await act(async () => {
        root.render(<PresetGroupPicker work={w} onSaved={() => undefined} />);
      });
    };
    await render(workFixture());
    // 未修改：服务端被别处改成选了短剧式 → 同步
    await render(workFixture({ overrides: { drama: true, 'n-light': false }, revision: 2 }));
    expect(member(container, 'drama').checked).toBe(true);
    // 已修改：外部再保存 → 保留草稿
    await click(member(container, 'luxun'), 'luxun');
    await render(workFixture({ overrides: { drama: true, 'n-light': false }, revision: 3 }));
    expect(member(container, 'luxun').checked).toBe(true);
    expect(member(container, 'drama').checked).toBe(false);
  });
});
