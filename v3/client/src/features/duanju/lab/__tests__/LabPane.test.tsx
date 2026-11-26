/**
 * 试验台组件测试（设计共识 2026-11-26 第 2.2 节；M2：切出后续接）：
 * 输入 → 扩写 → 审批（可改）→ 确认出图 → 历史出现；超限拒绝；切通道时画幅回落；
 * 页面回来后续接在途的出图与扩写。扩写 / 出图 / 历史接口模块级 mock（不碰 LLM 与引擎）。
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { newDuanjuProject } from '@shared/duanju';

import { imageProviderForApi } from '../../../../api/duanju';
import { listLabRecords } from '../../../../api/duanjuLab';
import { useDuanjuStore } from '../../store';
import { expandBrief, resumeBrief } from '../../lib/lab/expand';
import { generateLabImage, resumeLabImage } from '../../lib/lab/generate';
import { click, el, flush, mount, record, text, type, unmountAll } from './helpers';

vi.mock('../../../../api/duanju', () => ({
  imageProviderForApi: vi.fn(() => 'comfy'),
  duanjuFileUrl: (workId: string, path: string) => `/api/works/${workId}/duanju/files/${path.split('/').pop()}`,
}));
vi.mock('../../../../api/duanjuLab', () => ({
  listLabRecords: vi.fn(),
  deleteLabRecord: vi.fn(),
  generateLabCloud: vi.fn(),
  uploadLabComfy: vi.fn(),
  uploadLabRef: vi.fn(),
}));
// 扩写只 mock 两个发请求的函数；「任务是否在途 / 取走断点」用真实的——它们只读写 localStorage
vi.mock('../../lib/lab/expand', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/lab/expand')>()),
  expandBrief: vi.fn(),
  resumeBrief: vi.fn(),
}));
// 出图只 mock 两个有副作用的函数；出图前的校验（produceProblem）用真实的
vi.mock('../../lib/lab/generate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/lab/generate')>()),
  generateLabImage: vi.fn(),
  resumeLabImage: vi.fn(),
}));

/** 后台任务在本地留的键（lib/llmTask）：任务在跑 / 结果没人取。槽位按作品隔离（lab-expand-<作品 id>） */
const TASK_KEY = 'v3-bg-task-lab-expand-w1';
const RESULT_KEY = 'v3-bg-result-lab-expand-w1';

const task = {
  brief: '雨夜女剑客',
  prompt: '电影感单帧：雨夜霓虹街头……',
  kind: 'free',
  aspect: '9:16',
  width: 768,
  height: 1344,
  provider: 'comfy',
  seed: 42,
  refs: [],
  characterIds: [],
  sceneIds: [],
  base: 'http://127.0.0.1:8188',
  promptId: 'pid-1',
  startedAt: Date.now() - 90_000,
};

const snapshot = {
  brief: '雨夜霓虹街头，女剑客回头',
  kind: 'frame',
  aspect: '9:16',
  language: 'zh',
  provider: 'comfy',
  characterIds: [],
  sceneIds: [],
  refs: [],
};

type LabRecordLike = typeof record;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(imageProviderForApi).mockReturnValue('comfy');
  vi.mocked(listLabRecords).mockReset().mockResolvedValue([]);
  vi.mocked(expandBrief).mockReset();
  vi.mocked(resumeBrief).mockReset();
  vi.mocked(generateLabImage).mockReset();
  vi.mocked(resumeLabImage).mockReset();
  useDuanjuStore.setState({
    project: { ...newDuanjuProject({ targetEpisodes: 12, style: '写实', protagonists: '' }, 1), visualSignature: '35mm 颗粒' },
  });
});

afterEach(unmountAll);

