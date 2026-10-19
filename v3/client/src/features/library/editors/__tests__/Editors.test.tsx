/**
 * 条目表单（EntryEditor）与角色卡编辑器（CardEditor）渲染测试：
 * 位置字段联动 + chips 输入 / 备用开场白增删 / PATCH body（整体 card + 同步壳 name）。
 * apiFetch 模块级 mock，不触网；世界书编辑器用例见 WorldbookEditor.test.tsx。
 */
import { useState } from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { TavernWorldInfoEntry } from '@shared/tavern';

import { apiFetch } from '../../../../api/client';
import CardEditor from '../CardEditor';
import EntryEditor from '../EntryEditor';
import {
  cardFixture, clickEl, fieldByLabel, makeEntry, mountPlain, setInputValue, unmountAll,
} from './helpers';

vi.mock('../../../../api/client', () => ({ apiFetch: vi.fn() }));

const apiFetchMock = apiFetch as unknown as Mock;

/** EntryEditor 受控包装：表单变更直接回写 entry（模拟父级 WorldbookEditor 行为） */
function StatefulEntryEditor({ initial }: { initial: TavernWorldInfoEntry }) {
  const [entry, setEntry] = useState(initial);
  return <EntryEditor entry={entry} onChange={(patch) => setEntry((e) => ({ ...e, ...patch }))} />;
}

/** 挂载角色卡编辑器；PATCH 请求记录进 patchCalls */
async function mountCard(): Promise<{ container: HTMLElement; patchCalls: Array<Record<string, unknown>> }> {
  const patchCalls: Array<Record<string, unknown>> = [];
  apiFetchMock.mockImplementation(async (path: string, opts?: { method?: string; body?: string }) => {
    if (path === '/api/characters/c1' && opts?.method === 'PATCH') {
      patchCalls.push(JSON.parse(opts.body!) as Record<string, unknown>);
      return cardFixture();
    }
    if (path === '/api/characters/c1') return cardFixture();
    throw new Error(`未预期的请求：${opts?.method ?? 'GET'} ${path}`);
  });
  const container = await mountPlain(
    <CardEditor characterId="c1" notify={() => undefined} onClose={() => undefined} onSaved={() => undefined} />,
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

describe('EntryEditor', () => {
  it('字段联动：仅 position=按深度注入 时显示注入深度与消息角色', async () => {
    const container = await mountPlain(<StatefulEntryEditor initial={makeEntry({ position: 0 })} />);

    expect(fieldByLabel(container, '注入深度')).toBeNull();
    expect(fieldByLabel(container, '消息角色')).toBeNull();

    // 切换插入位置 → 深度字段出现
    const positionSelect = fieldByLabel<HTMLSelectElement>(container, '插入位置')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(positionSelect, '4');
      positionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(fieldByLabel(container, '注入深度')).not.toBeNull();
    const roleSelect = fieldByLabel<HTMLSelectElement>(container, '消息角色');
    expect(roleSelect?.value).toBe('0'); // system
  });

  it('chips 输入：回车提交、中文逗号切分、× 删除、Backspace 删尾', async () => {
    const container = await mountPlain(<StatefulEntryEditor initial={makeEntry({ key: ['主人'] })} />);
    const chips = () => container.querySelector('[data-testid="chips-key"]')!;
    const chipValues = () => [...chips().querySelectorAll('[data-chip]')].map((c) => c.getAttribute('data-chip'));
    const typeAndEnter = async (text: string) => {
      await setInputValue(chips().querySelector('input')!, text);
      await act(async () => {
        chips().querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
    };

    // 回车提交「女仆」
    await typeAndEnter('女仆');
    expect(chipValues()).toEqual(['主人', '女仆']);

    // 中文逗号切分：一次提交两个 chip
    await typeAndEnter('魔法,森林');
    expect(chipValues()).toEqual(['主人', '女仆', '魔法', '森林']);

    // 点 × 删除「主人」
    await clickEl(chips().querySelector('button[aria-label="删除键 主人"]')!);
    expect(chipValues()).toEqual(['女仆', '魔法', '森林']);

    // Backspace 删尾
    await act(async () => {
      chips().querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    });
    expect(chipValues()).toEqual(['女仆', '魔法']);
  });
});

describe('CardEditor', () => {
  it('备用开场白：渲染既有条目、添加、删除', async () => {
    const { container, patchCalls } = await mountCard();

    expect(container.querySelectorAll('[data-testid="alternate-greeting"]').length).toBe(1);
    expect(
      (container.querySelector('[data-testid="alternate-greeting"] textarea') as HTMLTextAreaElement).value,
    ).toBe('第一条备用问候');

    // 添加 → 2 条
    await clickEl(container.querySelector('[data-testid="greeting-add"]')!);
    expect(container.querySelectorAll('[data-testid="alternate-greeting"]').length).toBe(2);

    // 删除第 1 条 → 剩 1 条
    await clickEl(container.querySelector('button[aria-label="删除备用开场白 1"]')!);
    const rest = [...container.querySelectorAll('[data-testid="alternate-greeting"] textarea')];
    expect(rest.length).toBe(1);
    expect((rest[0] as HTMLTextAreaElement).value).toBe('');

    // 增删不自动发请求
    expect(patchCalls).toHaveLength(0);
  });

  it('保存：改 description 后 PATCH body 携带整体 card + 同步壳层 name；depth_prompt 回显', async () => {
    const { container, patchCalls } = await mountCard();

    // 深度人设回显
    expect(fieldByLabel<HTMLInputElement>(container, '深度')?.value).toBe('4');
    expect(fieldByLabel<HTMLTextAreaElement>(container, '内容')?.value).toBe('深处补充');

    await setInputValue(fieldByLabel<HTMLTextAreaElement>(container, '人设描述')!, '龙裔牧师·改');
    await clickEl(container.querySelector('[data-testid="editor-save"]')!);
    await act(async () => {});

    expect(patchCalls).toHaveLength(1);
    const body = patchCalls[0] as { card: ReturnType<typeof cardFixture>['card']; name: string };
    expect(body.name).toBe('Seraphina');
    expect(body.card.data.description).toBe('龙裔牧师·改');
    // 未编辑字段原样保留
    expect(body.card.data.alternate_greetings).toEqual(['第一条备用问候']);
    expect(body.card.data.extensions?.depth_prompt?.prompt).toBe('深处补充');
  });
});
