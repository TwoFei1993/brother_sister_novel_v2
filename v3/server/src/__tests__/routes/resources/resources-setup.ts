/**
 * 资源中心路由测试共享装置（resources.test.ts / resources-remote.test.ts 共用）
 *
 * 自装配最小 express app（同 library.test.ts）；DATA_DIR 指向临时目录；
 * DNS lookup 一律 mock（review #4 SSRF 用例需注入私网解析结果，且 stub fetch 域名
 * 不应触发真实 DNS）：默认解析到公网 IP，私网用例逐次覆盖。
 */
import { afterAll, afterEach, beforeAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';
import { vi } from 'vitest';
import { ZodError } from 'zod';

import { signToken } from '../../../middleware/auth';
import { HttpError } from '../../../middleware/validate';
import { libraryRouter } from '../../../routes/library';

// DNS lookup mock：默认公网地址（hoisted 供 vi.mock 工厂与用例内覆写共用；
// hoisted 变量不可直接导出，跨文件经 setDnsResolution/rejectDnsLookup 操作）
const lookupMock = vi.hoisted(() =>
  vi.fn(async (_hostname: string, _options?: unknown) => [{ address: '93.184.216.34', family: 4 }]),
);
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

/** 覆写下一次 DNS 解析结果（SSRF 用例注入私网地址） */
export function setDnsResolution(address: string, family: number): void {
  lookupMock.mockResolvedValueOnce([{ address, family }]);
}

/** 覆写下一次 DNS 解析为失败（域名不存在用例） */
export function rejectDnsLookup(reason: string): void {
  lookupMock.mockRejectedValueOnce(new Error(reason));
}

export const authed = (): { Cookie: string } => ({ Cookie: `token=${signToken()}` });

/** 与 app.ts 同语义的最小错误处理（HttpError→状态码，ZodError→400，其余→500） */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: '请求不合法' });
    return;
  }
  res.status(500).json({ error: '服务器内部错误' });
}

/** 独立装配：libraryRouter 挂 /api + 错误处理，不起真实端口 */
export function makeApp(): Express {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api', libraryRouter);
  app.use(errorHandler);
  return app;
}

/** 永不完成、signal abort 时以 TimeoutError 拒绝的 fetch（模拟上游超时） */
export function stubTimeoutFetch(): void {
  vi.stubGlobal(
    'fetch',
    (_url: unknown, init?: { signal?: AbortSignal }): Promise<never> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted due to timeout');
          err.name = 'TimeoutError';
          reject(err);
        });
      }),
  );
}

let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-resources-'));
  process.env.DATA_DIR = root;
  process.env.RESOURCES_FETCH_TIMEOUT_MS = '200'; // 超时用例 0.2s 内返回
});

afterAll(async () => {
  delete process.env.RESOURCES_FETCH_TIMEOUT_MS;
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals(); // 每用例独立的 fetch stub，互不泄漏
});