describe('LabPane 试验台：三步流程', () => {
  it('没输入时「生成完整提示词」不可点；没有历史时显示空态', async () => {
    const c = await mount();
    expect(el(c, 'lab-expand').hasAttribute('disabled')).toBe(true);
    expect(c.querySelector('[data-testid="lab-empty"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="lab-review"]')).toBeNull();
  });

  it('输入一句话 → 扩写（带作品画风与视觉签名）→ 审批区可改 → 确认出图用改后的提示词 → 进历史', async () => {
    vi.mocked(expandBrief).mockResolvedValue('电影感单帧：雨夜霓虹街头……');
    vi.mocked(generateLabImage).mockResolvedValue(record);
    const c = await mount();
    await type(c, 'lab-brief', '雨夜霓虹街头，女剑客回头');
    await click(c, 'lab-expand');
    await flush();
    expect(vi.mocked(expandBrief).mock.calls[0]![1]).toMatchObject({
      brief: '雨夜霓虹街头，女剑客回头',
      kind: 'free',
      provider: 'comfy',
      language: 'zh',
      style: '写实',
      visualSignature: '35mm 颗粒',
    });
    expect((el(c, 'lab-prompt') as HTMLTextAreaElement).value).toBe('电影感单帧：雨夜霓虹街头……');
    expect(text(c, 'lab-prompt-count')).toBe(`${'电影感单帧：雨夜霓虹街头……'.length}/3000`);

    await type(c, 'lab-prompt', '我改过的提示词');
    await click(c, 'lab-confirm');
    await flush();
    expect(vi.mocked(generateLabImage)).toHaveBeenCalledWith(
      expect.objectContaining({ workId: 'w1', prompt: '我改过的提示词', brief: '雨夜霓虹街头，女剑客回头', provider: 'comfy', aspect: '9:16' }),
      expect.any(Function), // 提交成功后落任务检查点的回调
    );
    expect(c.querySelector('[data-testid="lab-thumb-lab-1"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="lab-error"]')).toBeNull();
  });

  it('超过通道上限：禁止出图并提示删减（不截断）', async () => {
    vi.mocked(expandBrief).mockResolvedValue('雨'.repeat(1200));
    const c = await mount();
    await click(c, 'lab-provider-zhipu');
    await type(c, 'lab-brief', 'x');
    await click(c, 'lab-expand');
    await flush();
    expect(text(c, 'lab-prompt-over')).toContain('上限 1000 字');
    expect(el(c, 'lab-confirm').hasAttribute('disabled')).toBe(true);
    expect(vi.mocked(generateLabImage)).not.toHaveBeenCalled();
  });

  it('切到云端通道：不支持的 4:5 回落为 9:16，画幅选项里没有 4:5', async () => {
    const c = await mount();
    await click(c, 'lab-aspect-4:5');
    expect(el(c, 'lab-aspect-4:5').getAttribute('aria-checked')).toBe('true');
    await click(c, 'lab-provider-seedream');
    expect(el(c, 'lab-aspect-9:16').getAttribute('aria-checked')).toBe('true');
    expect(c.querySelector('[data-testid="lab-aspect-4:5"]')).toBeNull();
  });

  it('扩写失败：显示人话错误，不进入审批区', async () => {
    vi.mocked(expandBrief).mockRejectedValue(new Error('模型没有给出提示词，请重试'));
    const c = await mount();
    await type(c, 'lab-brief', 'x');
    await click(c, 'lab-expand');
    await flush();
    expect(text(c, 'lab-error')).toContain('模型没有给出提示词');
    expect(c.querySelector('[data-testid="lab-review"]')).toBeNull();
    // 失败后恢复可操作
    expect(el(c, 'lab-expand').hasAttribute('disabled')).toBe(false);
  });
});

