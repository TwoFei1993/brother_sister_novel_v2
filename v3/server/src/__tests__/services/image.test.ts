/**
 * 生图服务测试：mock fetch，验证调用契约与错误分类
 *
 * minimax image-01 通道已移除（用户决策 2026-11-11）；缺省/云端语义 = seedream（火山方舟）。
 * 此处锁定：
 * - 成功：body 契约（model/size 映射与兜底/prompt 截断 2000/watermark）+ DataURL 参考图格式
 * - 错误：401→AUTH、非 200→UPSTREAM、空 data→UPSTREAM
 * - 网络：重试 3 次后 IMG_NET
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
  await writeFile(join(root, 'secrets.json'), JSON.stringify({ ark: { apiKey: 'sk-test' } }), 'utf8');
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

describe('callImageGeneration（缺省 seedream）', () => {
  it('成功：契约字段 + size 兜底 1536x2048 + watermark=false + data[{url}] 解析', async () => {
    const fn = mockFetchJson(200, { data: [{ url: 'https://ark.example.com/a.png' }] });
    const urls = await callImageGeneration({ prompt: 'x'.repeat(2500), aspectRatio: 'weird' });
    expect(urls).toEqual(['https://ark.example.com/a.png']);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('ark.cn-beijing.volces.com');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('doubao-seedream-5-0-flash');
    expect(body.prompt.length).toBe(2000); // 截断到 seedream 上限
    expect(body.size).toBe('1536x2048'); // 非白名单比例兜底
    expect(body.watermark).toBe(false);
  });

  it('参考图转 Data URL（mime 按 png，经 image 字段免费传入）', async () => {
    const refFile = join(root, 'ref.png');
    await writeFile(refFile, Buffer.from('fakepng'));
    const fn = mockFetchJson(200, { data: [{ url: 'https://ark.example.com/b.png' }] });
    await callImageGeneration({ prompt: 'p', subjectRefPath: refFile });
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string);
    expect(String(body.image)).toMatch(/^data:image\/png;base64,/);
  });

  it('401 → IMG_AUTH；非 200 → IMG_UPSTREAM（不重试）', async () => {
    mockFetchJson(401, { error: { message: 'invalid token' } });
    await expect(callImageGeneration({ prompt: 'p' })).rejects.toMatchObject({ code: 'IMG_AUTH' });

    mockFetchJson(200, { error: { message: 'content sensitive' } });
    await expect(callImageGeneration({ prompt: 'p' })).rejects.toMatchObject({ code: 'IMG_UPSTREAM' });

    mockFetchJson(500, {});
    await expect(callImageGeneration({ prompt: 'p' })).rejects.toMatchObject({ code: 'IMG_UPSTREAM' });
  });

  it('空 data / 无 url → IMG_UPSTREAM', async () => {
    mockFetchJson(200, { data: [] });
    await expect(callImageGeneration({ prompt: 'p' })).rejects.toMatchObject({ code: 'IMG_UPSTREAM' });
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

describe('zhipu GLM-Image 通道', () => {
  it('provider=zhipu：端点/模型/size 形态 + data[{url}] 解析 + prompt 截断 1000', async () => {
    await writeFile(join(root, 'secrets.json'), JSON.stringify({ zhipu: { apiKey: 'zp-test' } }), 'utf8');
    const fn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ url: 'https://cdn.zhipu.example.com/a.png' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fn);
    const urls = await callImageGeneration({ prompt: '角色设定图'.repeat(400), aspectRatio: '3:4', provider: 'zhipu' });
    expect(urls).toEqual(['https://cdn.zhipu.example.com/a.png']);
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('glm-image');
    expect(body.size).toBe('864x1152'); // 3:4 → size 映射
    expect(body.aspect_ratio).toBeUndefined();
    expect(body.prompt.length).toBeLessThanOrEqual(1000); // 智谱 1000 字上限截断
  });

  it('provider=zhipu 且未配置密钥 → IMG_AUTH 人话（提示切换通道）', async () => {
    await writeFile(join(root, 'secrets.json'), JSON.stringify({}), 'utf8');
    await expect(
      callImageGeneration({ prompt: 'p', provider: 'zhipu' }),
    ).rejects.toMatchObject({ code: 'IMG_AUTH' });
    await writeSecrets();
  });

  it('provider=seedream 无 ark 密钥 → IMG_AUTH（提示切换通道）', async () => {
    await writeFile(join(root, 'secrets.json'), JSON.stringify({}), 'utf8');
    await expect(callImageGeneration({ prompt: 'p', provider: 'seedream' })).rejects.toMatchObject({
      code: 'IMG_AUTH',
    });
    await writeSecrets();
  });

  it('seedream prompt 上限 2000', async () => {
    const fn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ url: 'https://x/a.png' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fn);
    await callImageGeneration({ prompt: 'x'.repeat(2500), provider: 'seedream' });
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.prompt.length).toBe(2000);
  });
});
