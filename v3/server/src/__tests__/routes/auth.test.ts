/**
 * 单密码鉴权测试（TDD，Task 3）
 *
 * 覆盖：登录密码校验、HttpOnly cookie 下发、authRequired 拦截、
 * 签名篡改拒绝、过期 token 拒绝。supertest 直接打内存 app，不起真实端口。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Response } from 'supertest';

import { createApp } from '../../app';
import { signToken } from '../../middleware/auth';

// auth 模块每次请求实时读 env，beforeEach 设定即可覆盖全部用例
beforeEach(() => {
  process.env.ACCESS_PASSWORD = 'test123';
});

/** 从 set-cookie 响应头提取 token=xxx 的值（供带 cookie 复访用） */
function tokenFrom(res: Response): string {
  const setCookie = res.headers['set-cookie'];
  expect(setCookie, '登录响应应携带 Set-Cookie').toBeTruthy();
  const joined = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
  const match = /token=([^;]+)/.exec(joined);
  expect(match, 'cookie 中应包含 token 字段').toBeTruthy();
  return match![1];
}

describe('POST /api/auth/login', () => {
  it('错误密码 → 401', async () => {
    const res = await request(createApp())
      .post('/api/auth/login')
      .send({ password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it('正确密码 → 200 + Set-Cookie 含 HttpOnly token', async () => {
    const res = await request(createApp())
      .post('/api/auth/login')
      .send({ password: 'test123' });
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] ?? [];
    const joined = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
    expect(joined).toContain('token=');
    expect(joined).toContain('HttpOnly');
  });

  it('缺少 password 字段 → 400（zod 校验）', async () => {
    const res = await request(createApp()).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/check（authRequired 中间件）', () => {
  it('无 cookie → 401', async () => {
    const res = await request(createApp()).get('/api/auth/check');
    expect(res.status).toBe(401);
  });

  it('登录后带 cookie 复访 → 200 {ok:true}', async () => {
    const app = createApp();
    const login = await request(app).post('/api/auth/login').send({ password: 'test123' });
    const res = await request(app)
      .get('/api/auth/check')
      .set('Cookie', `token=${tokenFrom(login)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('篡改签名 → 401', async () => {
    const app = createApp();
    const login = await request(app).post('/api/auth/login').send({ password: 'test123' });
    const token = tokenFrom(login);
    // 翻转签名末字符（保持 base64url 字符集内，确保是"签名对不上"而非"格式坏"）
    const [payload, sig] = token.split('.');
    const last = sig!.at(-1)!;
    const flipped = last === 'A' ? 'B' : 'A';
    const res = await request(app)
      .get('/api/auth/check')
      .set('Cookie', `token=${payload}.${sig!.slice(0, -1)}${flipped}`);
    expect(res.status).toBe(401);
  });

  it('过期 token（合法签名但 exp 已过）→ 401', async () => {
    const expired = signToken({ ttlMs: -1000 });
    const res = await request(createApp())
      .get('/api/auth/check')
      .set('Cookie', `token=${expired}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout（D5 登出）', () => {
  it('登录后 logout → 200 + Set-Cookie 下发过期 token，随后 check 401（cookie jar 已清）', async () => {
    const app = createApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ password: 'test123' });
    const before = await agent.get('/api/auth/check');
    expect(before.status).toBe(200); // 登录态就绪
    const logout = await agent.post('/api/auth/logout');
    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ ok: true });
    const setCookie = String(logout.headers['set-cookie']);
    expect(setCookie).toContain('token='); // 覆盖同名 cookie
    expect(/expires=Thu, 01 Jan 1970|max-age=0/i.test(setCookie)).toBe(true); // 过期标记
    const after = await agent.get('/api/auth/check');
    expect(after.status).toBe(401); // agent cookie jar 应用了过期 Set-Cookie → 登录态终止
  });

  it('未登录直接 logout → 200 幂等（不因无 cookie 报错）', async () => {
    const res = await request(createApp()).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});


describe('cookie Secure 标记随请求协议（HTTP 直连部署登录可用）', () => {
  it('HTTP 请求（req.secure=false）→ Set-Cookie 不含 Secure，浏览器可回传', async () => {
    const res = await request(createApp())
      .post('/api/auth/login')
      .send({ password: 'test123' });
    expect(res.status).toBe(200);
    const setCookie = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'].join('; ') : String(res.headers['set-cookie'] ?? '');
    expect(setCookie).toContain('token=');
    expect(setCookie).not.toContain('Secure');
  });

  it('HTTPS 请求（X-Forwarded-Proto=https + trust proxy）→ Set-Cookie 含 Secure', async () => {
    const res = await request(createApp())
      .post('/api/auth/login')
      .set('X-Forwarded-Proto', 'https')
      .send({ password: 'test123' });
    const setCookie = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'].join('; ') : String(res.headers['set-cookie'] ?? '');
    expect(setCookie).toContain('token=');
    expect(setCookie).toContain('Secure');
  });
});
