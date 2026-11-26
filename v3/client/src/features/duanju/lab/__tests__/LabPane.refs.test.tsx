/**
 * 试验台组件测试（M2：参考图与带入设定）：
 * 上传 / 从本作品选 / 历史图设为参考图；通道上限；带入角色设定；回填时恢复；审批区与历史详情显示参考图。
 * 接口模块级 mock；取图走 fetch mock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { newDuanjuProject } from '@shared/duanju';

import { imageProviderForApi } from '../../../../api/duanju';
import { deleteLabRecord, listLabRecords, uploadLabRef } from '../../../../api/duanjuLab';
import { useDuanjuStore } from '../../store';
import { expandBrief } from '../../lib/lab/expand';
import { generateLabImage } from '../../lib/lab/generate';
import { character, click, el, flush, mount, pickFile, pickOption, record, ref, scene, text, type, unmountAll } from './helpers';

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

const pngFile = (name = '底图.png'): File => new File(['png-bytes'], name, { type: 'image/png' });
const captionOf = (c: HTMLElement, i: number): string => (el(c, `lab-ref-caption-${i}`) as HTMLInputElement).value;
/** 第一次出图调用的入参 */
const firstGenerateInput = (): Parameters<typeof generateLabImage>[0] => vi.mocked(generateLabImage).mock.calls[0]![0];

/** 填一句话并扩写 */
async function expandWith(c: HTMLElement): Promise<void> {
  vi.mocked(expandBrief).mockResolvedValue('完整提示词');
  await type(c, 'lab-brief', '她站在客厅里');
  await click(c, 'lab-expand');
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('img-bytes', { headers: { 'content-type': 'image/png' } })));
  vi.mocked(imageProviderForApi).mockReturnValue('comfy');
  vi.mocked(listLabRecords).mockReset().mockResolvedValue([]);
  vi.mocked(uploadLabRef).mockReset().mockResolvedValue(ref.path);
  vi.mocked(expandBrief).mockReset();
  vi.mocked(generateLabImage).mockReset().mockResolvedValue(record);
  useDuanjuStore.setState({
    project: {
      ...newDuanjuProject({ targetEpisodes: 12, style: '写实', protagonists: '' }, 1),
      characters: [character],
      scenes: [scene],
    },
  });
});

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
});

