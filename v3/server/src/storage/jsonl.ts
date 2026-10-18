// messages.jsonl 读写策略（设计 §4.5/§4.6）：
// 追加 = 行级 append（调用方须持 per-work 锁）；编辑/删除中间行 = 整文件 tmp+rename 重写；
// 读取支持尾部窗口（tail）、游标分页（before）、增量同步（since）三种窗口。
// 当前实现为整文件读入后切片：单用户场景文件量级可控；文件超大时可再优化为反向块读。

import { appendFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** 行对象约束：必须带唯一 id，游标/增量都以 id 定位 */
type HasId = { id: string };

/**
 * 读取全部行：跳过空行，逐行 JSON.parse；文件不存在返回 []。
 * 单行损坏时跳过该行（原子写保证正常不会有坏行，这里只防单行损坏导致整个作品打不开）。
 */
export async function readAll<T extends HasId>(file: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // 坏行跳过，不打断整体读取
    }
  }
  return out;
}

/** 尾部 n 条（打开作品的默认视图，设计 §4.6 tail=50） */
export async function readTail<T extends HasId>(file: string, n: number): Promise<T[]> {
  const all = await readAll<T>(file);
  return all.slice(-n);
}

/**
 * 游标分页：返回 beforeId 之前的 limit 条。
 * beforeId 不存在时返回尾部 limit 条（锚点失效时兜底到最新窗口，语义由测试锁定）。
 */
export async function readBefore<T extends HasId>(
  file: string,
  beforeId: string,
  limit: number,
): Promise<T[]> {
  const all = await readAll<T>(file);
  const idx = all.findIndex((m) => m.id === beforeId);
  if (idx < 0) return all.slice(-limit);
  return all.slice(Math.max(0, idx - limit), idx);
}

/**
 * 增量同步：返回 sinceId 之后的全部行。
 * sinceId 不存在时返回全部行（多端对齐兜底，语义由测试锁定）。
 */
export async function readSince<T extends HasId>(file: string, sinceId: string): Promise<T[]> {
  const all = await readAll<T>(file);
  const idx = all.findIndex((m) => m.id === sinceId);
  if (idx < 0) return all;
  return all.slice(idx + 1);
}

/** 追加一行 JSON（调用方须持 per-work 锁；目录不存在时自动创建） */
export async function appendLine<T extends HasId>(file: string, obj: T): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(obj)}\n`, 'utf8');
}

/** 整文件重写（编辑/删除中间行时用）：tmp+rename 原子替换，旧行整体被替换 */
export async function rewriteAll<T extends HasId>(file: string, objs: T[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const body = objs.map((o) => JSON.stringify(o)).join('\n');
  await writeFile(tmp, objs.length > 0 ? `${body}\n` : '', 'utf8');
  await unlink(file).catch(() => undefined);
  await rename(tmp, file);
}
