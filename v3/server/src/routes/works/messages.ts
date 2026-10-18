/**
 * messages 路由（设计 §4.5 / §4.6 / §6）：JSONL 消息流
 *
 * 读（§4.6 三窗口，一次 readAll 完成切片与 hasMore）：
 *   ?tail=50（默认，打开作品的尾部窗口）/?before=<msgId>&limit=50（向上翻页游标）/?since=<msgId>（多端增量）
 * 写（§4.5 写策略，全部在 withWorkLock 内）：
 *   POST = 按 messageId 幂等 upsert（存在整行替换，不存在追加）——生成入库可安全重试（§9.2）
 *   PATCH = last-write-wins 整条替换（swipe 切换/编辑）
 *   DELETE = 整文件重写去掉该行
 * 每次写后锁内重算 stats 缓存（messageCount/chapterCount/charCount）并落 work.json，
 * 书架读取只看缓存不扫全文件（§4.6）。
 */
import { join } from 'node:path';
import type { RequestHandler } from 'express';
import { Router } from 'express';

import { HttpError, zodBody } from '../../middleware/validate';
import { withWorkLock } from '../../middleware/writer';
import { appendLine, readAll, readWindow, rewriteAll } from '../../storage/jsonl';
import { MessageSchema, type Message } from '@shared/message';
import type { WorkStats } from '@shared/work';
import { assertSafeId, readWork, updateWorkStats, wrap, worksDir } from './works';

/** 作品消息文件（与 works.ts 同一布局：data/works/<id>/messages.jsonl，§4.1；复用同一解析杜绝 cwd 漂移） */
function messagesFile(id: string): string {
  return join(worksDir(), id, 'messages.jsonl');
}

// ---------- GET /works/:id/messages：三窗口读取 ----------

/** 解析正整数 query（tail/limit 共用）；非法或超上限 → 400（上限防一次性拖全量内存） */
function parsePositive(raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 1000) {
    throw new HttpError(400, `分页参数须为 1-1000 的整数，收到 "${String(raw)}"`);
  }
  return n;
}

export const listMessages: RequestHandler = async (req, res) => {
  const id = req.params.id;
  assertSafeId(id);
  await readWork(id); // 作品不存在 → 404

  // 三选一：since 优先 > before > tail（默认）
  const since = req.query.since;
  const before = req.query.before;
  const mode =
    since !== undefined
      ? ({ kind: 'since', sinceId: String(since) } as const)
      : before !== undefined
        ? ({ kind: 'before', beforeId: String(before), limit: parsePositive(req.query.limit, 50) } as const)
        : ({ kind: 'tail', n: parsePositive(req.query.tail, 50) } as const);

  const { messages, hasMore } = await readWindow<Message>(messagesFile(id), mode);
  res.json(hasMore === undefined ? { messages } : { messages, hasMore });
};

// ---------- stats 重算（§4.6：写入方维护缓存） ----------

/** 统计口径：总数 / 带 chapter 元数据的消息数（章）/ assistant 正文总长（字） */
function computeStats(messages: Message[]): WorkStats {
  let chapterCount = 0;
  let charCount = 0;
  for (const m of messages) {
    if (m.chapter !== undefined) chapterCount += 1;
    if (m.role === 'assistant') charCount += m.content.length;
  }
  return { messageCount: messages.length, chapterCount, charCount };
}

// ---------- POST：幂等 upsert（§9.2 生成完成入库） ----------

export const upsertMessage: RequestHandler = async (req, res) => {
  const id = req.params.id;
  assertSafeId(id);
  const msg = req.body as Message;

  const revision = await withWorkLock(id, async () => {
    await readWork(id); // 锁内判存在，与写路径同锁避免竞态
    const file = messagesFile(id);
    const all = await readAll<Message>(file);
    const idx = all.findIndex((m) => m.id === msg.id);
    if (idx >= 0) {
      all[idx] = msg; // 幂等 upsert：同 id 整行替换，重发不产生重复
      await rewriteAll(file, all);
    } else {
      all.push(msg);
      await appendLine(file, msg); // 追加走行级 append，不整文件重写
    }
    const work = await updateWorkStats(id, computeStats(all));
    return work?.revision;
  });

  res.json({ ok: true, revision });
};

// ---------- PATCH /:mid：last-write-wins 整条替换 ----------

export const updateMessage: RequestHandler = async (req, res) => {
  const id = req.params.id;
  assertSafeId(id);
  const msg = req.body as Message;
  const mid = req.params.mid;
  if (msg.id !== mid) throw new HttpError(400, '消息 id 与路径不一致');

  await withWorkLock(id, async () => {
    await readWork(id);
    const file = messagesFile(id);
    const all = await readAll<Message>(file);
    const idx = all.findIndex((m) => m.id === mid);
    if (idx < 0) throw new HttpError(404, '消息不存在');
    all[idx] = msg; // 后写整条覆盖（单用户并发语义，§4.5）
    await rewriteAll(file, all);
    await updateWorkStats(id, computeStats(all));
  });

  res.json({ ok: true });
};

// ---------- DELETE /:mid：整文件重写去掉该行 ----------

export const deleteMessage: RequestHandler = async (req, res) => {
  const id = req.params.id;
  assertSafeId(id);
  const mid = req.params.mid;

  await withWorkLock(id, async () => {
    await readWork(id);
    const file = messagesFile(id);
    const all = await readAll<Message>(file);
    const next = all.filter((m) => m.id !== mid);
    if (next.length === all.length) throw new HttpError(404, '消息不存在');
    await rewriteAll(file, next);
    await updateWorkStats(id, computeStats(next));
  });

  res.json({ ok: true });
};

// ---------- 路由组（挂载于 /works/:id/messages，见 index.ts） ----------

export const messagesRouter = Router({ mergeParams: true }); // 合并父路由 /works/:id 的 :id 参数

messagesRouter.get('/', wrap(listMessages));
messagesRouter.post('/', zodBody(MessageSchema), wrap(upsertMessage));
messagesRouter.patch('/:mid', zodBody(MessageSchema), wrap(updateMessage));
messagesRouter.delete('/:mid', wrap(deleteMessage));
