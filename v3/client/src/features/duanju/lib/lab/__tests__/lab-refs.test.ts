/**
 * 试验台本地出图两段式与任务检查点测试（M2）：
 * 引擎工作流（文生图 / 参考图模板与槽位裁剪 / Picture 改写）、提交与轮询拆分、检查点的读写与容错。
 * 引擎用 fetch mock（/upload/image、/prompt、/history、/view）；comfy 模块用真实的，只把内存防线替换成放行。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureComfyHeadroom, injectWorkflow } from '../../comfy';
import { LAB_REF_WORKFLOW, pollLabComfy, submitLabComfy, trimRefSlots } from '../comfyRefs';
import {
  clearLabExpand,
  clearLabTask,
  readLabExpand,
  readLabTask,
  writeLabExpand,
  writeLabTask,
  type LabInputState,
  type LabTaskCheckpoint,
} from '../taskState';

vi.mock('../../comfy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../comfy')>();
  return { ...actual, ensureComfyHeadroom: vi.fn(async () => true) };
});

const base = 'http://127.0.0.1:8188';
const cfg = { url: `${base}/`, videoWorkflow: '', imageWorkflow: '' } as unknown as Parameters<typeof submitLabComfy>[0];
const params = { prompt: '底图里的女子抬头', width: 768, height: 1344, seed: 42, refBlobs: [] };
const png = (): Blob => new Blob([new Uint8Array(64)], { type: 'image/png' });

/** 假引擎：记录每次请求；参考图上传返回固定文件名；history 第一次为空（执行中）第二次完成 */
function comfyServer(done: { completed: boolean }): Array<{ url: string; body: unknown }> {
  const calls: Array<{ url: string; body: unknown }> = [];
  const history = {
    'pid-1': {
      status: { completed: true, status_str: 'success' },
      outputs: { '34': { images: [{ filename: 'lab-ref_00001_.png', subfolder: 'comfy-app', type: 'output' }] } },
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body });
      if (url.endsWith('/upload/image')) return Response.json({ name: `uploaded-${calls.length}.png`, subfolder: '' });
      if (url.endsWith('/prompt')) return Response.json({ prompt_id: 'pid-1' });
      if (url.includes('/history/')) return Response.json(done.completed ? history : {});
      if (url.includes('/view?')) return new Response('x'.repeat(64), { headers: { 'content-type': 'image/png' } });
      return new Response('{}', { status: 404 });
    }),
  );
  return calls;
}

const postedWorkflow = (calls: Array<{ url: string; body: unknown }>): Record<string, { class_type?: string; inputs: Record<string, unknown> }> =>
  (JSON.parse(calls.find((c) => c.url.endsWith('/prompt'))!.body as string) as { prompt: unknown }).prompt as Record<
    string,
    { class_type?: string; inputs: Record<string, unknown> }
  >;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('本地出图：阶段一（提交）', () => {
  it('没有参考图：走文生图模板，提示词 / 尺寸 / seed 注入正确，不上传图片', async () => {
    const calls = comfyServer({ completed: true });
    const task = await submitLabComfy(cfg, params);
    expect(task).toEqual({ base, promptId: 'pid-1' });
    expect(ensureComfyHeadroom).toHaveBeenCalledWith(base, { ramGb: 16 });
    const wf = postedWorkflow(calls);
    expect(wf['30']!.inputs).toMatchObject({ prompt: '底图里的女子抬头', width: 768, height: 1344 });
    expect(wf['35']!.inputs).toEqual({ noise_seed: 42 });
    expect(calls.some((c) => c.url.endsWith('/upload/image'))).toBe(false);
  });

  it('带 2 张参考图：先送引擎，提交时裁掉第 3 槽，采样器 euler，提示词里的「图N」改写成 Picture N', async () => {
    const calls = comfyServer({ completed: true });
    await submitLabComfy(cfg, {
      ...params,
      prompt: '图1 里的女子保持不变，姿势改成回头',
      refBlobs: [{ blob: png(), ext: 'png' }, { blob: png(), ext: 'jpg' }],
    });
    const uploads = calls.filter((c) => c.url.endsWith('/upload/image'));
    const files = uploads.map((c) => [...(c.body as FormData).values()].find((v) => v instanceof File) as File);
    // 引擎侧的上传函数会给文件名加随机后缀（防并发任务互相覆盖）：只认前缀与扩展名
    expect(files.map((f) => [f.name, f.type])).toEqual([
      [expect.stringMatching(/^lab-ref-1-[a-z0-9]+\.png$/), 'image/png'],
      [expect.stringMatching(/^lab-ref-2-[a-z0-9]+\.jpg$/), 'image/jpeg'],
    ]);

    const wf = postedWorkflow(calls);
    expect(wf['r1']!.inputs).toEqual({ image: 'uploaded-1.png' });
    expect(wf['r2']!.inputs).toEqual({ image: 'uploaded-2.png' });
    expect(wf['r3']).toBeUndefined(); // 多余的槽裁掉：ComfyUI 会校验图里所有节点
    expect(wf['30']!.inputs).toMatchObject({
      prompt: 'Picture 1 里的女子保持不变，姿势改成回头',
      'images.image_1': ['r1', 0],
      'images.image_2': ['r2', 0],
    });
    expect(wf['30']!.inputs).not.toHaveProperty('images.image_3');
    expect(wf['38']).toMatchObject({ class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } }); // 11-24 实验定稿
    expect(wf['36']!.inputs).toMatchObject({ cfg: 1 }); // 没有负向通道
    expect(JSON.stringify(wf)).not.toContain('<<'); // 占位符全部替换
  });

  it('提示词含引号、换行、反斜杠：工作流仍是合法 JSON，内容逐字保留', async () => {
    const calls = comfyServer({ completed: true });
    const prompt = '她说："别动"\n第二行 C:\\path \\ <Picture 1>';
    await submitLabComfy(cfg, { ...params, prompt });
    expect(postedWorkflow(calls)['30']!.inputs.prompt).toBe(prompt);
  });

  it('裁槽：只动参考槽与 conditioning 的对应输入，别的节点原样', () => {
    const filled = {
      '<<PROMPT>>': 'p',
      '<<WIDTH>>': '768',
      '<<HEIGHT>>': '1344',
      '<<SEED>>': '42',
      '<<REF1>>': 'a.png',
      '<<REF2>>': 'b.png',
      '<<REF3>>': 'c.png',
    };
    const before = injectWorkflow(LAB_REF_WORKFLOW, filled);
    const wf = injectWorkflow(LAB_REF_WORKFLOW, filled);
    trimRefSlots(wf, 1);
    expect(Object.keys(wf)).toEqual(Object.keys(before).filter((k) => k !== 'r2' && k !== 'r3'));
    const cond = (wf['30'] as { inputs: Record<string, unknown> }).inputs;
    expect(cond['images.image_1']).toEqual(['r1', 0]);
    expect(cond).not.toHaveProperty('images.image_2');
    expect(cond).not.toHaveProperty('images.image_3');
    expect(wf['34']).toEqual(before['34']);
    expect(wf['39']).toEqual(before['39']);
  });
});

