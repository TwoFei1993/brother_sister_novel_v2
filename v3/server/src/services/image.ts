/**
 * MiniMax image-01 生图代理（共识 D1 / Phase 0 spike 定案 / tts.ts 同款模式）
 *
 * - key：secrets.json claude.apiKey（与 LLM/TTS 同 key，spike S1 实证）
 * - 参考图：subject_reference:[{type:'character', image_file:<DataURL>}]——
 *   裸 base64 与裸公网 URL 均被上游静默忽略（spike S4-S7 实测），必须 Data URL
 * - 产物 URL 仅 24h 有效：调用方拿到 URL 后必须立即 downloadAndStore
 * - 错误分类码 IMG_*（前端人话；密钥不进任何错误消息/日志）
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

import { readJson } from '../storage/store';
import { dataDir } from '../routes/core/paths';
import { worksDir } from '../routes/works/works';
import { logger } from '../middleware/logger';

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

const ENDPOINT_MINIMAX = 'https://api.minimaxi.com/v1/image_generation';
const ENDPOINT_ZHIPU = 'https://open.bigmodel.cn/api/paas/v4/images/generations';
const ENDPOINT_ARK = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

/** 生图通道：image-01 中文文字渲染/复杂版式弱；GLM-Image 文字强；Seedream（即梦同源）5.0-flash 质量顶级 0.12 元/张参考图免费 */
export type ImageProvider = 'minimax' | 'zhipu' | 'seedream';

/** provider → 尺寸参数形态差异（minimax 用 aspect_ratio；zhipu/seedream 用 size） */
function ratioFor(provider: ImageProvider, ratio: string): Record<string, unknown> {
  if (provider === 'seedream') {
    // 火山 Seedream size 像素串（32 倍数）
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
  if (provider === 'zhipu') {
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
  return { aspect_ratio: ratio };
}

/** aspect_ratio 白名单（官方 OpenAPI 枚举；防透传任意值） */
const RATIOS = new Set(['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9']);

interface SecretsLite {
  claude?: { apiKey?: string };
  zhipu?: { apiKey?: string };
  ark?: { apiKey?: string };
}

async function imageKey(provider: ImageProvider): Promise<string> {
  const s = await readJson<SecretsLite>(join(dataDir(), 'secrets.json'));
  if (provider === 'zhipu') return s?.zhipu?.apiKey ?? '';
  if (provider === 'seedream') return s?.ark?.apiKey ?? '';
  return s?.claude?.apiKey ?? '';
}

export interface GenerateImageInput {
  prompt: string;
  aspectRatio?: string;
  /** 人物参考图绝对路径（转 DataURL 传 subject_reference；spike S8 定案；仅 minimax 消费） */
  subjectRefPath?: string;
  /** 生图通道（缺省 minimax 兼容旧调用方） */
  provider?: ImageProvider;
}

interface ImageGenResponse {
  id?: string;
  data?: { image_urls?: string[]; image_base64?: string[] };
  metadata?: { success_count?: string | number; failed_count?: string | number };
  base_resp?: { status_code?: number; status_msg?: string };
}

/** base_resp 状态码 → 分类错误（1004/2049 鉴权、1008 余额、1026 敏感、1002 限流归 NET 重试外抛） */
function classifyBaseResp(code: number, msg: string): ImageError {
  if (code === 1004 || code === 2049) return new ImageError('IMG_AUTH', 'MiniMax 密钥无效，请检查服务端配置');
  if (code === 1008) return new ImageError('IMG_QUOTA', 'MiniMax 账户余额不足，请充值后重试');
  if (code === 1026) return new ImageError('IMG_REJECTED', `图片描述未通过内容审核：${msg}`);
  if (code === 1002) return new ImageError('IMG_NET', '生成请求触发限流，请稍后再试');
  return new ImageError('IMG_UPSTREAM', `MiniMax 生图错误：${msg || '未知'}（code ${code}）`);
}

/** 调生图（双通道；网络/5xx 自动重试 3 次退避；4xx/业务码不重试） */
export async function callImageGeneration(input: GenerateImageInput): Promise<string[]> {
  const provider: ImageProvider = input.provider ?? 'minimax';
  const key = await imageKey(provider);
  if (!key) {
    throw new ImageError(
      'IMG_AUTH',
      `服务端未配置${provider === 'seedream' ? '火山方舟' : provider === 'zhipu' ? '智谱' : 'MiniMax'}密钥（生图通道=${
        provider === 'seedream' ? 'Seedream' : provider === 'zhipu' ? 'GLM-Image' : 'MiniMax'
      }）——请在设置页填写或切换其他通道`,
    );
  }
  const aspectRatio = input.aspectRatio && RATIOS.has(input.aspectRatio) ? input.aspectRatio : '3:4';

  // minimax：参考图 → Data URL（spike S8 唯一生效传法）；zhipu：无参考图参数，一致性靠 prompt
  let subjectRef: Array<{ type: 'character'; image_file: string }> | undefined;
  let seedreamImage: string | undefined;
  if (input.subjectRefPath) {
    const buf = await readFile(input.subjectRefPath);
    const mime = input.subjectRefPath.toLowerCase().endsWith('.jpg') || input.subjectRefPath.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    // minimax：subject_reference（spike S8 唯一生效传法）；seedream：image 参考图输入免费
    subjectRef = [{ type: 'character', image_file: dataUrl }];
    seedreamImage = dataUrl;
  }

  const prompt = provider === 'zhipu' ? input.prompt.slice(0, 1000) : provider === 'seedream' ? input.prompt.slice(0, 2000) : input.prompt.slice(0, 1500);
  const body: Record<string, unknown> = {
    model: provider === 'zhipu' ? 'glm-image' : provider === 'seedream' ? 'doubao-seedream-5-0-flash' : 'image-01',
    prompt,
    ...ratioFor(provider, aspectRatio),
    ...(provider === 'minimax'
      ? { response_format: 'url' as const, n: 1, ...(subjectRef ? { subject_reference: subjectRef } : {}) }
      : {}),
    ...(provider === 'seedream'
      ? { response_format: 'url' as const, watermark: false, ...(seedreamImage ? { image: seedreamImage } : {}) }
      : {}),
  };

  let lastErr: ImageError | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const endpoint = provider === 'zhipu' ? ENDPOINT_ZHIPU : provider === 'seedream' ? ENDPOINT_ARK : ENDPOINT_MINIMAX;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000), // glm-image hd 约 20s；120s 兜超时
      });
      const json = (await res.json().catch(() => ({}))) as ImageGenResponse & {
        data?: Array<{ url?: string }>;
        error?: { message?: string };
      };
      if (provider === 'zhipu' || provider === 'seedream') {
        // 智谱/火山同形态：{ data: [{url}] }；错误 { error: { message } }；url 24h 有效（转存）
        if (!res.ok || json.error) {
          const msg = json.error?.message ?? `HTTP ${res.status}`;
          const vendor = provider === 'zhipu' ? '智谱' : 'Seedream';
          throw new ImageError(res.status === 401 ? 'IMG_AUTH' : 'IMG_UPSTREAM', `${vendor}生图错误：${msg}`);
        }
        const urls = (json.data ?? []).map((d) => d.url ?? '').filter(Boolean);
        if (urls.length === 0) throw new ImageError('IMG_UPSTREAM', '上游未返回图片');
        return urls;
      }
      const base = json.base_resp?.status_code ?? -1;
      if (base !== 0) throw classifyBaseResp(base, json.base_resp?.status_msg ?? '');
      const urls = json.data?.image_urls ?? [];
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
