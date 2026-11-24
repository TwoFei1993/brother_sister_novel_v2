/**
 * ScriptPane「一键转短剧后自动拆解」测试（生产实测 2026-11-24 抓出的 bug）：
 * 剧本文字同步（setText）与自动触发在同一次提交里先后执行，自动触发拿到的 text 还是空串，
 * runBreakdown 按「剧本为空」直接返回并清掉一次性标志——表现为转短剧后永远不自动拆解。
 * useBgLlmTask / runBreakdownPipeline 模块级 mock：只验证「是否自动发起拆解任务」。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { newDuanjuProject, type DuanjuProject } from '@shared/duanju';

import { useDuanjuStore } from '../../store';
import ScriptPane from '../ScriptPane';

const submitMock = vi.fn();
vi.mock('../../../../hooks/useBgLlmTask', () => ({
  useBgLlmTask: () => ({ state: null, submit: submitMock, resume: vi.fn(), clear: vi.fn() }),
}));
vi.mock('../../lib/duanju-pipeline', () => ({ runBreakdownPipeline: vi.fn() }));

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

async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error('missing element');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  submitMock.mockReset();
  sessionStorage.clear();
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
    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(KEY)).toBeNull();
    const body = submitMock.mock.calls[0]![0] as { label: string; messages: Array<{ content: string }> };
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
    expect(submitMock).toHaveBeenCalledTimes(1);
  });

  it('没有转换标志 → 不自动触发', async () => {
    await mountThenDeliver(projectFixture());
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('已有分集（拆解过）→ 不重复拆解，标志清除', async () => {
    sessionStorage.setItem(KEY, '1');
    const ep = { id: 'ep-1', index: 1, title: '第一集', synopsis: '到镇上' };
    await mountThenDeliver(projectFixture({ episodes: [ep] }));
    expect(submitMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('剧本未定稿 → 不自动触发，标志清除', async () => {
    sessionStorage.setItem(KEY, '1');
    const p = projectFixture();
    await mountThenDeliver({ ...p, script: { ...p.script, confirmed: false } });
    expect(submitMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('手动点「AI 拆解」按钮仍可发起（回归）', async () => {
    const container = await mountThenDeliver(projectFixture());
    const btn = container.querySelector('[data-testid="script-breakdown"]');
    await click(btn);
    expect(submitMock).toHaveBeenCalledTimes(1);
  });
});
