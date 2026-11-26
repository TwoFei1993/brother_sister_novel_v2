/**
 * 分集剧本区（设计共识 2026-11-26 第 3.4 节）：
 * 状态徽标、保存并采用（保留集的其余字段）、原文性质下拉、流水线运行中禁用一键入口。
 * 单集 AI 生成替身为不生成的 mock。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DuanjuEpisode, DuanjuProject } from '@shared/duanju';
import { newDuanjuProject } from '@shared/duanju';

import { usePipelineStore, useEpisodeDraftStore } from '../../lib/pipeline/stores';
import { useDuanjuStore } from '../../store';
import EpisodeScripts from '../EpisodeScripts';
import type { useEpisodeGen } from '../hooks/useEpisodeGen';

const mocks = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('../hooks/useEpisodeGen', () => ({
  useEpisodeGen: (): ReturnType<typeof useEpisodeGen> => ({ active: null, error: null, start: mocks.start, dismissError: vi.fn() }),
}));

vi.mock('../../lib/pipeline/runner', () => ({ startPipeline: vi.fn().mockResolvedValue({ status: 'done', failed: [] }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const WID = 'w1';

function episode(index: number, overrides: Partial<DuanjuEpisode> = {}): DuanjuEpisode {
  return { id: `ep-${index}`, index, title: `第${index}集`, synopsis: `梗概${index}`, sourceStart: `开头${index}`, sourceEnd: `结尾${index}`, ...overrides };
}

function project(overrides: Partial<DuanjuProject> = {}): DuanjuProject {
  return {
    ...newDuanjuProject({ targetEpisodes: 3, style: '动漫风', protagonists: '' }, 1),
    script: { source: 'pasted', text: '小说原文', confirmed: true, scope: 'full', updatedAt: 1 },
    episodes: [episode(1, { script: '已有剧本', scriptSource: 'adapted', scriptUpdatedAt: 5, mechanisms: ['hook'] }), episode(2), episode(3)],
    ...overrides,
  };
}

let patchMock: ReturnType<typeof vi.fn>;

async function mount(p: DuanjuProject): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  patchMock = vi.fn().mockResolvedValue(true);
  useDuanjuStore.setState({ project: p, patch: patchMock, saving: false, conflict: false });
  await act(async () => {
    root.render(<EpisodeScripts workId={WID} />);
  });
  return container;
}

async function click(c: HTMLElement, testid: string): Promise<void> {
  const el = c.querySelector(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`missing ${testid}`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function type(c: HTMLElement, testid: string, value: string): Promise<void> {
  const el = c.querySelector<HTMLTextAreaElement>(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`missing ${testid}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function select(c: HTMLElement, testid: string, value: string): Promise<void> {
  const el = c.querySelector<HTMLSelectElement>(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`missing ${testid}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  mocks.start.mockReset();
  useEpisodeDraftStore.setState({ drafts: {} });
  usePipelineStore.setState({ runs: {} });
  localStorage.clear();
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('EpisodeScripts 分集剧本区', () => {
  it('每集一张卡：已采用的标来源，没写的标未写；未写集数计入一键入口', async () => {
    const c = await mount(project());
    expect(c.querySelectorAll('[data-testid^="ep-script-toggle-"]')).toHaveLength(3);
    expect(c.querySelector('[data-testid="ep-script-toggle-1"]')?.textContent).toContain('已采用·AI 改编');
    expect(c.querySelector('[data-testid="ep-script-toggle-2"]')?.textContent).toContain('未写');
    expect(c.querySelector('[data-testid="ep-scripts-adapt-all"]')?.textContent).toContain('（2）');
  });

  it('展开第 2 集 → AI 改编进草稿（不落库）→ 保存并采用：写入正文、来源记手写，保留集的其余字段', async () => {
    const c = await mount(project());
    await click(c, 'ep-script-toggle-2');
    await click(c, 'ep-script-gen-2');
    expect(mocks.start).toHaveBeenCalledTimes(1);
    const ep = mocks.start.mock.calls[0]![0] as DuanjuEpisode;
    expect(ep.id).toBe('ep-2');
    expect(patchMock).not.toHaveBeenCalled(); // AI 结果不直接落库

    const draft = '场1 内·比剑台·日\n这是第 2 集的新剧本。';
    await act(async () => {
      useEpisodeDraftStore.getState().setDraft(WID, 'ep-2', draft);
    });
    expect(c.querySelector<HTMLTextAreaElement>('[data-testid="ep-script-text-2"]')?.value).toBe(draft);
    await click(c, 'ep-script-save-2');
    expect(patchMock).toHaveBeenCalledWith(WID, {
      episodes: [
        project().episodes[0],
        expect.objectContaining({
          id: 'ep-2',
          script: draft,
          scriptSource: 'manual',
          scriptUpdatedAt: expect.any(Number),
          sourceStart: '开头2', // 其余字段保留
          sourceEnd: '结尾2',
          synopsis: '梗概2',
        }),
        project().episodes[2],
      ],
    });
    expect(useEpisodeDraftStore.getState().draftOf(WID, 'ep-2')).toBe(''); // 草稿已清
  });

  it('放弃修改：清草稿，不保存', async () => {
    const c = await mount(project());
    await click(c, 'ep-script-toggle-2');
    await type(c, 'ep-script-text-2', '随手写的草稿');
    await click(c, 'ep-script-discard-2');
    expect(useEpisodeDraftStore.getState().draftOf(WID, 'ep-2')).toBe('');
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('「只有第 1 集」的作品：第 1 集标「原文即第 1 集」，只读；第 2 集的按钮是续写', async () => {
    const c = await mount(
      project({
        script: { source: 'ai', text: '第 1 集剧本原文', confirmed: true, scope: 'episode1', updatedAt: 1 },
        episodes: [episode(1), episode(2), episode(3)],
      }),
    );
    expect(c.querySelector('[data-testid="ep-script-toggle-1"]')?.textContent).toContain('原文即第 1 集');
    expect(c.querySelector('[data-testid="ep-script-gen-1"]')).toBeNull(); // 不需要生成
    await click(c, 'ep-script-toggle-2');
    expect(c.querySelector('[data-testid="ep-script-gen-2"]')?.textContent).toContain('AI 续写本集');
    expect(c.querySelector('[data-testid="ep-scripts-adapt-all"]')?.textContent).toContain('（2）'); // 第 1 集不算未写
  });

  it('原文性质下拉：保存时保留原文对象的其余字段', async () => {
    const p = project();
    const c = await mount({ ...p, script: { ...p.script, scope: 'episode1' } });
    await select(c, 'ep-scripts-scope', 'full');
    expect(patchMock).toHaveBeenCalledWith(WID, {
      script: { source: 'pasted', text: '小说原文', confirmed: true, scope: 'full', updatedAt: 1 },
    });
  });

  it('停靠开关：写入 pipeline 偏好', async () => {
    const c = await mount(project());
    const box = c.querySelector<HTMLInputElement>('[data-testid="ep-scripts-pause-switch"]');
    await act(async () => {
      box!.click();
    });
    expect(patchMock).toHaveBeenCalledWith(WID, { pipeline: { pauseAfterScripts: true } });
  });

  it('流水线运行中：一键入口禁用；没有分集时提示先拆解', async () => {
    const c = await mount(project());
    await act(async () => {
      usePipelineStore.getState().setRun(WID, { status: 'running', step: 'script', episodeIndex: 1, label: 'x', failed: [], message: '' });
    });
    expect(c.querySelector<HTMLButtonElement>('[data-testid="ep-scripts-adapt-all"]')?.disabled).toBe(true);
    expect(c.querySelector<HTMLSelectElement>('[data-testid="ep-scripts-scope"]')?.disabled).toBe(true);

    const empty = await mount(project({ episodes: [] }));
    expect(empty.querySelector('[data-testid="ep-scripts-empty"]')?.textContent).toContain('AI 拆解');
  });
});

describe('EpisodeScripts 评审后的修正（2026-11-26）', () => {
  const disabled = (c: HTMLElement, testid: string): boolean =>
    (c.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)?.disabled ?? true) === true;

  it('流水线运行中：单集的 AI 改编 / 重写也禁用（流水线写的就是这些集）；停靠等审时不禁用', async () => {
    const c = await mount(project());
    await click(c, 'ep-script-toggle-2');
    await act(async () => {
      usePipelineStore.getState().setRun(WID, { status: 'running', step: 'script', episodeIndex: 1, label: 'x', failed: [], message: '' });
    });
    expect(disabled(c, 'ep-script-gen-2')).toBe(true);

    await act(async () => {
      usePipelineStore.getState().setRun(WID, { status: 'paused', step: 'storyboard', episodeIndex: 0, label: '', failed: [], message: '' });
    });
    expect(disabled(c, 'ep-script-gen-2')).toBe(false);
  });

  it('把已有剧本删光再保存 = 清除本集剧本（回到未写），会先确认', async () => {
    const c = await mount(project());
    await click(c, 'ep-script-toggle-1');
    await type(c, 'ep-script-text-1', '');
    expect(c.querySelector('[data-testid="ep-script-save-1"]')?.textContent).toContain('清除本集剧本');
    await click(c, 'ep-script-save-1');
    expect(confirm).toHaveBeenCalledTimes(1);
    const saved = patchMock.mock.calls[0]![1].episodes[0] as DuanjuEpisode;
    expect(saved.script).toBeUndefined();
    expect(saved).toMatchObject({ id: 'ep-1', mechanisms: ['hook'], sourceStart: '开头1' }); // 其余字段保留
    expect(useEpisodeDraftStore.getState().draftOf(WID, 'ep-1')).toBe(''); // 草稿已清
  });

  it('在编辑器里直接改了再保存：来源记手写', async () => {
    const c = await mount(project());
    await click(c, 'ep-script-toggle-1');
    await type(c, 'ep-script-text-1', '场1 内·比剑台·日\n用户手改的第 1 集。');
    await click(c, 'ep-script-save-1');
    const saved = patchMock.mock.calls[0]![1].episodes[0] as DuanjuEpisode;
    expect(saved).toMatchObject({ script: '场1 内·比剑台·日\n用户手改的第 1 集。', scriptSource: 'manual' });
  });

  it('重写流程：点「按意见重写」→ 草稿 → 保存并采用，来源沿用 AI 改编', async () => {
    const c = await mount(project());
    await click(c, 'ep-script-toggle-1');
    await click(c, 'ep-script-rewrite-open-1');
    await act(async () => {
      const box = c.querySelector<HTMLTextAreaElement>('[aria-label="修改意见"]')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, '对白口语一些');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(c, 'ep-script-rewrite-1');
    expect(mocks.start.mock.calls.map((call) => [call[0]?.id, call[1], call[2]])).toEqual([['ep-1', 'rewrite', '对白口语一些']]);
    const rewritten = '场1 内·比剑台·日\n重写后的第 1 集。';
    await act(async () => {
      useEpisodeDraftStore.getState().setDraft(WID, 'ep-1', rewritten);
    });
    await click(c, 'ep-script-save-1');
    const saved = patchMock.mock.calls[0]![1].episodes[0] as DuanjuEpisode;
    expect(saved).toMatchObject({ script: rewritten, scriptSource: 'adapted' });
  });

  it('要靠原文改编、却没有任何一集带原文位置锚点（老作品）→ 提示先重新拆解；有锚点时不提示', async () => {
    const noAnchors = project({ episodes: [episode(2, { sourceStart: undefined, sourceEnd: undefined })] });
    const c = await mount(noAnchors);
    expect(c.querySelector('[data-testid="ep-scripts-no-anchors"]')?.textContent).toContain('重新 AI 拆解');
    expect(c.textContent).toContain('判断不准可以在这里改');

    // 「只有第 1 集」的作品后面各集是续写，不靠锚点切片：同样的集不提示
    const p = project({ episodes: [episode(2, { sourceStart: undefined, sourceEnd: undefined })] });
    const continued = await mount({ ...p, script: { ...p.script, scope: 'episode1' as const } });
    expect(continued.querySelector('[data-testid="ep-scripts-no-anchors"]')).toBeNull();
  });
});
