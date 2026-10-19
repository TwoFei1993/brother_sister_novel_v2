/**
 * 上传超限 413 测试（review #8）：multer LIMIT_FILE_SIZE 此前落入兜底 500，
 * 现经统一 errorHandler（app.ts）识别转 413 人话。走真实 createApp 验证该分支。
 * 构造 21MB Buffer 直传角色卡导入端点（multer 限 20MB）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { createApp } from '../../app';
import { signToken } from '../../middleware/auth';

let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-upload-'));
  process.env.DATA_DIR = root;
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

describe('multer 上传超限（review #8）', () => {
  it('上传 >20MB 文件 → 413「文件超过大小限制」（非 500）', async () => {
    const app = createApp();
    const big = Buffer.alloc(21 * 1024 * 1024, 0x41);
    const res = await request(app)
      .post('/api/io/characters/import')
      .set('Cookie', `token=${signToken()}`)
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('文件超过大小限制');
  });
});
