/**
 * 鉴权（设计 §6 + 安卓 app Phase3 P3.1）：HMAC-SHA256 签名 token 存 HttpOnly cookie
 *
 * token 格式：base64url(JSON({exp,uid,role})) + '.' + base64url(HMAC-SHA256(payload))
 * 账号体系：单一作者（种子=ACCESS_PASSWORD 对齐）+ 多读者（注册）；旧单密码习惯兼容
 * （login 不带 username 时遍历哈希匹配）。密钥：env AUTH_SECRET 优先，未设置进程内随机。
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { RequestHandler, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { dataDir } from '../routes/core/paths';
import { findUserById, publicOf, registerReader, seedAuthor, verifyLogin } from '../services/users';
import { zodBody } from './validate';

const COOKIE_NAME = 'token';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

/** 请求上的登录态（authRequired 注入） */
export interface AuthInfo {
  uid: string;
  role: 'author' | 'reader';
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

// ---------- 密钥与签名 ----------
let randomSecret: string | null = null;
function getSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  randomSecret ??= randomBytes(32).toString('hex');
  return randomSecret;
}

function hmac(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

/** 恒定时间比较：先 sha256 归一长度（timingSafeEqual 要求等长，且防长度侧信道） */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export interface TokenPayload {
  exp: number;
  uid?: string;
  role?: 'author' | 'reader';
}

/** 签发 token：payload={exp,uid,role}；ttlMs 可注入（测试传负值构造过期 token） */
export function signToken({
  ttlMs = TOKEN_TTL_MS,
  uid,
  role,
}: { ttlMs?: number; uid?: string; role?: 'author' | 'reader' } = {}): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + ttlMs, uid, role })).toString('base64url');
  return `${payload}.${hmac(payload)}`;
}

/** 校验 token：签名一致且未过期；有效返回登录态，否则 null。
 * 兼容：P3 前签发的旧 token（无 uid/role）= 单密码作者语义，视为作者登录（升级期 7 天 TTL 内平滑过渡）。 */
export function verifyToken(token: string | undefined): AuthInfo | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  if (!safeEqual(token.slice(dot + 1), hmac(payload))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString()) as TokenPayload;
    if (typeof p.exp !== 'number' || p.exp <= Date.now()) return null;
    if (!p.uid || !p.role) return { uid: 'author', role: 'author' };
    return { uid: p.uid, role: p.role };
  } catch {
    return null;
  }
}

/** 极简 cookie 读取（单 cookie 场景，不引 cookie-parser） */
function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

/** 登录态守卫：无有效 token 一律 401（错误消息供前端 toast 直接展示）；有效则注入 req.auth */
export const authRequired: RequestHandler = (req, res, next) => {
  const auth = verifyToken(readCookie(req, COOKIE_NAME));
  if (auth) {
    req.auth = auth;
    next();
    return;
  }
  res.status(401).json({ error: '未登录或登录已过期，请重新登录' });
};

/** 作者专属守卫（P3.1 权限分级）：读者/未登录一律 403/401 */
export const requireAuthor: RequestHandler = (req, res, next) => {
  const auth = verifyToken(readCookie(req, COOKIE_NAME));
  if (!auth) {
    res.status(401).json({ error: '未登录或登录已过期，请重新登录' });
    return;
  }
  if (auth.role !== 'author') {
    res.status(403).json({ error: '该操作仅作者可用' });
    return;
  }
  req.auth = auth;
  next();
};

// ---------- 路由 ----------
const loginSchema = z.object({
  /** 用户名可选：缺省=旧单密码习惯（遍历账号哈希匹配，兜底命中作者种子） */
  username: z.string().optional(),
  password: z.string().min(1, '密码不能为空'),
});

export const authRouter = Router();

function setAuthCookie(req: { secure: boolean }, token: string, res: Response): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Secure 跟随实际请求协议（req.secure + trust proxy）：HTTPS 部署带 Secure，
    // HTTP 直连部署（如 IP:3001）不带——否则浏览器在 http 下不回传 cookie，登录后全 401
    secure: req.secure,
    path: '/',
    maxAge: TOKEN_TTL_MS,
  });
}

authRouter.post('/login', zodBody(loginSchema), async (req, res) => {
  const dir = dataDir();
  await seedAuthor(dir); // 幂等对齐作者凭证（随 ACCESS_PASSWORD 轮换）
  const user = await verifyLogin(dir, req.body.password, req.body.username);
  if (!user) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }
  setAuthCookie(req, signToken({ uid: user.id, role: user.role }), res);
  res.json({ ok: true, user: publicOf(user) });
});

const registerSchema = z.object({
  username: z.string().min(2, '用户名至少 2 个字符'),
  password: z.string().min(6, '密码至少 6 位'),
  displayName: z.string().optional(),
});

/** 读者注册（作者账号仅种子通道，不接受注册） */
authRouter.post('/register', zodBody(registerSchema), async (req, res) => {
  const result = await registerReader(dataDir(), req.body.username, req.body.password, req.body.displayName);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  setAuthCookie(req, signToken({ uid: result.user.id, role: result.user.role }), res);
  res.status(201).json({ ok: true, user: publicOf(result.user) });
});

authRouter.get('/check', authRequired, (_req, res) => {
  res.json({ ok: true });
});

/** 当前登录用户公开信息（P3：前端身份展示/评论署名用） */
authRouter.get('/me', authRequired, async (req, res) => {
  const user = await findUserById(dataDir(), req.auth?.uid ?? '');
  res.json({ user });
});

authRouter.post('/logout', (_req, res) => {
  // 无状态 HMAC 设计（§6）：服务端不存会话，登出 = 下发过期 Set-Cookie 覆盖浏览器侧
  // token（path/secure 与签发时一致才能正确覆盖）；已签发 token 在 TTL 内仍自洽有效，
  // 单实例单密码场景可接受。200 恒定返回（重复登出幂等）。
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  res.json({ ok: true });
});
