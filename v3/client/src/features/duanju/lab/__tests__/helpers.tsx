/**
 * 试验台组件测试的公共夹具与 DOM 工具（各测试文件共用）。
 * 接口的 mock 必须在各测试文件里自己声明——vi.mock 只对声明它的文件生效。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { DuanjuCharacter, DuanjuScene } from '@shared/duanju';
import type { LabRecord, LabRef } from '@shared/duanju/lab';

import LabPane from '../LabPane';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const REF_PATH = 'duanju/images/labref-0f3a9c1e-7b2d-4e6f-8a9b-000000000001.png';
export const ref: LabRef = { path: REF_PATH, caption: '底图：客厅夜景' };

export const record: LabRecord = {
  id: 'lab-1',
  createdAt: 1,
  brief: '雨夜女剑客',
  prompt: '电影感单帧：雨夜霓虹街头……',
  kind: 'free',
  provider: 'comfy',
  aspect: '9:16',
  width: 768,
  height: 1344,
  seed: 42,
  refs: [],
  characterIds: [],
  sceneIds: [],
  image: { id: 'img-1', path: 'duanju/images/a.png', prompt: '电影感单帧', createdAt: 1 },
  elapsedSec: 91,
};

export const character: DuanjuCharacter = {
  id: 'c1',
  name: '沈青鸾',
  profile: '白上衣青绿百褶裙，长发高马尾',
  sheetImages: [{ id: 'si1', path: 'duanju/images/c1-sheet.png', prompt: '', createdAt: 1 }],
  updatedAt: 1,
};

export const scene: DuanjuScene = { id: 's1', name: '兰若寺', spec: '古寺夜雨，青灯', images: [], updatedAt: 1 };

const roots: Root[] = [];

export async function mount(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<LabPane workId="w1" />);
  });
  await flush();
  return container;
}

export async function unmountAll(): Promise<void> {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
}

export const el = (c: HTMLElement, testid: string): HTMLElement => {
  const found = c.querySelector(`[data-testid="${testid}"]`);
  if (!found) throw new Error(`missing ${testid}`);
  return found as HTMLElement;
};

export const text = (c: HTMLElement, testid: string): string => el(c, testid).textContent ?? '';

export async function click(c: HTMLElement, testid: string): Promise<void> {
  const target = el(c, testid);
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 受控输入框：原生 value setter 绕过 tracker 后派发 input */
export async function type(c: HTMLElement, testid: string, value: string): Promise<void> {
  const target = el(c, testid) as HTMLTextAreaElement | HTMLInputElement;
  const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 文件选择框：塞进一个文件后派发 change */
export async function pickFile(c: HTMLElement, file: File): Promise<void> {
  const input = c.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('missing file input');
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

/** 「从本作品选」下拉：选中第 index 个候选 */
export async function pickOption(c: HTMLElement, index: number): Promise<void> {
  const select = el(c, 'lab-ref-pick') as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, String(index));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

export const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