describe('本地出图：阶段二（轮询）', () => {
  it('history 里还没有就接着等，完成后从 /view 取回产物；恢复轮询只凭任务号', async () => {
    vi.useFakeTimers();
    comfyServer({ completed: true });
    const pending = pollLabComfy({ base, promptId: 'pid-1' });
    await vi.advanceTimersByTimeAsync(3100);
    const blob = await pending;
    expect(blob.size).toBe(64);
    expect(fetch).toHaveBeenCalledWith(
      `${base}/history/pid-1`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain('/view?filename=lab-ref_00001_.png');
  });
});

describe('任务检查点', () => {
  const task = {
    brief: '一句话',
    prompt: '完整提示词',
    kind: 'free',
    aspect: '9:16',
    width: 768,
    height: 1344,
    provider: 'comfy',
    seed: 42,
    refs: [{ path: 'duanju/images/labref-0f3a9c1e-7b2d.png', caption: '底图' }],
    characterIds: [],
    sceneIds: [],
    base,
    promptId: 'pid-1',
    startedAt: 100,
  } satisfies LabTaskCheckpoint;

  it('没有检查点 → null；写入后原样读回；按作品隔离；清掉后为 null', () => {
    expect(readLabTask('w1')).toBeNull();
    writeLabTask('w1', task);
    expect(readLabTask('w1')).toEqual(task);
    expect(readLabTask('w2')).toBeNull();
    clearLabTask('w1');
    expect(readLabTask('w1')).toBeNull();

    const snapshot = {
      brief: 'b',
      kind: 'frame',
      aspect: '16:9',
      language: 'en',
      provider: 'comfy',
      characterIds: [],
      sceneIds: [],
      refs: [],
    } satisfies LabInputState;
    writeLabExpand('w1', snapshot);
    expect(readLabExpand('w1')).toEqual(snapshot);
    clearLabExpand('w1');
    expect(readLabExpand('w1')).toBeNull();
  });

  it('损坏 / 旧结构 / 路径不在白名单 / 缺引擎任务号 → 当作没有（不让它卡住界面）', () => {
    localStorage.setItem('duanju-lab-task:w1', '{not json');
    expect(readLabTask('w1')).toBeNull();
    localStorage.setItem('duanju-lab-task:w1', JSON.stringify({ ...task, refPaths: [] }));
    expect(readLabTask('w1')).toBeNull(); // 旧字段名
    localStorage.setItem('duanju-lab-task:w1', JSON.stringify({ ...task, refs: [{ path: '../secrets.json', caption: '' }] }));
    expect(readLabTask('w1')).toBeNull();
    localStorage.setItem('duanju-lab-task:w1', JSON.stringify({ ...task, promptId: '' }));
    expect(readLabTask('w1')).toBeNull();
    localStorage.setItem('duanju-lab-expand:w1', JSON.stringify({ brief: 'x'.repeat(301) }));
    expect(readLabExpand('w1')).toBeNull();
  });
});
