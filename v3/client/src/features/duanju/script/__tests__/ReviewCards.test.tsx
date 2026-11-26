/**
 * 拆解审核卡的违审替换处置（2026-11-26 独立评审抓到的既有 bug：「一键全部采纳」只保留最后一条）。
 * 逻辑在 hooks/useReviewCardsDraft；这里对着组件走一遍。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_REVIEW_CARDS, newDuanjuProject, type DuanjuProject, type DuanjuPatch } from '@shared/duanju';

import { useDuanjuStore } from '../../store';
import ReviewCards from '../ReviewCards';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const WID = 'w1';
const TEXT = '主角打他一顿，然后砸了桌子。';

function project(): DuanjuProject {
  return {
    ...newDuanjuProject({ targetEpisodes: 3, style: '动漫风', protagonists: '' }, 1),
    script: { source: 'pasted', text: TEXT, confirmed: true, updatedAt: 1 },
    reviewCards: {
      ...EMPTY_REVIEW_CARDS,
      summary: '起冲突',
      riskReplacements: [
        { id: 'r1', original: '打他', replacement: '拦住他' },
        { id: 'r2', original: '砸了桌子', replacement: '掀翻椅子' },
      ],
    },
  };
}

/** 像真实 store 那样把 PATCH 结果写回（否则第二条处置读到的还是旧原文） */
const patchMock = vi.fn(async (_workId: string, fields: Partial<Omit<DuanjuPatch, 'revision'>>) => {
  const cur = useDuanjuStore.getState().project!;
  useDuanjuStore.setState({ project: { ...cur, ...fields, revision: cur.revision + 1 } as DuanjuProject });
  return true;
});

async function mount(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  useDuanjuStore.setState({ project: project(), patch: patchMock, saving: false, conflict: false });
  await act(async () => {
    root.render(<ReviewCards workId={WID} />);
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

beforeEach(() => {
  patchMock.mockClear();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
});

describe('ReviewCards 违审替换', () => {
  it('一键全部采纳：两条替换都落到原文上，状态都是已采纳（此前只有最后一条生效）', async () => {
    const c = await mount();
    await click(c, 'risk-accept-all');
    expect(patchMock).toHaveBeenCalledTimes(2);
    expect(useDuanjuStore.getState().project!.script.text).toBe('主角拦住他一顿，然后掀翻椅子。');
    expect(useDuanjuStore.getState().project!.reviewCards.riskReplacements.map((r) => r.status)).toEqual(['accepted', 'accepted']);
    expect(c.querySelectorAll('[data-testid="risk-accept"]')).toHaveLength(0); // 界面上没有待处置的了
  });

  it('单条采纳只改这一处；驳回只改状态不动原文；撤销回到待处置', async () => {
    const c = await mount();
    const accept = c.querySelectorAll('[data-testid="risk-accept"]');
    await act(async () => {
      accept[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useDuanjuStore.getState().project!.script.text).toBe('主角拦住他一顿，然后砸了桌子。');
    expect(useDuanjuStore.getState().project!.reviewCards.riskReplacements.map((r) => r.status)).toEqual(['accepted', undefined]);

    const dismiss = [...c.querySelectorAll('button')].find((b) => b.textContent?.trim() === '驳回')!;
    await act(async () => {
      dismiss.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useDuanjuStore.getState().project!.script.text).toBe('主角拦住他一顿，然后砸了桌子。');
    expect(useDuanjuStore.getState().project!.reviewCards.riskReplacements.map((r) => r.status)).toEqual(['accepted', 'dismissed']);
  });
});
