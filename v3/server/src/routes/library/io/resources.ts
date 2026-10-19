/**
 * 资源中心路由（Task 30，设计 §8）：精选索引读取 + 直链/内置资源拉取导入。
 *
 * 挂载（library/index.ts）：
 *   libraryRouter.use('/resources', resourcesRouter);
 * 端点：
 *   GET  /api/io/resources/index  → resources/index.json 全量条目
 *   POST /api/io/resources/fetch  body {kind:'builtin', path} | {kind:'remote', url}
 *                                 → 拉取 → 格式嗅探 → 既有 normalize → 入库 → 201
 * 安全：builtin 路径白名单（限定 resources/builtin/ 内，拒 .. 与盘符）；
 *       remote 仅 https、SSRF 黑名单、手动重定向逐跳校验、10s 超时、20MB 上限
 *       （实现与安全细节见 ./remote-fetch.ts，review #4）。
 * 索引路径解析用 import.meta.url 推导（不依赖进程 cwd，tsx/vitest 均成立）。
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';

import type { CharacterAsset } from '@shared/card';

import { extractCardData, toInternalCard } from '../../converters/card-png';
import { normalizePreset, normalizeRegex, normalizeWorldbook } from '../../converters/tavern';
import { authRequired } from '../../middleware/auth';
import { HttpError, zodBody } from '../../middleware/validate';
import { readJson, writeJsonAtomic } from '../../storage/store';
import { libraryDir } from './crud';
import { persist as persistCharacter } from './io-card';
import { MAX_BYTES, fetchRemote } from './remote-fetch';

const RESOURCES_DIR = fileURLToPath(new URL('../../../../resources/', import.meta.url));
const BUILTIN_DIR = resolve(RESOURCES_DIR, 'builtin');

// ---------- 索引 ----------

interface ResourceEntry {
  id: string;
  type: 'preset' | 'worldbook' | 'character' | 'regex';
  name: string;
  description: string;
  tags: string[];
  source: string;
  ref: { kind: 'builtin' | 'remote'; path?: string; url?: string };
  license: string;
}

interface ResourcesIndex {
  version: number;
  updatedAt: string;
  entries: ResourceEntry[];
}

// ---------- 导入请求体与入库结果 ----------

const fetchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin'), path: z.string().min(1) }),
  z.object({ kind: z.literal('remote'), url: z.string().min(1) }),
]);

type FetchBody = z.infer<typeof fetchSchema>;

/** 嗅探结果：三类 JSON 资产（normalize 产物）或角色卡（内部模型） */
type Sniffed =
  | { assetType: 'worldbooks' | 'presets' | 'regex-scripts'; name: string; raw: unknown }
  | { assetType: 'characters'; asset: CharacterAsset };

/** 响应：assetType 与客户端资产 Tab（AssetType）一一对应 */
type ImportedAsset = {
  assetType: Sniffed['assetType'];
  id: string;
  name: string;
};

// ---------- builtin 路径安全 ----------

/** 白名单解析：字符串层拒绝 .. 与盘符，resolve 后必须仍落在 builtin/ 内（双保险防穿越）。
 *  rel 相对 resources/ 根（索引中的 ref.path 形如 "builtin/presets/Default.json"）。 */
function resolveBuiltin(rel: string): string {
  if (rel.includes('..') || /^[A-Za-z]:/.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new HttpError(400, '非法的资源路径');
  }
  const abs = resolve(RESOURCES_DIR, rel);
  if (abs !== BUILTIN_DIR && !abs.startsWith(BUILTIN_DIR + sep)) {
    throw new HttpError(400, '非法的资源路径');
  }
  return abs;
}

/** 剥扩展名得到导入兜底名（"builtin/worldbooks/Eldoria.json" → "Eldoria"） */
function nameFromPath(p: string): string {
  const base = basename(p);
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).trim() || '导入资源';
}

/** URL 兜底名：末段解码后按文件名处理（"…/Default.json?q=1" → "Default"） */
function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').pop() ?? '';
    return nameFromPath(decodeURIComponent(last));
  } catch {
    return '导入资源';
  }
}

// ---------- 格式嗅探与分流（复用既有 normalize 管道） ----------

function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

function parseJsonBody(buf: Buffer): unknown {
  try {
    return JSON.parse(buf.toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, '资源内容不是合法的 JSON（PNG 角色卡需为有效 PNG 文件）');
  }
}

