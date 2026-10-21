/**
 * 单密码鉴权（设计 §6）：HMAC-SHA256 签名 token 存 HttpOnly cookie
 *
 * token 格式：base64url(JSON({exp})) + '.' + base64url(HMAC-SHA256(payload))
 * 密钥：env AUTH_SECRET 优先；未设置则进程内随机（单实例部署，重启后需重登录，可接受）。
 * 不引 jsonwebtoken——payload 仅 {exp}，自实现 20 行足够。
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { zodBody } from './validate';

const COOKIE_NAME = 'token';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

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

/** 签发 token：payload={exp}；ttlMs 可注入（测试传负值构造过期 token） */
export function signToken({ ttlMs = TOKEN_TTL_MS }: { ttlMs?: number } = {}): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + ttlMs })).toString('base64url');
  return `${payload}.${hmac(payload)}`;
}

/** 校验 token：签名一致且未过期；任何格式异常一律 false */
export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  if (!safeEqual(token.slice(dot + 1), hmac(payload))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: unknown };
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
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

/** 登录态守卫：无有效 token 一律 401（错误消息供前端 toast 直接展示） */
export const authRequired: RequestHandler = (req, res, next) => {
  if (verifyToken(readCookie(req, COOKIE_NAME))) {
    next();
    return;
  }
  res.status(401).json({ error: '未登录或登录已过期，请重新登录' });
};

// ---------- 路由 ----------
const loginSchema = z.object({ password: z.string().min(1, '密码不能为空') });

export const authRouter = Router();

authRouter.post('/login', zodBody(loginSchema), (req, res) => {
  const expected = process.env.ACCESS_PASSWORD;
  if (!expected) {
    res.status(503).json({ error: '服务端未配置 ACCESS_PASSWORD，无法登录' });
    return;
  }
  if (!safeEqual(req.body.password, expected)) {
    res.status(401).json({ error: '密码错误' });
    return;
  }
  res.cookie(COOKIE_NAME, signToken(), {
    httpOnly: true,
    sameSite: 'lax',
    // 生产仅经 HTTPS 传输；本地 http dev（NODE_ENV 未设/development）不启用以免登录失效（review #14）
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TOKEN_TTL_MS,
  });
  res.json({ ok: true });
});

authRouter.get('/check', authRequired, (_req, res) => {
  res.json({ ok: true });
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