describe('LabPane 试验台：切出后续接', () => {
  it('页面回来时有在途的本地出图：先显示忙碌，接着等引擎结果并归档，检查点清掉', async () => {
    localStorage.setItem('duanju-lab-task:w1', JSON.stringify(task));
    let finish!: (r: LabRecordLike) => void;
    vi.mocked(resumeLabImage).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const c = await mount();
    expect(resumeLabImage).toHaveBeenCalledWith('w1', task);
    expect(el(c, 'lab-kind-free').hasAttribute('disabled')).toBe(true); // 出图中：输入区锁定
    expect(c.querySelector('[data-testid="lab-thumb-lab-1"]')).toBeNull();

    await act(async () => {
      finish(record);
    });
    await flush();
    expect(c.querySelector('[data-testid="lab-thumb-lab-1"]')).not.toBeNull();
    expect(el(c, 'lab-kind-free').hasAttribute('disabled')).toBe(false);
    expect(localStorage.getItem('duanju-lab-task:w1')).toBeNull();
  });

  it('引擎把任务弄丢了：人话报错、恢复可操作、过期检查点清掉', async () => {
    localStorage.setItem('duanju-lab-task:w1', JSON.stringify(task));
    vi.mocked(resumeLabImage).mockRejectedValue(new Error('任务从引擎队列消失——请重新生成'));
    const c = await mount();
    expect(text(c, 'lab-error')).toContain('任务从引擎队列消失');
    expect(el(c, 'lab-kind-free').hasAttribute('disabled')).toBe(false);
    expect(localStorage.getItem('duanju-lab-task:w1')).toBeNull();
  });

  it('等太久（超过 15 分钟）不算任务丢了：检查点保留，回到这个分区还会接着等', async () => {
    localStorage.setItem('duanju-lab-task:w1', JSON.stringify(task));
    vi.mocked(resumeLabImage).mockRejectedValue(Object.assign(new Error('超时未完成'), { code: 'POLL_TIMEOUT' }));
    const c = await mount();
    expect(text(c, 'lab-error')).toContain('等了很久引擎还没出完');
    expect(localStorage.getItem('duanju-lab-task:w1')).not.toBeNull();
    expect(el(c, 'lab-kind-free').hasAttribute('disabled')).toBe(false);
  });

  it('扩写中途整页重载：回来后接着等那个任务，结果进审批区，输入区恢复成当时的快照', async () => {
    localStorage.setItem('duanju-lab-expand:w1', JSON.stringify(snapshot));
    localStorage.setItem(TASK_KEY, 'task-1'); // 服务端任务还在跑
    vi.mocked(resumeBrief).mockResolvedValue('续接回来的提示词');
    const c = await mount();
    expect(resumeBrief).toHaveBeenCalledTimes(1);
    expect(expandBrief).not.toHaveBeenCalled();
    expect((el(c, 'lab-prompt') as HTMLTextAreaElement).value).toBe('续接回来的提示词');
    expect((el(c, 'lab-brief') as HTMLTextAreaElement).value).toBe(snapshot.brief);
    expect(el(c, 'lab-kind-frame').getAttribute('aria-checked')).toBe('true'); // 输入区照快照恢复：画面类型是快照里的
    expect(localStorage.getItem('duanju-lab-expand:w1')).toBeNull();
  });

  it('扩写中途去了别的页面，任务在后台跑完：回来直接取回结果，不重新花一次调用', async () => {
    let finish!: (text: string) => void;
    vi.mocked(expandBrief).mockImplementation((_workId, _input, _onElapsed, onSubmitted) => {
      onSubmitted?.(); // 真实实现提交成功后就是这样落续接点的
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const first = await mount();
    await type(first, 'lab-brief', snapshot.brief);
    await click(first, 'lab-kind-frame');
    await click(first, 'lab-expand');
    await flush();
    await unmountAll(); // 人走了
    localStorage.setItem(RESULT_KEY, '后台跑完的提示词'); // 后台任务完成，结果落成本地断点
    await act(async () => {
      finish('后台跑完的提示词');
    });

    vi.mocked(resumeBrief).mockResolvedValue('后台跑完的提示词');
    const again = await mount();
    expect(resumeBrief).toHaveBeenCalledTimes(1);
    expect(expandBrief).toHaveBeenCalledTimes(1); // 没有重新提交
    expect((el(again, 'lab-prompt') as HTMLTextAreaElement).value).toBe('后台跑完的提示词');
    expect(el(again, 'lab-kind-frame').getAttribute('aria-checked')).toBe('true');
  });

  it('扩写正常拿到结果后，本地的结果断点被取走（不留成下次误判的旧结果）', async () => {
    localStorage.setItem(RESULT_KEY, '上一次的旧结果');
    vi.mocked(resumeBrief).mockResolvedValue('不该被取到的旧结果');
    vi.mocked(expandBrief).mockImplementation(async () => {
      localStorage.setItem(RESULT_KEY, '这次的提示词'); // 后台任务完成时写的断点
      return '这次的提示词';
    });
    const c = await mount();
    expect(resumeBrief).not.toHaveBeenCalled(); // 没有在途扩写：残留的旧结果不当成刚跑完的
    expect(localStorage.getItem(RESULT_KEY)).toBeNull();
    await type(c, 'lab-brief', 'x');
    await click(c, 'lab-expand');
    await flush();
    expect((el(c, 'lab-prompt') as HTMLTextAreaElement).value).toBe('这次的提示词');
    expect(localStorage.getItem(RESULT_KEY)).toBeNull(); // 结果到了手里，断点取走
  });

  it('扩写的快照还在但任务已经不在了（失败过 / 结果被取走）：清掉快照，不打扰', async () => {
    localStorage.setItem('duanju-lab-expand:w1', JSON.stringify(snapshot));
    const c = await mount();
    expect(resumeBrief).not.toHaveBeenCalled();
    expect(c.querySelector('[data-testid="lab-review"]')).toBeNull();
    expect((el(c, 'lab-brief') as HTMLTextAreaElement).value).toBe('');
    expect(localStorage.getItem('duanju-lab-expand:w1')).toBeNull();
  });

  it('扩写在离开期间失败了：回来不恢复，也不把上一次的旧结果当成这次的', async () => {
    let fail!: (e: Error) => void;
    vi.mocked(expandBrief).mockImplementation((_workId, _input, _onElapsed, onSubmitted) => {
      onSubmitted?.();
      return new Promise((_resolve, reject) => {
        fail = reject;
      });
    });
    const first = await mount();
    await type(first, 'lab-brief', 'x');
    await click(first, 'lab-expand');
    await flush();
    await unmountAll();
    await act(async () => {
      fail(new Error('上游超时'));
    });

    vi.mocked(resumeBrief).mockResolvedValue('上一次的旧结果');
    const again = await mount();
    expect(resumeBrief).not.toHaveBeenCalled();
    expect(again.querySelector('[data-testid="lab-review"]')).toBeNull();
    expect(localStorage.getItem('duanju-lab-expand:w1')).toBeNull();
  });

  it('别的作品的检查点不会被这个作品续接', async () => {
    localStorage.setItem('duanju-lab-task:w2', JSON.stringify(task));
    await mount();
    expect(resumeLabImage).not.toHaveBeenCalled();
  });
});
