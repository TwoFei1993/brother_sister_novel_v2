/**
 * 云端生图代理（Seedream / GLM-Image）——用户决策 2026-11-11：minimax image-01 通道整体移除（效果相对差，
 * 默认生图走本地 ComfyUI，见 client features/duanju/lib/comfy.ts；云端仅作手动切换的降级备选）。
 * tts.ts 同款模式。
 */
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../middleware/logger';
import { readJson } from '../storage/store';
import { dataDir } from '../routes/core/paths';
import { worksDir } from '../routes/works/works';

/** 生图错误分类码（语义对齐 llm.ts LlmErrorCode 风格） */
export type ImageErrorCode =
  | 'IMG_AUTH'
  | 'IMG_QUOTA'
  | 'IMG_REJECTED'
  | 'IMG_NET'
  | 'IMG_TIMEOUT'
  | 'IMG_UPSTREAM';

export class ImageError extends Error {
  constructor(
    public readonly code: ImageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImageError';
  }
}

const ENDPOINT_ZHIPU = 'https://open.bigmodel.cn/api/paas/v4/images/generations';
const ENDPOINT_ARK = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

/** 生图通道：GLM-Image 文字强；Seedream（即梦同源）5.0-flash 质量顶级 0.12 元/张参考图免费 */
export type ImageProvider = 'zhipu' | 'seedream';

/** provider → 尺寸参数（zhipu/seedream 用 size 像素串，32 倍数） */
function ratioFor(provider: ImageProvider, ratio: string): Record<string, unknown> {
  if (provider === 'seedream') {
    const sizeMap: Record<string, string> = {
      '1:1': '2048x2048',
      '3:4': '1536x2048',
      '4:3': '2048x1536',
      '16:9': '2560x1440',
      '9:16': '1440x2560',
      '2:3': '1360x2040',
      '3:2': '2040x1360',
    };
    return { size: sizeMap[ratio] ?? '1536x2048' };
  }
  const sizeMap: Record<string, string> = {
    '1:1': '1024x1024',
    '3:4': '864x1152',
    '4:3': '1152x864',
    '16:9': '1280x720',
    '9:16': '720x1280',
    '2:3': '832x1248',
    '3:2': '1248x832',
  };
  return { size: sizeMap[ratio] ?? '864x1152' };
}

interface SecretsLite {
  zhipu?: { apiKey?: string };
  ark?: { apiKey?: string };
}

async function imageKey(provider: ImageProvider): Promise<string> {
  const s = await readJson<SecretsLite>(join(dataDir(), 'secrets.json'));
  if (provider === 'zhipu') return s?.zhipu?.apiKey ?? '';
  return s?.ark?.apiKey ?? '';
}

export interface GenerateImageInput {
  prompt: string;
  aspectRatio?: string;
  /** 人物参考图绝对路径（转 DataURL；seedream 经 image 字段消费，参考图输入免费） */
  subjectRefPath?: string;
  /** 生图通道（缺省 seedream） */
  provider?: ImageProvider;
}

/** 调生图（网络/5xx 自动重试 3 次退避；4xx/业务码不重试） */
export async function callImageGeneration(input: GenerateImageInput): Promise<string[]> {
  const provider: ImageProvider = input.provider ?? 'seedream';
  const key = await imageKey(provider);
  if (!key) {
    throw new ImageError(
      'IMG_AUTH',
      `服务端未配置${provider === 'seedream' ? '火山方舟' : '智谱'}密钥（生图通道=${
        provider === 'seedream' ? 'Seedream' : 'GLM-Image'
      }）——请在设置页填写，或切换到本地 ComfyUI 引擎`,
    );
  }
  const aspectRatio = input.aspectRatio ?? '3:4';

  // 参考图 → DataURL（seedream：image 参考图输入免费；zhipu：无参考图参数，一致性靠 prompt）
  let seedreamImage: string | undefined;
  if (input.subjectRefPath) {
    const buf = await readFile(input.subjectRefPath);
    const mime = input.subjectRefPath.toLowerCase().endsWith('.jpg') || input.subjectRefPath.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
    seedreamImage = `data:${mime};base64,${buf.toString('base64')}`;
  }

  const prompt = provider === 'zhipu' ? input.prompt.slice(0, 1000) : input.prompt.slice(0, 2000);
  const body: Record<string, unknown> = {
    model: provider === 'zhipu' ? 'glm-image' : 'doubao-seedream-5-0-flash',
    prompt,
    ...ratioFor(provider, aspectRatio),
    ...(provider === 'seedream'
      ? { response_format: 'url' as const, watermark: false, ...(seedreamImage ? { image: seedreamImage } : {}) }
      : {}),
  };

  let lastErr: ImageError | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const endpoint = provider === 'zhipu' ? ENDPOINT_ZHIPU : ENDPOINT_ARK;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000), // glm-image hd 约 20s；120s 兜超时
      });
      // 智谱/火山同形态：{ data: [{url}] }；错误 { error: { message } }；url 24h 有效（转存）
      const json = (await res.json().catch(() => ({}))) as {
        data?: Array<{ url?: string }>;
        error?: { message?: string };
      };
      if (!res.ok || json.error) {
        const msg = json.error?.message ?? `HTTP ${res.status}`;
        const vendor = provider === 'zhipu' ? '智谱' : 'Seedream';
        throw new ImageError(res.status === 401 ? 'IMG_AUTH' : 'IMG_UPSTREAM', `${vendor}生图错误：${msg}`);
      }
      const urls = (json.data ?? []).map((d) => d.url ?? '').filter(Boolean);
      if (urls.length === 0) throw new ImageError('IMG_UPSTREAM', '上游未返回图片');
      return urls;
    } catch (err) {
      if (err instanceof ImageError) throw err; // 业务错误不重试
      lastErr =
        err instanceof Error && err.name === 'TimeoutError'
          ? new ImageError('IMG_TIMEOUT', '生图超时（上游无响应），请重试')
          : new ImageError('IMG_NET', '生图网络错误，请稍后重试');
      logger.warn({ attempt, provider, err: String(err) }, 'image_generation retry');
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr ?? new ImageError('IMG_NET', '生图网络错误');
}

/** 下载产物并转存到 work 的 duanju/images/（URL 仅 24h，必须立即转存）；返回相对路径与原始 URL */
export async function downloadAndStore(
  workId: string,
  url: string,
): Promise<{ path: string; originUrl: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new ImageError('IMG_NET', `图片下载失败（HTTP ${res.status}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new ImageError('IMG_UPSTREAM', '图片内容异常（过小）');
  const dir = workImagesDir(workId);
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.png`;
  await writeFile(join(dir, name), buf);
  return { path: `duanju/images/${name}`, originUrl: url };
}

/** 某 work 的图片目录绝对路径（worksDir 自 routes/works；与 routes/duanju 共用） */
export function workImagesDir(workId: string): string {
  return join(worksDir(), workId, 'duanju', 'images');
}
