/**
 * library 资产通用 CRUD 工厂（Task 6）：一处实现，四类资产复用（DRY）。
 *
 * 每个资产 = 一个 JSON 文件（<id>.json），GET list 浅列表、GET :id 全量、
 * POST 服务端生成 uuid、PATCH 顶层字段合并 + 全量重校验、DELETE 幂等。
 * id 用于拼文件路径，必须过白名单正则，杜绝路径穿越。
 */
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { join } from 'node:path';
import { Router } from 'express';
import type { z, ZodTypeAny } from 'zod';

import { deleteFile, listDir, readJson, writeJsonAtomic } from '../../storage/store';
import { HttpError, formatZodError, zodBody } from '../../middleware/validate';

// ---------- 数据目录 ----------

// server/ 根（与 main.ts 同基准，env DATA_DIR 相对路径语义一致）
const SERVER_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** library 资产子目录绝对路径：DATA_DIR/<sub>（每请求求值，测试注入 env 即生效） */
export function libraryDir(sub: string): string {
  return resolve(SERVER_ROOT, process.env.DATA_DIR ?? '../data', sub);
}

// ---------- id 安全校验 ----------

/** 合法 id 字符集：uuid 由字母数字与连字符组成（同时天然拒绝 / \ .. 等穿越片段） */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// ---------- 泛型工厂 ----------

export interface CrudOptions<Asset extends { id: string; name: string; createdAt?: number }> {
  /** 资产子目录解析器（每请求求值） */
  dirOf: () => string;
  /** 完整资产 schema（含 id 字段；POST 时自动 omit，PATCH 时自动 partial） */
  schema: z.ZodType<Asset>;
  /** 错误消息中的资源名（如"角色卡"） */
  label: string;
  /**
   * POST 按 name 幂等（深度测试报告缺陷「批量导入失败重试产生重复卡」）：
   * 已存在同名资产时直接返回既有资产（200，无新文件落盘），否则照常 201 新建。
   * 客户端以 200/201 区分「既有/新建」；仅对 name 天然唯一的资产类（角色卡）开启。
   */
  idempotentByName?: boolean;
}

/**
 * 生成某类资产的标准 CRUD 子路由：
 * GET /（浅列表 [{id,name}]）、GET /:id、POST /、PATCH /:id、DELETE /:id。
 */
export function crudRouter<Asset extends { id: string; name: string; createdAt?: number }>(
  opts: CrudOptions<Asset>,
): Router {
  const { dirOf, label } = opts;
  // ZodType 层面只保证"能校验出 Asset"；omit/partial 需要对象形态，此处收敛为一次内部转型
  const objectSchema = opts.schema as unknown as z.ZodObject<Record<string, ZodTypeAny>>;
  const createSchema = objectSchema.omit({ id: true }); // id 服务端生成，客户端传入即 400
  const patchSchema = createSchema.partial(); // PATCH：顶层字段可选，合并后全量重校验

  const fileOf = (id: string): string => join(dirOf(), `${id}.json`);

  /** id 白名单校验：非法即按"不存在"处理（不泄露路径语义） */
  function assertId(raw: unknown): string {
    const id = String(raw);
    if (!ID_PATTERN.test(id)) throw new HttpError(404, `${label}不存在`);
    return id;
  }

  const router = Router();

  // GET /：浅列表 [{id,name,createdAt}]（列表场景不回传大字段，降低传输量）。
  // createdAt 缺失的旧资产回退文件修改时间（不回写，写入路径会逐步补齐）。
  router.get('/', async (_req, res, next) => {
    try {
      const dir = dirOf();
      const files = (await listDir(dir)).filter((name) => name.endsWith('.json'));
      const assets = await Promise.all(
        files.map(async (name) => {
          const file = join(dir, name);
          const asset = await readJson<Asset>(file);
          if (!asset) return null;
          let createdAt = asset.createdAt;
          if (typeof createdAt !== 'number') {
            try {
              createdAt = (await stat(file)).mtimeMs;
            } catch {
              createdAt = 0;
            }
          }
          return { id: asset.id, name: asset.name, createdAt };
        }),
      );
      res.json(assets.filter((it) => it !== null));
    } catch (err) {
      next(err);
    }
  });

  // GET /:id：全量
  router.get('/:id', async (req, res, next) => {
    try {
      const id = assertId(req.params.id);
      const asset = await readJson<Asset>(fileOf(id));
      if (!asset) {
        res.status(404).json({ error: `${label}不存在` });
        return;
      }
      res.json(asset);
    } catch (err) {
      next(err);
    }
  });

  // POST /：校验（无 id）→ [按 name 幂等：同名回既有资产 200] → 服务端生成 uuid + 入库时间 → 原子写 → 201 回全量
  router.post('/', zodBody(createSchema), async (req, res, next) => {
    try {
      if (opts.idempotentByName) {
        const name = String((req.body as { name?: unknown }).name ?? '').trim();
        if (name) {
          const dir = dirOf();
          const files = (await listDir(dir)).filter((f) => f.endsWith('.json'));
          for (const f of files) {
            const found = await readJson<Asset>(join(dir, f));
            if (found && found.name === name) {
              res.status(200).json(found); // 幂等命中：返回既有资产，不新建
              return;
            }
          }
        }
      }
      // body 已过 zod 校验；id/createdAt 为服务端元数据（schema 层 createdAt 可选，故断言安全）
      const asset = { ...(req.body as object), id: randomUUID(), createdAt: Date.now() } as unknown as Asset;
      await writeJsonAtomic(fileOf(asset.id), asset);
      res.status(201).json(asset);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /:id：顶层浅合并 + 全量重校验（拒绝改 id；不存在的资源 404）
  router.patch('/:id', zodBody(patchSchema), async (req, res, next) => {
    try {
      const id = assertId(req.params.id);
      const file = fileOf(id);
      const existing = await readJson<Asset>(file);
      if (!existing) {
        res.status(404).json({ error: `${label}不存在` });
        return;
      }
      const merged = { ...existing, ...(req.body as Partial<Asset>) };
      const parsed = objectSchema.safeParse(merged);
      if (!parsed.success) {
        next(new HttpError(400, `更新后的${label}不合法：${formatZodError(parsed.error)}`));
        return;
      }
      await writeJsonAtomic(file, parsed.data as Asset);
      res.json(parsed.data);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /:id：幂等删除（不存在也返回 204）
  router.delete('/:id', async (req, res, next) => {
    try {
      const id = assertId(req.params.id);
      await deleteFile(fileOf(id));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