describe('参考图', () => {
  it('上传一张：进列表并标成底图；说明进扩写；扩写之后改输入区不影响这次出图', async () => {
    const c = await mount();
    await pickFile(c, pngFile());
    expect(uploadLabRef).toHaveBeenCalledWith('w1', expect.any(File));
    expect(text(c, 'lab-ref-0')).toContain('图1 · 底图');
    expect(el(c, 'lab-ref-0').querySelector('img')!.getAttribute('src')).toContain('/duanju/files/labref-');
    expect(text(c, 'lab-refs')).toContain('1/3');

    await type(c, 'lab-ref-caption-0', '客厅夜景，暖灯');
    await expandWith(c);
    expect(vi.mocked(expandBrief).mock.calls[0]![1].refs).toEqual([{ caption: '客厅夜景，暖灯' }]);
    expect(c.querySelector('[data-testid="lab-review-refs"]')).not.toBeNull(); // 审批区看得到这次要用的参考图

    // 审批的就是送去生成的：扩写之后从输入区移除参考图，这次出图照旧用它（想换参考图就重新扩写）
    await click(c, 'lab-ref-remove-0');
    expect(c.querySelector('[data-testid="lab-ref-0"]')).toBeNull();
    await click(c, 'lab-confirm');
    await flush();
    expect(firstGenerateInput().refs).toEqual([{ path: ref.path, caption: '客厅夜景，暖灯' }]);
  });

  it('类型不支持或过大：人话提示，不上传', async () => {
    const c = await mount();
    await pickFile(c, new File(['x'], 'a.gif', { type: 'image/gif' }));
    expect(text(c, 'lab-error')).toContain('只支持 png / jpg');
    await pickFile(c, new File(['x'], 'a.bin')); // 没有类型、扩展名也不认
    expect(text(c, 'lab-error')).toContain('只支持 png / jpg');
    const big = pngFile('big.png');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await pickFile(c, big);
    expect(text(c, 'lab-error')).toContain('10MB');
    expect(uploadLabRef).not.toHaveBeenCalled();
    expect(c.querySelector('[data-testid="lab-ref-0"]')).toBeNull();
  });

  it('从本作品选（角色设定图）：取图、上传，说明自动填好', async () => {
    const c = await mount();
    await pickOption(c, 0);
    expect(fetch).toHaveBeenCalledWith('/api/works/w1/duanju/files/c1-sheet.png');
    expect(uploadLabRef).toHaveBeenCalledWith('w1', expect.any(File));
    expect(captionOf(c, 0)).toBe('角色「沈青鸾」的设定图');
  });

  it('历史里的图可以「设为参考图」；详情里显示当时用的参考图', async () => {
    vi.mocked(listLabRecords).mockResolvedValue([{ ...record, refs: [ref] }]);
    const c = await mount();
    await click(c, 'lab-thumb-lab-1');
    expect(c.querySelectorAll('[data-testid="lab-detail-refs"] img')).toHaveLength(1);
    await click(c, 'lab-use-as-ref');
    await flush();
    expect(fetch).toHaveBeenCalledWith('/api/works/w1/duanju/files/a.png');
    expect(captionOf(c, 0)).toBe('试验图：雨夜女剑客');
  });

  it('通道上限：Seedream 满 1 张后不能再加；列表不删图，超出的标成「该通道不会用」', async () => {
    const c = await mount();
    await pickFile(c, pngFile('一.png'));
    await pickFile(c, pngFile('二.png'));
    expect(text(c, 'lab-refs')).toContain('2/3');
    await click(c, 'lab-provider-seedream');
    expect(text(c, 'lab-refs')).toContain('1/1');
    expect(text(c, 'lab-ref-1')).toContain('该通道不会用');
    expect(el(c, 'lab-ref-upload').querySelector('input')!.hasAttribute('disabled')).toBe(true);

    await click(c, 'lab-provider-zhipu');
    expect(c.querySelector('[data-testid="lab-refs-unsupported"]')).not.toBeNull();
    await click(c, 'lab-provider-comfy');
    expect(text(c, 'lab-refs')).toContain('2/3'); // 图还在
  });

  it('回填之后删掉那条记录：输入区里随之从盘上删除的参考图被摘掉（否则下次出图会读到 404）', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.mocked(listLabRecords).mockResolvedValue([{ ...record, refs: [ref] }]);
    vi.mocked(deleteLabRecord).mockResolvedValue([]);
    const c = await mount();
    await click(c, 'lab-thumb-lab-1');
    await click(c, 'lab-reuse');
    expect(c.querySelector('[data-testid="lab-ref-0"]')).not.toBeNull();

    await click(c, 'lab-thumb-lab-1');
    await click(c, 'lab-delete');
    await flush();
    expect(deleteLabRecord).toHaveBeenCalledWith('w1', 'lab-1');
    expect(c.querySelector('[data-testid="lab-ref-0"]')).toBeNull();
    expect(c.querySelector('[data-testid="lab-review-refs"]')).toBeNull(); // 审批区锁定的那份也摘掉
  });

  it('GLM-Image 通道出图时不带参考图', async () => {
    const c = await mount();
    await pickFile(c, pngFile());
    await click(c, 'lab-provider-zhipu');
    await expandWith(c);
    await click(c, 'lab-confirm');
    await flush();
    expect(firstGenerateInput().refs).toEqual([]);
  });
});

describe('带入设定', () => {
  it('点选角色：扩写上下文里有它的档案；没选的场景不进；出图记录里记下带入的角色', async () => {
    const c = await mount();
    expect(c.querySelector('[data-testid="lab-assets"]')).not.toBeNull();
    await click(c, 'lab-asset-character-c1');
    expect(el(c, 'lab-asset-character-c1').getAttribute('aria-pressed')).toBe('true');
    await expandWith(c);
    expect(vi.mocked(expandBrief).mock.calls[0]![1].assets).toEqual({
      characters: [{ name: '沈青鸾', profile: '白上衣青绿百褶裙，长发高马尾' }],
      scenes: [],
    });
    await click(c, 'lab-confirm');
    await flush();
    expect(firstGenerateInput()).toMatchObject({ characterIds: ['c1'], sceneIds: [] });
  });

  it('回填历史记录：恢复当时的参考图与所选设定', async () => {
    vi.mocked(listLabRecords).mockResolvedValue([{ ...record, refs: [ref], characterIds: ['c1'], sceneIds: ['s1'] }]);
    const c = await mount();
    await click(c, 'lab-thumb-lab-1');
    await click(c, 'lab-reuse');
    expect(c.querySelector('[data-testid="lab-ref-0"]')).not.toBeNull();
    expect(el(c, 'lab-asset-character-c1').getAttribute('aria-pressed')).toBe('true');
    expect(el(c, 'lab-asset-scene-s1').getAttribute('aria-pressed')).toBe('true');
    expect((el(c, 'lab-prompt') as HTMLTextAreaElement).value).toBe(record.prompt);
  });
});
