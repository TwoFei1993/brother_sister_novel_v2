/**
 * OutlineWizard 草稿持久化测试（深度测试 D9 回归：向导页刷新后粘贴内容丢失）
 *
 * - 输入即写 localStorage（v3-wizard-draft）
 * - 重新挂载（模拟刷新）：普通大纲恢复文本；编号展板恢复批量导入模式
 * - 空输入清空草稿
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import OutlineWizard from '../OutlineWizard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

async function mountWizard(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/wizard']}>
        <OutlineWizard />
      </MemoryRouter>,
    );
  });
  return container;
}

async function typeOutline(container: HTMLElement, text: string): Promise<void> {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="大纲文本"]');
  if (!textarea) throw new Error('missing outline textarea');
  // React 受控组件：原生 setter 绕过 value tracker 后派发 input 事件
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const SHEET_TEXT = ['01. 甲｜身份一', '正向 prompt：', '甲的描述。', '', '02. 乙｜身份二', '正向 prompt：', '乙的描述。', '', '03. 丙｜身份三', '正向 prompt：', '丙的描述。'].join('\n');

describe('OutlineWizard（D9 草稿持久化）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots) root.unmount();
    });
    roots.length = 0;
    document.body.innerHTML = '';
  });

  it('输入即写 localStorage；空输入清空草稿', async () => {
    const c = await mountWizard();
    await typeOutline(c, '一段大纲内容');
    expect(localStorage.getItem('v3-wizard-draft')).toBe('一段大纲内容');
    await typeOutline(c, '');
    expect(localStorage.getItem('v3-wizard-draft')).toBe('');
  });

  it('重新挂载（模拟刷新）：普通大纲文本恢复', async () => {
    const first = await mountWizard();
    await typeOutline(first, '灵气复苏的大周王朝，兄妹踏上修行路。');
    await act(async () => {
      for (const root of roots) root.unmount();
    });
    roots.length = 0;
    document.body.innerHTML = '';
    const second = await mountWizard();
    const textarea = second.querySelector<HTMLTextAreaElement>('textarea[aria-label="大纲文本"]');
    expect(textarea?.value).toBe('灵气复苏的大周王朝，兄妹踏上修行路。');
  });

  it('批量展板草稿刷新后恢复批量导入模式（已识别人设展板提示可见）', async () => {
    const first = await mountWizard();
    await typeOutline(first, SHEET_TEXT);
    expect(first.textContent).toContain('已识别批量人设展板');
    await act(async () => {
      for (const root of roots) root.unmount();
    });
    roots.length = 0;
    document.body.innerHTML = '';
    const second = await mountWizard();
    expect(second.textContent).toContain('已识别批量人设展板'); // sheet 模式随草稿恢复
    expect(second.querySelector<HTMLTextAreaElement>('textarea[aria-label="大纲文本"]')?.value).toBe(SHEET_TEXT);
  });
});
