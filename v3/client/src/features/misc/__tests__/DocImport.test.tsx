/**
 * DocImport（向导「导入 Word」）测试：
 * - .docx 走服务端提取成功 → onText 回填 + 文件名展示
 * - .txt 浏览器直读，不调服务端
 * - 已有内容且 confirm 取消 → 不覆盖不请求
 * - 解析失败 / 不支持的类型 → 人话错误
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DocImport from '../wizard/DocImport';
import { extractDocx } from '../../../api/extract';

vi.mock('../../../api/extract', () => ({ extractDocx: vi.fn() }));

const extractDocxMock = vi.mocked(extractDocx);

// jsdom 未实现 Blob.text()（真实浏览器原生支持）：测试内用 FileReader 兜底
if (typeof Blob.prototype.text !== 'function') {
  Object.defineProperty(Blob.prototype, 'text', {
    writable: true,
    configurable: true,
    value: function (this: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('读取失败'));
        reader.readAsText(this);
      });
    },
  });
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

async function mountImport(props: { hasContent: boolean; onText: (t: string) => void }): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<DocImport hasContent={props.hasContent} onText={props.onText} />);
  });
  return container;
}

/** 模拟选择文件：jsdom 无法构造 FileList，defineProperty 注入后派发 change */
async function chooseFile(container: HTMLElement, file: File): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('missing file input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // jsdom 的 File.text() 跨宏任务 resolve，act 单轮 flush 不够，补一轮定时器边界
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('DocImport（向导导入 Word）', () => {
  it('docx 上传成功 → onText 收到提取文本 + 文件名展示', async () => {
    extractDocxMock.mockResolvedValue({ text: '沈清晏立于廊下。\n第1章 入府', chars: 15 });
    const onText = vi.fn();
    const c = await mountImport({ hasContent: false, onText });
    expect(c.textContent).toContain('导入 Word');
    await chooseFile(c, new File([new Uint8Array([0x50, 0x4b])], '大纲.docx'));
    expect(onText).toHaveBeenCalledWith('沈清晏立于廊下。\n第1章 入府');
    expect(c.textContent).toContain('已导入：大纲.docx');
  });

  it('.txt 浏览器直读，不调服务端', async () => {
    const onText = vi.fn();
    const c = await mountImport({ hasContent: false, onText });
    await chooseFile(c, new File(['灵气复苏的大周王朝。'], '大纲.txt', { type: 'text/plain' }));
    expect(onText).toHaveBeenCalledWith('灵气复苏的大周王朝。');
    expect(extractDocxMock).not.toHaveBeenCalled();
  });

  it('已有内容且 confirm 取消 → 不覆盖不请求', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onText = vi.fn();
    const c = await mountImport({ hasContent: true, onText });
    await chooseFile(c, new File([new Uint8Array([0x50, 0x4b])], 'another.docx'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
    expect(extractDocxMock).not.toHaveBeenCalled();
  });

  it('服务端解析失败 → 展示人话错误', async () => {
    extractDocxMock.mockRejectedValue(new Error('无法从该 Word 文档提取文字，请确认是有效的 .docx 文件'));
    const onText = vi.fn();
    const c = await mountImport({ hasContent: false, onText });
    await chooseFile(c, new File([Buffer.from('not a zip')], 'fake.docx'));
    expect(onText).not.toHaveBeenCalled();
    expect(c.textContent).toContain('无法从该 Word 文档提取文字');
  });

  it('不支持的文件类型 → 提示仅支持 .docx/.txt', async () => {
    const onText = vi.fn();
    const c = await mountImport({ hasContent: false, onText });
    await chooseFile(c, new File(['%PDF'], 'doc.pdf'));
    expect(c.textContent).toContain('仅支持 .docx 或 .txt 文件');
  });
});
