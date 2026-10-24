/**
 * 用户账号服务（安卓 app Phase3 P3.1）：单一作者 + 多读者
 *
 * 存储：data/users.jsonl（一行一用户，密码存 salt+scrypt 哈希，绝不回传）。
 * 种子策略（旧部署无缝升级）：每次启动把作者凭证与 ACCESS_PASSWORD 对齐
 * （固定 username='author'、id='author'，密码=ACCESS_PASSWORD）——旧单密码登录习惯
 * （只输密码不输用户名）由「免用户名匹配哈希」兜底命中作者账号。
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

import { appendLine, readAll, rewriteAll } from '../storage/jsonl';

export interface StoredUser {
  id: string;
  username: string;
  displayName?: string;
  role: 'author' | 'reader';
  salt: string;
  hash: string;
  createdAt: number;
}

/** 用户公开形状（去凭证） */
export type PublicUser = Pick<StoredUser, 'id' | 'username' | 'role'> & { displayName?: string };

export function publicOf(u: StoredUser): PublicUser {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role };
}

const AUTHOR_ID = 'author';
const AUTHOR_USERNAME = 'author';

function usersFile(dataDir: string): string {
  return join(dataDir, 'users.jsonl');
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex');
}

function verifyPassword(password: string, u: StoredUser): boolean {
  const actual = Buffer.from(hashPassword(password, u.salt));
  const expected = Buffer.from(u.hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** 启动种子（幂等）：确保作者账号存在且密码与 ACCESS_PASSWORD 对齐；env 未配则跳过 */
export async function seedAuthor(dataDir: string): Promise<void> {
  const password = process.env.ACCESS_PASSWORD;
  if (!password) return;
  const file = usersFile(dataDir);
  const all = await readAll<StoredUser>(file);
  const existing = all.find((u) => u.id === AUTHOR_ID);
  if (existing && verifyPassword(password, existing)) return; // 已对齐
  const salt = randomBytes(16).toString('hex');
  const seeded: StoredUser = {
    id: AUTHOR_ID,
    username: AUTHOR_USERNAME,
    displayName: '作者',
    role: 'author',
    salt,
    hash: hashPassword(password, salt),
    createdAt: existing?.createdAt ?? Date.now(),
  };
  const next = existing ? all.map((u) => (u.id === AUTHOR_ID ? seeded : u)) : [...all, seeded];
  await rewriteAll(file, next);
}

/** 登录校验：username 给定精确匹配；缺省遍历哈希命中（旧单密码习惯） */
export async function verifyLogin(dataDir: string, password: string, username?: string): Promise<StoredUser | null> {
  const all = await readAll<StoredUser>(usersFile(dataDir));
  const candidates = username ? all.filter((u) => u.username === username) : all;
  for (const u of candidates) {
    if (verifyPassword(password, u)) return u;
  }
  return null;
}

/** 按 id 查公开用户（/auth/me 用）；不存在返回 null */
export async function findUserById(dataDir: string, uid: string): Promise<PublicUser | null> {
  const all = await readAll<StoredUser>(usersFile(dataDir));
  const u = all.find((x) => x.id === uid);
  return u ? publicOf(u) : null;
}

/** 读者注册：username 唯一；role 恒为 reader（作者账号仅种子通道） */
export async function registerReader(
  dataDir: string,
  username: string,
  password: string,
  displayName?: string,
): Promise<{ ok: true; user: StoredUser } | { ok: false; error: string }> {
  const file = usersFile(dataDir);
  const all = await readAll<StoredUser>(file);
  if (all.some((u) => u.username === username)) {
    return { ok: false, error: '用户名已被占用' };
  }
  const salt = randomBytes(16).toString('hex');
  const user: StoredUser = {
    id: randomBytes(8).toString('hex'),
    username,
    displayName: displayName?.trim() || username,
    role: 'reader',
    salt,
    hash: hashPassword(password, salt),
    createdAt: Date.now(),
  };
  await appendLine(file, user);
  return { ok: true, user };
}
