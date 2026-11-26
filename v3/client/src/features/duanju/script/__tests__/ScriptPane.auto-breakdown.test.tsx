/**
 * ScriptPane「一键转短剧后自动拆解」测试（生产实测 2026-11-24 抓出的 bug）：
 * 剧本文字同步（setText）与自动触发在同一次提交里先后执行，自动触发拿到的 text 还是空串，
 * runBreakdown 按「剧本为空」直接返回并清掉一次性标志——表现为转短剧后永远不自动拆解。
 *
 * 2026-11-26 追加：拆解完成后要等审核卡与集列表保存成功才启动流水线；保存失败不启动、可重试应用。
 * useBgLlmTask / 流水线启动 模块级 mock：只验证「是否自动发起拆解任务」与「何时启动流水线」。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { newDuanjuProject, type DuanjuProject } from '@shared/duanju';

import { useDuanjuStore } from '../../store';
import ScriptPane from '../ScriptPane';

const mocks = vi.hoisted(() => ({ submit: vi.fn(), startPipeline: vi.fn() }));
/** 最近一次挂载拿到的拆解完成回调（由测试直接调用来模拟拆解完成） */
let lastOnDone: ((raw: string) => void) | null = null;

vi.mock('../../../../hooks/useBgLlmTask', () => ({
  useBgLlmTask: (_slot: string, onDone: (raw: string) => void) => {
    lastOnDone = onDone;
    return { state: null, submit: mocks.submit, resume: vi.fn(), clear: vi.fn() };
  },
}));
vi.mock('../../lib/pipeline/runner', () => ({
  startPipeline: (...args: unknown[]) => mocks.startPipeline(...args),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const WID = 'duanju-converted-1';
const KEY = `duanju-auto-breakdown-${WID}`;
const SCRIPT = '第一集：兄妹到了镇上。\n第二集：祠堂对峙。';

function projectFixture(overrides: Partial<DuanjuProject> = {}): DuanjuProject {
  const now = Date.now();
  const base = newDuanjuProject({ targetEpisodes: 12, style: '动漫风', protagonists: '' }, now);
  return {
    ...base,
    script: { source: 'pasted', text: SCRIPT, confirmed: true, updatedAt: now },
    ...overrides,
  };
}

/** 复现真实时序：先以 project=null 挂载（project 尚未加载），再让 project 到达 */
async function mountThenDeliver(project: DuanjuProject | null): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  useDuanjuStore.setState({ project: null, saving: false, conflict: false });
  await act(async () => {
    root.render(<ScriptPane workId={WID} />);
  });
  if (project) {
    await act(async () => {
      useDuanjuStore.setState({ project, patch: vi.fn() });
    });
  }
  return container;
}

/** 直接以就绪的 project 挂载（patch 可控） */
async function mountReady(project: DuanjuProject, patch: ReturnType<typeof vi.fn>): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  useDuanjuStore.setState({ project, patch, saving: false, conflict: false });
  await act(async () => {
    root.render(<ScriptPane workId={WID} />);
  });
  return container;
}

async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error('missing element');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const breakdownJson = JSON.stringify({
  summary: '兄妹到镇上',
  eventChain: [],
  conflict: '',
  characterRelations: '兄妹',
  emotionPoints: [],
  visualActions: [],
  riskReplacements: [],
  episodes: [{ index: 1, title: '到镇上', synopsis: '兄妹到了镇上' }],
});

beforeEach(() => {
  mocks.submit.mockReset();
  mocks.startPipeline.mockReset();
  lastOnDone = null;
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
});

describe('ScriptPane 一键转短剧后自动拆解', () => {
  it('有转换标志 + 剧本已定稿且未拆解 → project 到达后自动发起拆解任务，标志清除', async () => {
    sessionStorage.setItem(KEY, '1');
    await mountThenDeliver(projectFixture());
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(KEY)).toBeNull();
    const body = mocks.submit.mock.calls[0]![0] as { label: string; messages: Array<{ content: string }> };
    expect(body.label).toBe('拆解');
    expect(body.messages.some((m) => m.content.includes('祠堂对峙'))).toBe(true); // 用的是同步后的剧本全文
  });

  it('挂载时 project 已就位（不经 null 阶段）→ 同样自动触发', async () => {
    sessionStorage.setItem(KEY, '1');
    useDuanjuStore.setState({ project: projectFixture(), patch: vi.fn() });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(<ScriptPane workId={WID} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it('没有转换标志 → 不自动触发', async () => {
    await mountThenDeliver(projectFixture());
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('已有分集（拆解过）→ 不重复拆解，标志清除', async () => {
    sessionStorage.setItem(KEY, '1');
    const ep = { id: 'ep-1', index: 1, title: '第一集', synopsis: '到镇上' };
    await mountThenDeliver(projectFixture({ episodes: [ep] }));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('剧本未定稿 → 不自动触发，标志清除', async () => {
    sessionStorage.setItem(KEY, '1');
    const p = projectFixture();
    await mountThenDeliver({ ...p, script: { ...p.script, confirmed: false } });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('手动点「AI 拆解」按钮仍可发起（回归）', async () => {
    const container = await mountThenDeliver(projectFixture());
    await click(container.querySelector('[data-testid="script-breakdown"]'));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
});

describe('拆解完成后的流水线启动', () => {
  it('拆解结果保存成功后才启动流水线（从角色提取开始）', async () => {
    const patch = vi.fn().mockResolvedValue(true);
    await mountReady(projectFixture(), patch);
    await act(async () => {
      lastOnDone!(breakdownJson);
    });
    expect(patch).toHaveBeenCalledWith(WID, {
      reviewCards: expect.objectContaining({ summary: '兄妹到镇上' }),
      episodes: [expect.objectContaining({ index: 1, title: '到镇上' })],
    });
    expect(mocks.startPipeline).toHaveBeenCalledTimes(1);
    expect(mocks.startPipeline).toHaveBeenCalledWith(WID);
    expect(localStorage.getItem(`duanju-breakdown-raw-${WID}`)).toBeNull(); // 暂存已清除
  });

  it('保存失败：不启动流水线，显示「重试应用」；点重试成功后才启动', async () => {
    const patch = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const container = await mountReady(projectFixture(), patch);
    await act(async () => {
      lastOnDone!(breakdownJson);
    });
    expect(mocks.startPipeline).not.toHaveBeenCalled();
    expect(localStorage.getItem(`duanju-breakdown-raw-${WID}`)).toBe(breakdownJson); // 原文已暂存
    await click(container.querySelector('[data-testid="script-breakdown-retry-apply"]'));
    expect(patch).toHaveBeenCalledTimes(2);
    expect(mocks.startPipeline).toHaveBeenCalledTimes(1);
  });

  it('保存往返期间页面被回收：重新打开剧本 tab 会把暂存的拆解结果应用并启动流水线', async () => {
    localStorage.setItem(`duanju-breakdown-raw-${WID}`, breakdownJson);
    const patch = vi.fn().mockResolvedValue(true);
    await mountReady(projectFixture(), patch);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(mocks.startPipeline).toHaveBeenCalledTimes(1);
  });
});

describe('ScriptPane 原文的保存（2026-11-26 独立评审第 9 条）', () => {
  it('改了原文才能保存；保存成功后「保存剧本」立刻变回不可点（此前看着还能点，再点一次会把原文的更新时刻刷掉）', async () => {
    const p = projectFixture();
    /** 像真实 store 那样把 PATCH 结果写回 project */
    const patch = vi.fn(async (_id: string, fields: { script?: DuanjuProject['script'] }) => {
      const cur = useDuanjuStore.getState().project!;
      useDuanjuStore.setState({ project: { ...cur, script: fields.script ?? cur.script, revision: cur.revision + 1 } });
      return true;
    });
    const c = await mountReady(p, patch);
    const saveBtn = (): HTMLButtonElement => c.querySelector('[data-testid="script-save"]')!;
    const textarea = c.querySelector<HTMLTextAreaElement>('[data-testid="script-text"]')!;
    expect(saveBtn().disabled).toBe(true); // 没改

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '改过的原文');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(saveBtn().disabled).toBe(false);

    await click(saveBtn());
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]![1].script?.updatedAt).not.toBe(p.script.updatedAt); // 内容变了 → 更新时刻前进
    expect(saveBtn().disabled).toBe(true); // 保存成功：同一轮就变回不可点，不用等到下一次别的原因触发的渲染
  });
});
