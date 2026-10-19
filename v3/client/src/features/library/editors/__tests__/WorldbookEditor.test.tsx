/**
 * 世界书编辑器渲染测试：列表渲染（常驻灯/order/停用置灰）+ uid 交换排序 /
 * 新建条目默认值 / PATCH 整体 raw。apiFetch 模块级 mock，不触网。
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { WorldbookAsset } from '@shared/worldbook';

import { apiFetch } from '../../../../api/client';
import WorldbookEditor from '../WorldbookEditor';
import { clickEl, fieldByLabel, mountPlain, setInputValue, unmountAll, worldbookFixture } from './helpers';

vi.mock('../../../../api/client', () => ({ apiFetch: vi.fn() }));

const apiFetchMock = apiFetch as unknown as Mock;

/** 挂载世界书编辑器；PATCH 请求记录进 patchCalls */
async function mountWorldbook(): Promise<{ container: HTMLElement; patchCalls: Array<Record<string, unknown>> }> {
  const patchCalls: Array<Record<string, unknown>> = [];
  apiFetchMock.mockImplementation(async (path: string, opts?: { method?: string; body?: string }) => {
    if (path === '/api/worldbooks/wb1' && opts?.method === 'PATCH') {
      patchCalls.push(JSON.parse(opts.body!) as Record<string, unknown>);
      return worldbookFixture();
    }
    if (path === '/api/worldbooks/wb1') return worldbookFixture();
    throw new Error(`未预期的请求：${opts?.method ?? 'GET'} ${path}`);
  });
  const container = await mountPlain(
    <WorldbookEditor worldbookId="wb1" notify={() => undefined} onClose={() => undefined} onSaved={() => undefined} />,
  );
  await act(async () => {}); // flush 异步加载
  return { container, patchCalls };
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

afterEach(async () => {
  await unmountAll();
});

describe('WorldbookEditor', () => {
  it('列表渲染：uid 升序 / 常驻灯 / order 值 / 停用置灰；上移交换相邻 uid', async () => {
    const { container } = await mountWorldbook();

    const rows = () => [...container.querySelectorAll('[data-entry-row]')];
    expect(rows().map((r) => r.getAttribute('data-entry-row'))).toEqual(['0', '1', '2']);
    // 常驻灯只在 constant 条目上
    expect(rows()[1]!.querySelector('[data-constant="true"]')).not.toBeNull();
    expect(rows()[0]!.querySelector('[data-constant="true"]')).toBeNull();
    // order 值渲染 + 停用条目置灰
    expect(rows()[0]!.textContent).toContain('100');
    expect(rows()[2]!.className).toContain('opacity-50');

    // shadowfang(uid=1) 上移 → 与 eldoria 交换 uid：列表仍按 uid 升序，内容顺序互换
    await clickEl(rows()[1]!.querySelector('button[aria-label="上移 shadowfang"]')!);
    expect(rows().map((r) => r.getAttribute('data-entry-row'))).toEqual(['0', '1', '2']);
    expect(rows().map((r) => r.getAttribute('data-entry-comment'))).toEqual(['shadowfang', 'eldoria', '']);
  });

  it('新建条目：uid 取 max+1、默认值对齐酒馆模板（order=100/probability=100/常驻关/位置 char 前）', async () => {
    const { container } = await mountWorldbook();

    await clickEl(container.querySelector('[data-testid="entry-create"]')!);

    expect([...container.querySelectorAll('[data-entry-row]')].map((r) => r.getAttribute('data-entry-row'))).toEqual([
      '0', '1', '2', '3',
    ]);
    expect(container.textContent).toContain('编辑条目 #3');

    expect(fieldByLabel<HTMLInputElement>(container, '顺序 order')?.value).toBe('100');
    expect(fieldByLabel<HTMLInputElement>(container, '触发概率')?.value).toBe('100');
    expect(fieldByLabel<HTMLSelectElement>(container, '插入位置')?.value).toBe('0');
    expect(fieldByLabel<HTMLInputElement>(container, '常驻条目')?.checked).toBe(false);
    expect(fieldByLabel<HTMLInputElement>(container, '禁用条目')?.checked).toBe(false);
    // 可选覆盖默认「跟随全局」（null）
    expect(fieldByLabel<HTMLSelectElement>(container, '区分大小写')?.value).toBe('');
    // 主键 chips 为空
    expect(container.querySelector('[data-testid="chips-key"] [data-chip]')).toBeNull();
  });

  it('保存：改备注 + 加主键后 PATCH 整体 raw；初始保存按钮禁用', async () => {
    const { container, patchCalls } = await mountWorldbook();

    const saveBtn = container.querySelector<HTMLButtonElement>('[data-testid="editor-save"]')!;
    expect(saveBtn.disabled).toBe(true); // 未修改不可保存

    // 改备注名（默认选中第一条 uid=0）
    await setInputValue(fieldByLabel<HTMLInputElement>(container, '备注名')!, '新备注');
    // 加主键
    const keyInput = container.querySelector('[data-testid="chips-key"] input')!;
    await setInputValue(keyInput as HTMLInputElement, '森林');
    await act(async () => {
      keyInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(saveBtn.disabled).toBe(false);
    await clickEl(saveBtn);
    await act(async () => {});

    expect(patchCalls).toHaveLength(1);
    const raw = patchCalls[0]!.raw as WorldbookAsset['raw'];
    expect(raw.entries['0']!.comment).toBe('新备注');
    // 主键为追加语义（夹具原带 eldoria）
    expect(raw.entries['0']!.key).toEqual(['eldoria', '森林']);
    // 未编辑的条目原样保留
    expect(raw.entries['1']!.constant).toBe(true);
  });

  it('条目启停：列表行 checkbox 翻转 disable 且不自动发请求', async () => {
    const { container, patchCalls } = await mountWorldbook();
    const checkbox = () => container.querySelector<HTMLInputElement>('[data-entry-row="0"] input[type="checkbox"]')!;
    expect(checkbox().checked).toBe(true);

    await clickEl(checkbox());

    expect(checkbox().checked).toBe(false);
    // 停用行置灰
    expect(container.querySelector('[data-entry-row="0"]')!.className).toContain('opacity-50');
    expect(patchCalls).toHaveLength(0);
  });
});
