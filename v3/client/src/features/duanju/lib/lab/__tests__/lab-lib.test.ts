/**
 * 试验台纯逻辑测试（设计共识 2026-11-26 第 2.3 / 2.4 / 2.5 节；M2：参考图、带入设定、切出续接）
 * 画幅与尺寸 / 扩写系统词与上下文 / 输出清洗 / 通道分流与归档
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LabRecord, LabRef } from '@shared/duanju/lab';
import { generateLabCloud, uploadLabComfy } from '../../../../../api/duanjuLab';
import { pollLabComfy, submitLabComfy } from '../comfyRefs';
import { loadComfyConfig } from '../../comfy';
import { ASPECTS_BY_PROVIDER, cloudSizeFor, comfySizeFor, labSizeFor } from '../aspects';
import { cleanExpandedPrompt } from '../expand';
import { stripModelWrapper as cleanExpandedScript } from '../../output-clean';
import { generateLabImage, labSizeForProvider, resumeLabImage } from '../generate';
import { buildExpandInput, buildExpandMessages } from '../prompts-lab';
import { effectiveRefs, pickableRefs, refFileProblem, refSlotsLeft } from '../refs';

vi.mock('../../../../../api/duanjuLab', () => ({
  generateLabCloud: vi.fn(),
  uploadLabComfy: vi.fn(),
}));
vi.mock('../../comfy', () => ({
  loadComfyConfig: vi.fn(() => ({ url: 'http://127.0.0.1:8188', videoWorkflow: '', imageWorkflow: '' })),
}));
vi.mock('../comfyRefs', () => ({
  submitLabComfy: vi.fn(),
  pollLabComfy: vi.fn(),
}));

const ref = (n: number): LabRef => ({
  path: `duanju/images/labref-${n}0000000-0000-0000-0000-00000000000${n}.png`,
  caption: n === 1 ? '底图：客厅夜景' : '',
});
const jpgRef: LabRef = { path: 'duanju/images/labref-11111111-2222-3333-4444-555555555555.jpg', caption: '人物定妆' };

const input = { workId: 'w1', brief: '一句话', prompt: '完整提示词', seed: 42, characterIds: [] as string[], sceneIds: [] as string[] };
const stored: LabRecord = {
  id: 'lab-1',
  createdAt: 1,
  brief: '一句话',
  prompt: '完整提示词',
  kind: 'free',
  provider: 'comfy',
  aspect: '9:16',
  width: 768,
  height: 1344,
  seed: 42,
  refs: [],
  characterIds: [],
  sceneIds: [],
  image: { id: 'img-1', path: 'duanju/images/a.png', prompt: '完整提示词', createdAt: 1 },
  elapsedSec: 91,
};

const pngBlob = (): Blob => new Blob([new Uint8Array(2048)], { type: 'image/png' });

beforeEach(() => {
  vi.mocked(generateLabCloud).mockReset();
  vi.mocked(uploadLabComfy).mockReset();
  vi.mocked(submitLabComfy).mockReset();
  vi.mocked(pollLabComfy).mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('png-bytes', { headers: { 'content-type': 'image/png' } })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('画幅与尺寸', () => {
  it('本地：四种画幅映射到 8MP 档（2026-11-27 用户裁定；32 倍数，面积对齐 2016×3584）', () => {
    expect(labSizeFor('9:16')).toEqual({ width: 2016, height: 3584 });
    expect(labSizeFor('16:9')).toEqual({ width: 3584, height: 2016 });
    expect(labSizeFor('1:1')).toEqual({ width: 2688, height: 2688 });
    expect(labSizeFor('4:5')).toEqual({ width: 2400, height: 3008 });
    for (const aspect of ['9:16', '16:9', '1:1', '4:5'] as const) {
      const { width, height } = labSizeFor(aspect);
      expect(width % 32).toBe(0);
      expect(height % 32).toBe(0);
    }
  });
  it('既有入口（设定图/服装/分镜帧）仍为小图档，不受试验台升档影响', () => {
    expect(comfySizeFor('frame')).toEqual({ width: 768, height: 1344 });
    expect(comfySizeFor('character', '4:5')).toEqual({ width: 1152, height: 1440 });
  });

  it('云端：没有 4:5；尺寸取自共享尺寸表', () => {
    expect(ASPECTS_BY_PROVIDER.seedream).not.toContain('4:5');
    expect(ASPECTS_BY_PROVIDER.zhipu).not.toContain('4:5');
    expect(cloudSizeFor('seedream', '9:16')).toEqual({ width: 1440, height: 2560 });
    expect(cloudSizeFor('zhipu', '1:1')).toEqual({ width: 1024, height: 1024 });
    expect(() => cloudSizeFor('zhipu', '4:5')).toThrow();
    expect(labSizeForProvider('comfy', '4:5')).toEqual({ width: 2400, height: 3008 });
  });

  it('既有入口的尺寸函数迁入后行为不变', () => {
    expect(comfySizeFor('character', '4:5')).toEqual({ width: 1152, height: 1440 });
    expect(comfySizeFor('outfit')).toEqual({ width: 1024, height: 1024 });
    expect(comfySizeFor('prop')).toEqual({ width: 1024, height: 1024 });
    expect(comfySizeFor('frame')).toEqual({ width: 768, height: 1344 });
    expect(comfySizeFor('scene')).toEqual({ width: 1344, height: 768 });
  });
});

describe('参考图：按通道截取与上传前校验', () => {
  it('本地 3 张、Seedream 1 张、GLM 0 张；余量与拦截提示', () => {
    const refs = [ref(1), ref(2), ref(3)];
    expect(effectiveRefs('comfy', refs)).toEqual(refs);
    expect(effectiveRefs('seedream', refs)).toEqual([ref(1)]);
    expect(effectiveRefs('zhipu', refs)).toEqual([]);
    expect(refSlotsLeft('seedream', refs)).toBe(0);
    expect(refSlotsLeft('comfy', refs)).toBe(0);
    expect(refSlotsLeft('comfy', [ref(1)])).toBe(2);
  });

  it('上传前：只收 png / jpg（MIME 为空时看扩展名），不超过 10MB', () => {
    const file = (name: string, type: string, size = 10): File => ({ name, type, size } as File);
    expect(refFileProblem(file('a.png', 'image/png'))).toBeNull();
    expect(refFileProblem(file('a.JPG', ''))).toBeNull(); // 手机 WebView 选图常没有 MIME
    expect(refFileProblem(file('a.gif', 'image/gif'))).toContain('只支持 png / jpg');
    expect(refFileProblem(file('a.bin', ''))).toContain('只支持 png / jpg');
    expect(refFileProblem(file('a.png', 'image/png', 11 * 1024 * 1024))).toContain('10MB');
  });

  it('候选：角色设定图 / 场景图 / 历史试验图，说明自动填好', () => {
    const project = {
      style: '写实',
      characters: [
        {
          id: 'c1',
          name: '沈青鸾',
          profile: 'p',
          images: [],
          sheetImages: [
            { id: 'i1', path: 'duanju/images/s1.png', prompt: '', createdAt: 1 },
            { id: 'i2', path: 'duanju/images/s2.png', prompt: '', createdAt: 2 },
          ],
        },
        { id: 'c2', name: '', profile: 'p', images: [], sheetImages: [] },
      ],
      scenes: [{ id: 's1', name: '兰若寺', spec: 'sp', images: [{ id: 'i3', path: 'duanju/images/x.png', prompt: '', createdAt: 3 }] }],
    };
    const options = pickableRefs(project, [{ ...stored, brief: '雨夜霓虹街头的女剑客回头' }]);
    expect(options.map((o) => [o.group, o.caption])).toEqual([
      ['角色设定图', '角色「沈青鸾」的设定图 1'],
      ['角色设定图', '角色「沈青鸾」的设定图 2'],
      ['场景图', '场景「兰若寺」的图'],
      ['历史试验图', '试验图：雨夜霓虹街头的女剑客回头'],
    ]);
    expect(pickableRefs(null, [])).toEqual([]);
  });
});

describe('扩写系统词', () => {
  it('本地通道带 H3 写法规则（无负向 / 动力链 / 肌肉表情），并要求只输出提示词正文、限长', () => {
    const [system, user] = buildExpandMessages({
      brief: '雨夜女剑客回头',
      kind: 'frame',
      provider: 'comfy',
      language: 'zh',
      aspect: '9:16',
      style: '写实',
      styleText: '一张真实照片而非渲染图',
      visualSignature: '35mm颗粒',
    });
    expect(system.role).toBe('system');
    expect(system.content).toContain('H3-Image');
    expect(system.content).toContain('没有负向提示词');
    expect(system.content).toContain('动力链');
    expect(system.content).toContain('肌肉动作');
    expect(system.content).toContain('不超过 3000 字');
    expect(system.content).toContain('先布局后细节');
    expect(system.content).not.toContain('<Picture 1>'); // 没带参考图：不讲三段式
    expect(user.content).toContain('雨夜女剑客回头');
    expect(user.content).toContain('单帧分镜');
    expect(user.content).toContain('35mm颗粒');
    expect(user.content).toContain('一张真实照片而非渲染图');
  });

  it('云端通道不带 H3 规则，按通道限长；语言开关生效', () => {
    const [system] = buildExpandMessages({
      brief: 'x',
      kind: 'scene',
      provider: 'zhipu',
      language: 'en',
      aspect: '16:9',
      style: '动漫风',
      styleText: '日式动画',
    });
    expect(system.content).not.toContain('H3-Image');
    expect(system.content).toContain('避免出现');
    expect(system.content).toContain('不超过 1000 字');
    expect(system.content).toContain('用英文写');
  });

  it('带参考图（本地）：加三段式写法，并把每张图的说明按 Picture 序号交给模型', () => {
    const [system, user] = buildExpandMessages({
      brief: 'x',
      kind: 'frame',
      provider: 'comfy',
      language: 'zh',
      aspect: '9:16',
      style: '写实',
      styleText: 't',
      refs: [ref(1), ref(2)],
    });
    expect(system.content).toContain('三段式');
    expect(system.content).toContain('<Picture 1> 是底图');
    expect(system.content).toContain('重新描述会把脸改掉');
    // 官方技能的结构：每个主体单独一句关系；取景由底图决定；没有文字就明说
    expect(system.content).toContain('is fully preserved');
    expect(system.content).toContain('不用来定构图');
    expect(system.content).toContain('没有任何文字');
    expect(user.content).toContain('参考图（共 2 张');
    expect(user.content).toContain('<Picture N>');
    expect(user.content).toContain('图1：底图：客厅夜景');
    expect(user.content).toContain('图2：（用户未说明，按画面内容理解）');
  });

  it('带参考图（云端）：只讲以图1为准，不讲 H3 三段式', () => {
    const [system] = buildExpandMessages({
      brief: 'x',
      kind: 'character',
      provider: 'seedream',
      language: 'zh',
      aspect: '9:16',
      style: '写实',
      styleText: 't',
      refs: [ref(1)],
    });
    expect(system.content).toContain('以图1为准');
    expect(system.content).not.toContain('三段式');
  });

  it('扩写上下文：只带入所选角色 / 场景档案；参考图只给该通道实际会用的', () => {
    const project = {
      style: '写实',
      visualSignature: '35mm 颗粒',
      characters: [
        { id: 'c1', name: '沈青鸾', profile: '白上衣青绿百褶裙' },
        { id: 'c2', name: '陆惊尘', profile: '蓝青宽袖' },
      ],
      scenes: [{ id: 's1', name: '兰若寺', spec: '古寺夜雨' }],
    };
    const state = {
      brief: '  她站在寺前 ',
      kind: 'frame' as const,
      aspect: '9:16' as const,
      language: 'zh' as const,
      provider: 'seedream' as const,
      characterIds: ['c1'],
      sceneIds: [],
      refs: [ref(1), ref(2)],
    };
    const ctx = buildExpandInput(state, project);
    expect(ctx).toMatchObject({
      brief: '她站在寺前',
      style: '写实',
      visualSignature: '35mm 颗粒',
      assets: { characters: [{ name: '沈青鸾', profile: '白上衣青绿百褶裙' }], scenes: [] },
      refs: [{ caption: '底图：客厅夜景' }],
    });
    expect(buildExpandInput({ ...state, refs: [] }, null)).not.toHaveProperty('refs');
    expect(buildExpandInput({ ...state, refs: [] }, null).style).toBe('动漫风'); // 没有作品：用默认画风
  });
});

describe('输出清洗', () => {
  it('剥代码块围栏与首尾解释行；正文原样保留', () => {
    expect(cleanExpandedPrompt('```\n第一行\n第二行\n```')).toBe('第一行\n第二行');
    expect(cleanExpandedPrompt('以下是扩写后的提示词：\n第一行\n第二行\n希望对你有帮助')).toBe('第一行\n第二行');
    expect(cleanExpandedPrompt('提示词：第一行')).toBe('提示词：第一行'); // 只有一行时不丢（防把正文全删）
    expect(cleanExpandedPrompt('  第一行\n\n第三行  ')).toBe('第一行\n\n第三行');
    expect(cleanExpandedPrompt('   ')).toBe('');
  });

  it('尾行是客套才剥（带明确的客套搭配）；剧本以「注意到」「希望」开头的最后一行不能被吃掉', () => {
    const script = '场1 内·面馆·夜\n老陈端上面碗。';
    for (const tail of ['希望符合预期', '如需调整，请告诉我', '如果需要我可以继续写第 3 集', '以上是第 2 集剧本']) {
      expect(cleanExpandedPrompt(`${script}\n${tail}`)).toBe(script);
    }
    // 这些是正文：丢了就是丢台词、丢动作
    for (const tail of ['注意到她的目光，老陈把火关小了。', '希望她能平安。', '说明来意后，姑娘把盒子推过去。', '这是她第一次开口。']) {
      expect(cleanExpandedScript(`${script}\n${tail}`)).toBe(`${script}\n${tail}`);
    }
    expect(cleanExpandedScript('这是老陈第一次见到她。\n场2 内·后厨·夜')).toBe('这是老陈第一次见到她。\n场2 内·后厨·夜');
  });
});

describe('通道分流与归档', () => {
  const base = 'http://127.0.0.1:8188';

  it('本地通道：提交 → 轮询 → 产物回流归档，带 seed 与耗时；提交成功即交出任务检查点', async () => {
    vi.mocked(submitLabComfy).mockResolvedValue({ base, promptId: 'p1' });
    vi.mocked(pollLabComfy).mockResolvedValue(pngBlob());
    vi.mocked(uploadLabComfy).mockResolvedValue([stored]);
    const onSubmitted = vi.fn();
    const record = await generateLabImage({ ...input, kind: 'free', provider: 'comfy', aspect: '9:16', refs: [] }, onSubmitted);
    expect(record).toEqual(stored);
    expect(submitLabComfy).toHaveBeenCalledWith(
      expect.objectContaining({ url: base }),
      { prompt: '完整提示词', width: 2016, height: 3584, seed: 42, refBlobs: [] },
    );
    expect(pollLabComfy).toHaveBeenCalledWith({ base, promptId: 'p1' });
    const meta = {
      brief: '一句话',
      prompt: '完整提示词',
      kind: 'free',
      provider: 'comfy',
      aspect: '9:16',
      width: 2016,
      height: 3584,
      seed: 42,
      refs: [],
      characterIds: [],
      sceneIds: [],
    };
    expect(onSubmitted).toHaveBeenCalledWith({ ...meta, base, promptId: 'p1', startedAt: expect.any(Number) });
    expect(uploadLabComfy).toHaveBeenCalledWith('w1', expect.any(File), { ...meta, elapsedSec: expect.any(Number) });
    expect(fetch).not.toHaveBeenCalled(); // 没有参考图：不取图
    expect(generateLabCloud).not.toHaveBeenCalled();
  });

  it('本地通道带参考图：按路径取回字节（jpg 标成 jpg）后送引擎，参考图写进归档', async () => {
    vi.mocked(submitLabComfy).mockResolvedValue({ base, promptId: 'p2' });
    vi.mocked(pollLabComfy).mockResolvedValue(pngBlob());
    vi.mocked(uploadLabComfy).mockResolvedValue([stored]);
    await generateLabImage({ ...input, kind: 'free', provider: 'comfy', aspect: '9:16', refs: [ref(1), jpgRef] });
    expect(submitLabComfy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        refBlobs: [
          { ext: 'png', blob: expect.any(Blob) },
          { ext: 'jpg', blob: expect.any(Blob) },
        ],
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(uploadLabComfy).toHaveBeenCalledWith('w1', expect.anything(), expect.objectContaining({ refs: [ref(1), jpgRef] }));
  });

  it('云端通道：交给服务端生成，尺寸按通道表；Seedream 只带 1 张参考图，GLM 不带', async () => {
    const cloud: LabRecord = { ...stored, provider: 'seedream', aspect: '16:9', width: 2560, height: 1440, seed: 0 };
    vi.mocked(generateLabCloud).mockResolvedValue(cloud);
    const params = { ...input, kind: 'scene' as const, aspect: '16:9' as const, refs: [ref(1), ref(2)] };
    expect(await generateLabImage({ ...params, provider: 'seedream' })).toEqual(cloud);
    expect(generateLabCloud).toHaveBeenLastCalledWith('w1', {
      brief: '一句话',
      prompt: '完整提示词',
      kind: 'scene',
      provider: 'seedream',
      aspect: '16:9',
      width: 2560,
      height: 1440,
      characterIds: [],
      sceneIds: [],
      refs: [ref(1)],
    });
    await generateLabImage({ ...params, provider: 'zhipu' });
    expect(generateLabCloud).toHaveBeenLastCalledWith('w1', expect.objectContaining({ provider: 'zhipu', refs: [] }));
    expect(submitLabComfy).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('续接：凭检查点续轮询并归档，耗时从原来的开始时刻算', async () => {
    vi.mocked(pollLabComfy).mockResolvedValue(pngBlob());
    vi.mocked(uploadLabComfy).mockResolvedValue([stored]);
    const task = {
      brief: '一句话',
      prompt: '完整提示词',
      kind: 'free' as const,
      provider: 'comfy' as const,
      aspect: '9:16' as const,
      width: 768,
      height: 1344,
      seed: 42,
      refs: [ref(1)],
      characterIds: [],
      sceneIds: [],
      base,
      promptId: 'p9',
      startedAt: Date.now() - 120_000,
    };
    expect(await resumeLabImage('w1', task)).toEqual(stored);
    expect(pollLabComfy).toHaveBeenCalledWith({ base, promptId: 'p9' });
    expect(submitLabComfy).not.toHaveBeenCalled();
    // 归档只传 meta 字段：检查点里的引擎任务号等续接字段不能带过去（归档接口是严格校验的——走查抓到过）
    const meta = {
      brief: '一句话',
      prompt: '完整提示词',
      kind: 'free',
      provider: 'comfy',
      aspect: '9:16',
      width: 768,
      height: 1344,
      seed: 42,
      refs: [ref(1)],
      characterIds: [],
      sceneIds: [],
    };
    expect(uploadLabComfy).toHaveBeenCalledWith('w1', expect.any(File), { ...meta, elapsedSec: expect.any(Number) });
    expect(vi.mocked(uploadLabComfy).mock.calls[0]![2].elapsedSec).toBeGreaterThanOrEqual(120);
  });

  it('引擎把任务弄丢：抛人话错误、不归档（检查点已交出，由调用方决定去留）', async () => {
    vi.mocked(submitLabComfy).mockResolvedValue({ base, promptId: 'p3' });
    vi.mocked(pollLabComfy).mockRejectedValue(new Error('任务从引擎队列消失——请重新生成'));
    const onSubmitted = vi.fn();
    await expect(generateLabImage({ ...input, kind: 'free', provider: 'comfy', aspect: '9:16', refs: [] }, onSubmitted)).rejects.toThrow(
      '任务从引擎队列消失',
    );
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(uploadLabComfy).not.toHaveBeenCalled();
  });
});
