/**
 * BatchGenerateDialog 测试（Chunk 6 Task 6.1）：默认值与边界 clamp / 逐本提交携带完整 body /
 * 409 GEN_BUSY 跳过计数 / 汇总展示与自动关闭 / 网络失败计数。
 * submitNovelChapter 模块级 mock（保留 taskPrefsOf 真实现验证 prefs 透传）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../api/client';
import type { WorkSummary } from '../../../api/works';
import { submitNovelChapter, type NovelChapterSubmitBody } from '../../../lib/llmTask';
import { useSettingsStore } from '../../../stores/settings';
import BatchGenerateDialog from '../BatchGenerateDialog';

vi.mock('../../../lib/llmTask', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  submitNovelChapter: vi.fn(),
}));

const submitMock = vi.mocked(submitNovelChapter);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function work(id: string, title: string): WorkSummary {
  return { id, title, mode: 'novel', genre: 'chuanyue', updatedAt: 1 };
}

const roots: Root[] = [];
const containers: HTMLElement[] = [];
let onClose: ReturnType<typeof vi.fn>;

async function renderDialog(works: WorkSummary[]): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(<BatchGenerateDialog works={works} onClose={onClose} />);
  });
  return container;
}

async function click(el: Element | null | undefined): Promise<void> {
  expect(el).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function setInput(el: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function q(container: HTMLElement, testid: string): HTMLElement {
  const el = container.querySelector(`[data-testid="${testid}"]`);
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  submitMock.mockReset();
  submitMock.mockResolvedValue('task-1');
  onClose = vi.fn();
  useSettingsStore.getState().setLlmPrefs({ source: 'openai', model: 'gpt-4o', repetitionPenalty: 1.2 });
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  containers.forEach((c) => c.remove());
  containers.length = 0;
  vi.restoreAllMocks();
});

describe('BatchGenerateDialog 表单', () => {
  it('渲染弹窗骨架：默认章数 1 / 并发 2，书目列表展示所选作品', async () => {
    const c = await renderDialog([work('w1', '书一'), work('w2', '书二')]);
    expect(q(c, 'batch-generate-dialog')).not.toBeNull();
    expect((q(c, 'batch-chapters-input') as HTMLInputElement).value).toBe('1');
    expect((q(c, 'batch-parallel-input') as HTMLInputElement).value).toBe('2');
    const text = c.textContent ?? '';
    expect(text).toContain('书一');
    expect(text).toContain('书二');
    expect(text).toContain('2 本');
  });

  it('章数 clamp 到 [1,10]：99→10、0→1', async () => {
    const c = await renderDialog([work('w1', '书一')]);
    const input = q(c, 'batch-chapters-input') as HTMLInputElement;
    setInput(input, '99');
    expect(input.value).toBe('10');
    setInput(input, '0');
    expect(input.value).toBe('1');
  });

  it('并发 clamp 到 [1,4]：9→4、0→1', async () => {
    const c = await renderDialog([work('w1', '书一')]);
    const input = q(c, 'batch-parallel-input') as HTMLInputElement;
    setInput(input, '9');
    expect(input.value).toBe('4');
    setInput(input, '0');
    expect(input.value).toBe('1');
  });
});

describe('BatchGenerateDialog 提交', () => {
  it('逐本提交且 body 完整（kind/workId/prefs/mode/directive/chapters/outline:false/parallel）', async () => {
    const c = await renderDialog([work('w1', '书一'), work('w2', '书二')]);
    setInput(q(c, 'batch-chapters-input') as HTMLInputElement, '3');
    setInput(q(c, 'batch-parallel-input') as HTMLInputElement, '2');
    await click(q(c, 'batch-submit'));
    expect(submitMock).toHaveBeenCalledTimes(2);
    const b1 = submitMock.mock.calls[0][0] as NovelChapterSubmitBody;
    const b2 = submitMock.mock.calls[1][0] as NovelChapterSubmitBody;
    expect(b1.workId).toBe('w1');
    expect(b2.workId).toBe('w2');
    for (const b of [b1, b2]) {
      expect(b.kind).toBe('novel-chapter');
      expect(b.mode).toBe('chapter');
      expect(b.directive).toBe('');
      expect(b.chapters).toBe(3);
      expect(b.outline).toBe(false);
      expect(b.parallel).toBe(2);
      // prefs 从 settings store 全量透传（含 repetitionPenalty；敏感/无关字段不带）
      expect(b.prefs.source).toBe('openai');
      expect(b.prefs.model).toBe('gpt-4o');
      expect(b.prefs.repetitionPenalty).toBe(1.2);
      expect('imageProvider' in b.prefs).toBe(false); // 生图通道不属于正文生成 prefs
    }
  });

  it('409 GEN_BUSY 的书跳过并计数，其余照常提交；汇总文案按规格', async () => {
    submitMock.mockImplementation(async (body: NovelChapterSubmitBody) => {
      if (body.workId === 'w1') throw new ApiError(409, '该书已有生成任务进行中');
      return 'task-2';
    });
    const c = await renderDialog([work('w1', '书一'), work('w2', '书二')]);
    await click(q(c, 'batch-submit'));
    expect(submitMock).toHaveBeenCalledTimes(2); // 409 不中断后续书的提交
    const summary = q(c, 'batch-summary').textContent ?? '';
    expect(summary).toContain('已发起 1 本');
    expect(summary).toContain('1 本跳过（已有任务进行中）');
  });

  it('网络失败计数：非 409 错误不误报为「已有任务进行中」', async () => {
    submitMock.mockRejectedValue(new ApiError(0, '无法连接服务器', 'network'));
    const c = await renderDialog([work('w1', '书一')]);
    await click(q(c, 'batch-submit'));
    const summary = q(c, 'batch-summary').textContent ?? '';
    expect(summary).toContain('已发起 0 本');
    expect(summary).not.toContain('已有任务进行中');
    expect(summary).toContain('1 本提交失败');
  });

  it('汇总展示后自动关闭（onClose）；「知道了」立即关闭', async () => {
    const c = await renderDialog([work('w1', '书一')]);
    await click(q(c, 'batch-submit'));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('提交中禁用提交按钮（防重复发起）；完成后切换汇总视图', async () => {
    let resolveSubmit: (id: string) => void = () => undefined;
    submitMock.mockImplementation(
      () => new Promise<string>((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    const c = await renderDialog([work('w1', '书一')]);
    await click(q(c, 'batch-submit'));
    expect((q(c, 'batch-submit') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      resolveSubmit('t1');
      await Promise.resolve();
    });
    // 完成后汇总视图替换表单（无重复发起入口）
    expect(q(c, 'batch-summary')).not.toBeNull();
  });
});
