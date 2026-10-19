/**
 * 酒馆资产导入导出测试 — 正则脚本与错误边界（TDD，Task 25）
 *
 * 覆盖：正则手写样本导入导出 roundtrip（含未知字段保真）、非法 JSON/非法结构 400、
 * multipart 非 JSON 拒收、鉴权 401、导出 404 / 缺 id 400 / 缺文件 400。
 * 世界书与预设见 tavern-io.test.ts，共享装置见 tavern-io-setup.ts。
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { authed, exportParsed, exportRaw, importJson, importOk, makeApp } from './tavern-io-setup';

// ---------- 正则脚本：手写样本 roundtrip ----------

describe('正则脚本导入导出', () => {
  /** 按 extensions/regex 引擎字段手写样本，含未知扩展字段验证保真 */
  const regexJson = {
    id: 'regex-001',
    scriptName: '状态栏美化',
    findRegex: '/<status>([\\s\\S]*?)<\\/status>/g',
    replaceString: '<details>$1</details>',
    trimStrings: ['  ', '\\n'],
    placement: [1, 2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    some_future_field: { nested: true },
  };

  it('导入 → GET → raw 全字段保真（含未知字段），name 取 scriptName', async () => {
    const asset = await importOk('regex-scripts', JSON.stringify(regexJson), '状态栏美化.json');
    expect(asset.name).toBe('状态栏美化');
    // 资产读取走 Task 6 标准 CRUD 路由
    const res = await request(makeApp()).get(`/api/regex-scripts/${asset.id}`).set(authed());
    expect(res.status).toBe(200);
    expect(res.body.raw).toEqual(regexJson);
  });

  it('导出 → raw 与导入原样深比较（roundtrip 无丢失）', async () => {
    const asset = await importOk('regex-scripts', JSON.stringify(regexJson), '状态栏美化.json');
    const exported = await exportParsed('regex-scripts', asset.id);
    expect(exported).toEqual(regexJson);
  });

  it('正则结构不符 → 400 人话错误', async () => {
    const res = await importJson('regex-scripts', JSON.stringify({ foo: 1 }), '坏正则.json');
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('正则');
  });
});

// ---------- 校验、鉴权与上传边界 ----------

describe('校验、鉴权与上传边界', () => {
  it('非法 JSON 内容 → 400 人话错误', async () => {
    const res = await importJson('worldbooks', '{ 这不是 JSON ', 'broken.json');
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('JSON');
  });

  it('multipart 上传非 JSON 文件（text/plain）→ 400', async () => {
    const res = await request(makeApp())
      .post('/api/io/worldbooks/import')
      .set(authed())
      .attach('file', Buffer.from('纯文本内容，不是 JSON', 'utf8'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('JSON');
  });

  it('合法 JSON 但不是世界书结构 → 400 指明世界书不合法', async () => {
    const res = await importJson('worldbooks', JSON.stringify({ foo: 1 }), '不是世界书.json');
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('世界书');
  });

  it('未登录上传 → 401；未登录导出 → 401', async () => {
    const noAuth = request(makeApp());
    const up = await noAuth
      .post('/api/io/worldbooks/import')
      .attach('file', Buffer.from('{}'), { filename: 'x.json' });
    expect(up.status).toBe(401);
    const down = await request(makeApp())
      .post('/api/io/worldbooks/export')
      .send({ id: 'whatever' });
    expect(down.status).toBe(401);
  });

  it('导出不存在的 id → 404；导出 body 缺 id → 400；导入缺文件 → 400', async () => {
    const miss = await exportRaw('presets', '00000000-0000-4000-8000-000000000000');
    expect(miss.status).toBe(404);
    const noId = await request(makeApp())
      .post('/api/io/presets/export')
      .set(authed())
      .send({});
    expect(noId.status).toBe(400);
    const noFile = await request(makeApp())
      .post('/api/io/worldbooks/import')
      .set(authed());
    expect(noFile.status).toBe(400);
  });
});
