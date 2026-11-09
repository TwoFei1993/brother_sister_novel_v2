/**
 * 生图服务测试（实施计划 T2.x）：mock fetch，验证调用契约与错误分类
 *
 * 不打真实上游（spike 脚本已实测真链路）；此处锁定：
 * - 成功：body 契约（model/prompt 截断/aspect_ratio 白名单兜底）+ DataURL 参考图格式
 * - base_resp 分类：1004/2049→AUTH、1008→QUOTA、1026→REJECTED
 * - 网络/5xx：重试 3 次后 IMG_NET
 * - downloadAndStore：落盘路径与 originUrl
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ACCESS_PASSWORD = 'test123';

// DATA_DIR 指向临时目录：secrets.json 由测试写入（services/image 读真实文件系统）
let root = '';

async function writeSecrets(): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'secrets.json'), JSON.stringify({ claude: { apiKey: 'sk-test' } }), 'utf8');
}

const { callImageGeneration, downloadAndStore, ImageError } = await import('../../services/image');

/** 构造上游 JSON 响应 fetch mock */
function mockFetchJson(status: number, json: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-img-'));
  process.env.DATA_DIR = root;
  await writeSecrets();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

describe('callImageGeneration', () => {
  it('成功：契约字段 + aspect_ratio 白名单兜底 3:4', async () => {
    const fn = mockFetchJson(200, {
      base_resp: { status_code: 0 },
      data: { image_urls: ['https://cdn.example.com/a.png'] },
    });
    const urls = await callImageGeneration({ prompt: 'x'.repeat(2000), aspectRatio: 'weird' });
    expect(urls).toEqual(['https://cdn.example.com/a.png']);
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('image-01');
    expect(body.prompt.length).toBe(1500); // 截断到官方上限
    expect(body.aspect_ratio).toBe('3:4'); // 非白名单值兜底
    expect(body.response_format).toBe('url');
  });

  it('参考图转 Data URL（mime 按 png）', async () => {
    const refFile = join(root, 'ref.png');
    await writeFile(refFile, Buffer.from('fakepng'));
    const fn = mockFetchJson(200, {
      base_resp: { status_code: 0 },
      data: { image_urls: ['https://cdn.example.com/b.png'] },
    });
    await callImageGeneration({ prompt: 'p', subjectRefPath: refFile });
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.subject_reference).toEqual([
      { type: 'character', image_file: expect.stringMatching(/^data:image\/png;base64,/) },
    ]);
  });

  it('1004 → IMG_AUTH；1008 → IMG_QUOTA；1026 → IMG_REJECTED（不重试）', async () => {
    mockFetchJson(200, { base_resp: { status_code: 1004, status_msg: 'auth fail' } });
    await expect(callImageGeneration({ prompt: 'p' })).rejects.toMatchObject({ code: 'IMG_AUTH' });

    mockFetchJson(200, { base_resp: { status_code: 1008, status_msg: 'quota' } });
    await expect(callImageGeneration({ prompt: 'p' })).rejects.toMatchObject({ code: 'IMG_QUOTA' });

    mockFetchJson(200, { base_resp: { status_code: 1026, status_msg: 'sensitive' } });
    await expect(callImageGeneration({ prompt: 'p' })).rejects.toMatchObject({ code: 'IMG_REJECTED' });
  });

  it('网络错误：重试 3 次后 IMG_NET', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(callImageGeneration({ prompt: 'p' })).rejects.toMatchObject({ code: 'IMG_NET' });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });
});

describe('downloadAndStore', () => {
  it('下载落盘并返回相对路径', async () => {
    const png = Buffer.from('a'.repeat(2048), 'utf8');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(png, { status: 200 })),
    );
    const { path, originUrl } = await downloadAndStore('w1', 'https://cdn.example.com/x.png');
    expect(path).toMatch(/^duanju\/images\/[\w-]+\.png$/);
    expect(originUrl).toBe('https://cdn.example.com/x.png');
    // DATA_DIR/works/w1/duanju/images/ 下确实存在
    const buf = await readFile(join(root, 'works', 'w1', path));
    expect(buf.length).toBe(2048);
  });

  it('内容过小 → IMG_UPSTREAM', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Buffer.from('x'), { status: 200 })));
    await expect(downloadAndStore('w1', 'https://cdn.example.com/tiny.png')).rejects.toBeInstanceOf(
      ImageError,
    );
  });
});

describe('zhipu GLM-Image 通道（生图升级轮）', () => {
  it('provider=zhipu：端点/模型/size 形态 + data[{url}] 解析', async () => {
    await writeFile(join(root, 'secrets.json'), JSON.stringify({ claude: { apiKey: 'sk-test' }, zhipu: { apiKey: 'zp-test' } }), 'utf8');
    const fn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ url: 'https://cdn.zhipu.example.com/a.png' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fn);
    const urls = await callImageGeneration({ prompt: '角色设定图', aspectRatio: '3:4', provider: 'zhipu' });
    expect(urls).toEqual(['https://cdn.zhipu.example.com/a.png']);
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('glm-image');
    expect(body.size).toBe('864x1152'); // 3:4 → size 映射
    expect(body.aspect_ratio).toBeUndefined();
    expect(body.prompt.length).toBeLessThanOrEqual(1000); // 智谱 1000 字上限截断
  });

  it('provider=zhipu 且未配置密钥 → IMG_AUTH 人话（提示切换通道）', async () => {
    await writeFile(join(root, 'secrets.json'), JSON.stringify({ claude: {} }), 'utf8');
    await expect(
      callImageGeneration({ prompt: 'p', provider: 'zhipu' }),
    ).rejects.toMatchObject({ code: 'IMG_AUTH' });
    await writeFile(join(root, 'secrets.json'), JSON.stringify({ claude: { apiKey: 'sk-test' } }), 'utf8');
  });

  it('缺省 provider（旧调用方）→ 仍走 minimax 契约', async () => {
    const fn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ base_resp: { status_code: 0 }, data: { image_urls: ['https://cdn.example.com/m.png'] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fn);
    const urls = await callImageGeneration({ prompt: 'p' });
    expect(urls).toHaveLength(1);
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('image-01');
    expect(body.aspect_ratio).toBe('3:4');
  });
});
