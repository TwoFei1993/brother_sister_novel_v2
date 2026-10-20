/**
 * SheetImportPanel 批量导入测试（jsdom + createRoot，与项目组件测试约定一致）
 *
 * 覆盖（深度测试报告缺陷「批量导入失败重试产生重复卡」配套前端回归）：
 * - 部分失败：汇总报告展示失败名单，出现「重试失败项（N）」按钮，不触发父级跳转
 * - 重试仅补失败项：重发请求只含失败条目（服务端同名幂等兜底重复卡）
 * - 重试全成功：onFinished 以空 failed 回调（父级可安全跳转）
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SheetImportPanel from '../wizard/SheetImportPanel';
import type { SheetDocument } from '../../../lib/outline/sheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sheetOf(names: string[]): SheetDocument {
  return {
    entries: names.map((name) => ({
      name,
      identity: '测试身份',
      group: '第一部分',
      description: `${name}的独有描述，性格鲜明。`,
    })),
    meta: { negative: '', template: '' },
  };
}

type PostLog = { path: string; body: { name?: string } };
let posts: PostLog[] = [];
/** failNames：命中名单的 POST 返回 500，其余 201 */
function stubFetch(failNames: string[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { name?: string };
      posts.push({ path, body });
      if (failNames.includes(body.name ?? '')) {
        return new Response(JSON.stringify({ error: '服务器内部错误' }), { status: 500 });
      }
      return new Response(JSON.stringify({ id: `id-${body.name}` }), { status: 201 });
    }),
  );
}

async function clickButton(container: HTMLElement, testId: string): Promise<void> {
  const btn = container.querySelector(`[data-testid="${testId}"]`);
  if (!btn) throw new Error(`missing button: ${testId}`);
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('SheetImportPanel（批量导入部分失败与重试）', () => {
  const roots: Root[] = [];

  beforeEach(() => {
    posts = [];
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await act(async () => {
      for (const r of roots) r.unmount();
    });
    roots.length = 0;
    document.body.innerHTML = '';
  });

  it('部分失败：报告失败名单 + 出现重试按钮 + 不回调 onFinished（父级不跳转）', async () => {
    stubFetch(['乙']);
    let finished: { ok: number; failed: string[] } | null = null;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <SheetImportPanel sheet={sheetOf(['甲', '乙', '丙'])} onFinished={(ok, failed) => (finished = { ok, failed })} />,
      );
    });
    await clickButton(container, 'import-cards-btn');
    expect(posts.filter((p) => p.path === '/api/characters')).toHaveLength(3); // 首轮 3 条全发
    expect(container.textContent).toContain('失败：乙');
    const retryBtn = container.querySelector('[data-testid="retry-failed-btn"]');
    expect(retryBtn?.textContent).toContain('重试失败项（1）');
    expect(finished).toBeNull(); // 有失败项不触发父级完成回调
  });

  it('重试仅补失败项：重发请求只含失败条目，全成功后 onFinished(ok, [])', async () => {
    stubFetch(['乙']);
    const finishedList: Array<{ ok: number; failed: string[] }> = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <SheetImportPanel sheet={sheetOf(['甲', '乙', '丙'])} onFinished={(ok, failed) => finishedList.push({ ok, failed })} />,
      );
    });
    await clickButton(container, 'import-cards-btn');
    // 重试轮：上游恢复（失败名单清空）
    stubFetch([]);
    await clickButton(container, 'retry-failed-btn');
    const all = posts.filter((p) => p.path === '/api/characters');
    expect(all).toHaveLength(4); // 首轮 3 + 重试 1（不重发已成功的甲/丙）
    expect(all[3]!.body.name).toBe('乙'); // 重发的正是失败项
    expect(finishedList).toEqual([{ ok: 1, failed: [] }]); // 重试全成功 → 父级可跳转
  });
});
