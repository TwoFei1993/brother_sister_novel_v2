// 通用 JSON 文件存储原语（设计 §4.5/§4.7）：
// 纯路径操作——数据根目录由调用方传入（路由层从 env DATA_DIR 解析），本层不读 env。
// 写入统一走 tmp+rename 原子替换，保证任意时刻磁盘上的文件都是完整可解析的。

import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** 确保目录存在（递归创建，幂等） */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** 列出目录下的文件/子目录名；目录不存在时返回空数组（列表语义） */
export async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/**
 * 读取并解析 JSON 文件；文件不存在返回 null。
 * 文件存在但内容非法 JSON 时抛错——数据损坏必须暴露，不能静默吞掉。
 */
export async function readJson<T>(file: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  return JSON.parse(raw) as T;
}

/**
 * 原子写 JSON：先写 <file>.tmp，再 rename 到目标。
 * Windows 上 rename 不能覆盖已存在文件（EPERM），故 rename 前先 unlink 目标（不存在则容错跳过）。
 * 任意时刻目标文件要么是旧完整内容、要么是新完整内容，不会出现半截 JSON。
 */
export async function writeJsonAtomic<T>(file: string, data: T): Promise<void> {
  await ensureDir(dirname(file));
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await unlink(file).catch(() => undefined);
  await rename(tmp, file);
}

/** 删除文件；文件不存在视为已删除（幂等） */
export async function deleteFile(file: string): Promise<void> {
  await unlink(file).catch(() => undefined);
}
