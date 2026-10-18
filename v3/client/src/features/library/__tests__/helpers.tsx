/**
 * 编辑器测试共享工具：渲染/事件原语 + 资产夹具（世界书与卡两组测试文件共用）
 * 仅测试代码使用；apiFetch 的 vi.mock 因 hoisting 语义须在各测试文件顶层声明。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TavernWorldInfoEntry } from '@shared/tavern';
import type { CharacterAsset } from '@shared/card';
import type { WorldbookAsset } from '@shared/worldbook';

// React 19 act 环境声明（与 LibraryPage.test 同款就地声明）
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

/** 卸载全部活动根（各测试文件 afterEach 调用） */
export async function unmountAll(): Promise<void> {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
}

/** 挂载无路由包裹组件 */
export async function mountPlain(ui: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(ui);
  });
  return container;
}

/** 触发点击（act 包裹） */
export const clickEl = (el: Element) =>
  act(async () => {
    (el as HTMLElement).click();
  });

/** 模拟受控输入（原生 value setter + input 事件，兼容 React 合成系统） */
export const setInputValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

/** 按 label 文本找 label 包裹的表单控件（调用处指定期望元素类型） */
export function fieldByLabel<T extends HTMLElement>(container: HTMLElement, text: string): T | null {
  const label = [...container.querySelectorAll('label')].find((l) => l.textContent?.includes(text));
  return (label?.querySelector('input, select, textarea') as T | null) ?? null;
}

// ---------- 夹具 ----------

/** 条目夹具（只声明编辑器关心的字段） */
export function makeEntry(patch: Partial<TavernWorldInfoEntry>): TavernWorldInfoEntry {
  return { uid: 0, key: [], keysecondary: [], comment: '', content: '', ...patch };
}

export function worldbookFixture(): WorldbookAsset {
  return {
    id: 'wb1',
    name: 'Eldoria',
    raw: {
      entries: {
        '0': makeEntry({ uid: 0, key: ['eldoria'], comment: 'eldoria', content: '世界设定A', order: 100 }),
        '1': makeEntry({ uid: 1, key: ['shadowfang'], comment: 'shadowfang', content: '暗影之牙', constant: true, order: 50 }),
        '2': makeEntry({ uid: 2, key: ['tower'], comment: '', content: '无名高塔', disable: true, order: 75, position: 4, depth: 2, role: 1 }),
      },
    },
  };
}

export function cardFixture(): CharacterAsset {
  return {
    id: 'c1',
    name: 'Seraphina',
    card: {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Seraphina',
        description: '龙裔牧师',
        alternate_greetings: ['第一条备用问候'],
        extensions: { depth_prompt: { prompt: '深处补充', depth: 4, role: 'system' } },
      },
    },
  };
}
