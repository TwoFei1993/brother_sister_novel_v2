/**
 * works 路由实现（设计 §4.3 / §4.5 / §6）：作品 CRUD + revision 乐观锁
 *
 * 存储布局：data/works/<id>/work.json + messages.jsonl（§4.1）
 * 并发策略（§4.5 双层防护）：
 *   - PATCH / DELETE 走 withWorkLock 写队列（同 id 串行，不同 id 并行）
 *   - PATCH 须携带客户端所读 revision，与磁盘不符返回 409 {code:"CONFLICT"}
 * stats 维护：创建时初始化全 0；消息写入方（Task 8）在持锁内回调
 * updateWorkStats 刷新计数，读取路径不做全文件扫描（§4.6）。
 */
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { HttpError, zodBody } from '../../middleware/validate';
import { withWorkLock } from '../../middleware/writer';
import { listDir, readJson, writeJsonAtomic } from '../../storage/store';
import {
  NovelSettingsSchema,
  ViewPreferenceSchema,
  WorkModeSchema,
  WorkStatsSchema,
  defaultNovelSettings,
  type Work,
  type WorkStats,
  AssetBindingSchema,
} from '@shared/work';

// ---------- 路径解析（实时读 DATA_DIR，测试注入临时目录） ----------
// 基准与 main.ts/paths.ts 一致：相对路径以 server/ 为基准（本文件位于 src/routes/works/，上三级即 server/），
// 不再相对 cwd 解析——dev 与生产（deploy.sh）cwd 不同也落同一目录。
const WORKS_SERVER_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
/** 作品数据根：DATA_DIR/works（绝对基准，供 messages.ts 复用，杜绝相对 cwd 的第二份解析） */
export function worksDir(): string {
  return resolve(WORKS_SERVER_ROOT, process.env.DATA_DIR ?? '../data', 'works');
}
function workFile(id: string): string {
  return join(worksDir(), id, 'work.json');
}

/** id 直接作目录名：仅允许安全字符，杜绝 ../ 路径穿越（服务端生成的 UUID 天然满足） */
const SAFE_ID_RE = /^[\w-]+$/;
export function assertSafeId(id: string): void {
  if (!SAFE_ID_RE.test(id)) throw new HttpError(404, '作品不存在');
}

/** 读单个作品；不存在抛 404（work.json 缺失/损坏均视为不存在）。messages 路由复用同一作品判定 */
export async function readWork(id: string): Promise<Work> {
  const work = await readJson<Work>(workFile(id));
  if (!work) throw new HttpError(404, '作品不存在');
  return work;
}

/** Express 4 不会自动捕获 async handler 的 rejection：统一包装为 next(err) 传播给错误处理器 */
export function wrap(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ---------- 输入 schema（id/revision/createdAt/updatedAt/stats 服务端管理，客户端不可提交） ----------
export const createWorkSchema = z.strictObject({
  title: z.string().min(1, '标题不能为空'),
  mode: WorkModeSchema,
  genre: z.string().min(1, '题材不能为空'),
  characterIds: z.array(z.string()).default([]),
  worldbookIds: z.array(z.string()).default([]),
  factionIds: z.array(z.string()).default([]),
  presetId: z.string().default(''),
  regexScriptIds: z.array(z.string()).default([]),
  settings: NovelSettingsSchema.optional(),
  allowCardOverride: z.boolean().optional(),
  voiceMap: z.record(z.string(), z.string()).default({}),
  viewPreference: ViewPreferenceSchema.optional(),
  shelfTag: z.string().optional(),
});
export type CreateWorkInput = z.infer<typeof createWorkSchema>;

/** mode 创建后锁定（消息流语义随 mode 而定，不支持中途切换） */
export const updateWorkSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  title: z.string().min(1, '标题不能为空').optional(),
  genre: z.string().min(1).optional(),
  characterIds: z.array(z.string()).optional(),
  worldbookIds: z.array(z.string()).optional(),
  factionIds: z.array(z.string()).optional(),
  presetId: z.string().optional(),
  regexScriptIds: z.array(z.string()).optional(),
  settings: NovelSettingsSchema.optional(),
  allowCardOverride: z.boolean().optional(),
  voiceMap: z.record(z.string(), z.string()).optional(),
  viewPreference: ViewPreferenceSchema.optional(),
  shelfTag: z.string().optional(),
  bindings: z.array(AssetBindingSchema).optional(),
});
export type UpdateWorkInput = z.infer<typeof updateWorkSchema>;

// ---------- GET /works：浅列表（书架卡片所需字段，按最近更新排序） ----------
// P3.1 读者过滤：读者只见有上架章节的书（无 publishedChapterCount 的旧 stats 视为未上架）
export const listWorks: RequestHandler = async (req, res) => {
  const isReader = req.auth?.role === 'reader';
  const names = await listDir(worksDir());
  const works = await Promise.all(names.map((name) => readJson<Work>(workFile(name))));
  const items = works
    .filter((w): w is Work => w !== null)
    .filter((w) => !isReader || (w.stats?.publishedChapterCount ?? 0) > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ id, title, mode, genre, updatedAt, stats, shelfTag }) => ({
      id,
      title,
      mode,
      genre,
      updatedAt,
      stats,
      shelfTag,
    }));
  res.json(items);
};