/** sysprompt 文件（{name, content} 简单结构）→ 单条系统提示的最小预设 */
function syspromptAsPreset(raw: unknown): { name: string; raw: Record<string, unknown> } {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const content = typeof obj.content === 'string' ? obj.content : '';
  const label = typeof obj.name === 'string' ? obj.name : '系统提示词';
  return {
    name: label,
    raw: {
      name: label,
      prompts: [
        {
          identifier: 'sysprompt',
          name: 'System Prompt',
          role: 'system',
          content,
          system_prompt: true,
          marker: false,
        },
      ],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'sysprompt', enabled: true }] }],
    },
  };
}

/** 按 JSON 结构识别资产类型并分流到既有 normalize；识别失败 400 人话 */
function detectAndNormalize(raw: unknown, fallbackName: string): Sniffed {
  if (typeof raw !== 'object' || raw === null) {
    throw new HttpError(400, '无法识别的资源格式：不是世界书/预设/角色卡/正则脚本');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.entries !== null && typeof obj.entries === 'object' && !Array.isArray(obj.entries)) {
    const { name, raw: wb } = normalizeWorldbook(raw, fallbackName);
    return { assetType: 'worldbooks', name, raw: wb };
  }
  if (Array.isArray(obj.prompts) || Array.isArray(obj.prompt_order)) {
    const { name, raw: p } = normalizePreset(raw, fallbackName);
    return { assetType: 'presets', name, raw: p };
  }
  if (typeof obj.scriptName === 'string' || typeof obj.findRegex === 'string') {
    const { name, raw: rx } = normalizeRegex(raw, fallbackName);
    return { assetType: 'regex-scripts', name, raw: rx };
  }
  if (typeof obj.content === 'string' && typeof obj.name === 'string') {
    const synth = syspromptAsPreset(raw);
    const { name, raw: p } = normalizePreset(synth.raw, fallbackName || synth.name);
    return { assetType: 'presets', name, raw: p };
  }
  if (obj.spec !== undefined || (obj.data !== null && typeof obj.data === 'object')) {
    return { assetType: 'characters', asset: toInternalCard(raw) };
  }
  throw new HttpError(400, '无法识别的资源格式：不是世界书/预设/角色卡/正则脚本');
}

// ---------- 入库 ----------

/** 统一入库：PNG → 角色卡（带底图）；JSON → 按类型分流 normalize 后写入对应资产目录 */
async function ingest(buf: Buffer, fallbackName: string): Promise<ImportedAsset> {
  if (buf.byteLength > MAX_BYTES) {
    throw new HttpError(413, '资源超过 20MB 上限');
  }
  if (isPng(buf)) {
    let tavernJson: unknown;
    try {
      tavernJson = extractCardData(buf);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : 'PNG 角色卡解析失败');
    }
    const asset = toInternalCard(tavernJson);
    await persistCharacter(asset, buf);
    return { assetType: 'characters', id: asset.id, name: asset.name };
  }

  const hit = detectAndNormalize(parseJsonBody(buf), fallbackName);
  if (hit.assetType === 'characters') {
    await persistCharacter(hit.asset);
    return { assetType: 'characters', id: hit.asset.id, name: hit.asset.name };
  }
  const asset = { id: randomUUID(), name: hit.name, raw: hit.raw };
  await writeJsonAtomic(join(libraryDir(hit.assetType), `${asset.id}.json`), asset);
  return { assetType: hit.assetType, id: asset.id, name: hit.name };
}

// ---------- 路由 ----------

export const resourcesRouter = Router();

resourcesRouter.use(authRequired);

// GET /index：返回精选索引全量（索引缺失视为部署损坏 → 500）
resourcesRouter.get('/index', async (_req, res, next) => {
  try {
    const index = await readJson<ResourcesIndex>(join(RESOURCES_DIR, 'index.json'));
    if (!index || !Array.isArray(index.entries)) {
      throw new HttpError(500, '资源索引缺失或损坏（resources/index.json）');
    }
    res.json(index);
  } catch (err) {
    next(err);
  }
});

// POST /fetch：builtin（白名单读文件）或 remote（https 拉取）→ 嗅探 → normalize → 入库
resourcesRouter.post('/fetch', zodBody(fetchSchema), async (req, res, next) => {
  try {
    const body = req.body as FetchBody;
    let buf: Buffer;
    let fallbackName: string;
    if (body.kind === 'builtin') {
      const abs = resolveBuiltin(body.path);
      try {
        if (!(await stat(abs)).isFile()) throw new Error('not a file');
      } catch {
        throw new HttpError(404, '内置资源不存在（路径不在白名单清单内）');
      }
      buf = await readFile(abs);
      fallbackName = nameFromPath(abs);
    } else {
      buf = await fetchRemote(body.url);
      fallbackName = nameFromUrl(body.url);
    }
    res.status(201).json(await ingest(buf, fallbackName));
  } catch (err) {
    next(err);
  }
});