// ---------- GET /works/:id：全量 Work ----------
export const getWork: RequestHandler = async (req, res) => {
  const id = req.params.id;
  assertSafeId(id);
  res.json(await readWork(id));
};

// ---------- POST /works：创建（revision=1，初始化空 messages.jsonl 与全 0 stats） ----------
export const createWork: RequestHandler = async (req, res) => {
  const input = req.body as CreateWorkInput;
  const now = Date.now();
  const work: Work = {
    id: randomUUID(),
    revision: 1,
    title: input.title,
    mode: input.mode,
    genre: input.genre,
    characterIds: input.characterIds,
    worldbookIds: input.worldbookIds,
    factionIds: input.factionIds,
    presetId: input.presetId,
    regexScriptIds: input.regexScriptIds,
    settings: input.settings ?? defaultNovelSettings,
    ...(input.allowCardOverride !== undefined ? { allowCardOverride: input.allowCardOverride } : {}),
    ...(input.shelfTag !== undefined ? { shelfTag: input.shelfTag } : {}),
    voiceMap: input.voiceMap,
    stats: { messageCount: 0, chapterCount: 0, charCount: 0 },
    createdAt: now,
    updatedAt: now,
  };
  await writeJsonAtomic(workFile(work.id), work); // 自带 ensureDir
  await writeFile(join(worksDir(), work.id, 'messages.jsonl'), '', 'utf8');
  res.status(201).json(work);
};

/** PATCH 锁内结果：冲突/不存在由 handler 转响应，不混用异常控制流 */
type PatchOutcome = { ok: true; work: Work } | { ok: false; status: 404 | 409; message: string };

// ---------- PATCH /works/:id：乐观锁更新（锁内读-比对-写 revision+1） ----------
export const updateWork: RequestHandler = async (req, res) => {
  const id = req.params.id;
  assertSafeId(id);
  const input = req.body as UpdateWorkInput;

  const outcome = await withWorkLock(id, async (): Promise<PatchOutcome> => {
    const current = await readJson<Work>(workFile(id));
    if (!current) return { ok: false, status: 404, message: '作品不存在' };
    if (current.revision !== input.revision) {
      return {
        ok: false,
        status: 409,
        message: `版本冲突：本地 revision=${input.revision}，服务端已是 ${current.revision}，请刷新后重试`,
      };
    }
    const next: Work = {
      ...current,
      title: input.title ?? current.title,
      genre: input.genre ?? current.genre,
      characterIds: input.characterIds ?? current.characterIds,
      worldbookIds: input.worldbookIds ?? current.worldbookIds,
      factionIds: input.factionIds ?? current.factionIds,
      presetId: input.presetId ?? current.presetId,
      regexScriptIds: input.regexScriptIds ?? current.regexScriptIds,
      settings: input.settings ?? current.settings,
      allowCardOverride: input.allowCardOverride ?? current.allowCardOverride,
      voiceMap: input.voiceMap ?? current.voiceMap,
      viewPreference: input.viewPreference ?? current.viewPreference,
      shelfTag: input.shelfTag ?? current.shelfTag,
      bindings: input.bindings ?? current.bindings,
      revision: current.revision + 1,
      updatedAt: Date.now(),
    };
    await writeJsonAtomic(workFile(id), next);
    return { ok: true, work: next };
  });

  if (!outcome.ok) {
    res.status(outcome.status).json(
      outcome.status === 409
        ? { code: 'CONFLICT', error: outcome.message }
        : { error: outcome.message },
    );
    return;
  }
  res.json(outcome.work);
};

// ---------- DELETE /works/:id：级联删除 data/works/<id>/ 整目录（锁内） ----------
export const deleteWork: RequestHandler = async (req, res) => {
  const id = req.params.id;
  assertSafeId(id);
  await withWorkLock(id, async () => {
    const existing = await readJson<Work>(workFile(id));
    if (!existing) throw new HttpError(404, '作品不存在');
    await rm(join(worksDir(), id), { recursive: true, force: true });
  });
  res.json({ ok: true });
};

// ---------- stats 写入通道（Task 8 消息写入方回调） ----------
/**
 * 刷新作品的统计缓存并落盘。供 Task 8 在消息写入后回调：
 * 调用方须已持该 workId 的 withWorkLock（消息写路径天然持锁），
 * 本函数只做读-改-写，不再排队，避免嵌套等待。
 * 不动 revision/updatedAt——消息流走独立通道，乐观锁只管 work 元数据。
 * 作品不存在返回 null。
 */
export async function updateWorkStats(workId: string, stats: WorkStats): Promise<Work | null> {
  const current = await readJson<Work>(workFile(workId));
  if (!current) return null;
  const next: Work = { ...current, stats: WorkStatsSchema.parse(stats) };
  await writeJsonAtomic(workFile(workId), next);
  return next;
}
