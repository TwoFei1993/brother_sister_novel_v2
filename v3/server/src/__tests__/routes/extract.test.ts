/**
 * Word 文档提取路由测试（向导「从 Word 导入」）
 *
 * jszip 程序化构建最小合法 .docx（OPC 三件套：[Content_Types].xml + _rels/.rels +
 * word/document.xml），supertest 直传内存 app。覆盖：正常提取（段落换行保留）、
 * 伪装文件 422、空文档 422、未登录 401、超限 413。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import request from 'supertest';

import { createApp } from '../../app';
import { signToken } from '../../middleware/auth';

const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function documentXml(paragraphs: string[]): string {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

/** 最小合法 .docx（段落文本数组 → zip Buffer） */
async function buildDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CT);
  zip.file('_rels/.rels', RELS);
  zip.file('word/document.xml', documentXml(paragraphs));
  return zip.generateAsync({ type: 'nodebuffer' });
}

let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-extract-'));
  process.env.DATA_DIR = root;
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

describe('POST /api/extract/docx', () => {
  it('合法 docx → 200：两段中文文本均提取且段落换行保留', async () => {
    const docx = await buildDocx(['第一段：沈清晏立于廊下。', '第二段：第1章 入府']);
    const res = await request(createApp())
      .post('/api/extract/docx')
      .set('Cookie', `token=${signToken()}`)
      .attach('file', docx, { filename: '大纲.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    expect(res.status).toBe(200);
    expect(res.body.text).toContain('沈清晏');
    expect(res.body.text).toContain('第1章');
    expect(res.body.text).toContain('\n');
    expect(res.body.chars).toBe([...(res.body.text as string)].length);
  });

  it('.txt 伪装 docx → 422 人话错误', async () => {
    const res = await request(createApp())
      .post('/api/extract/docx')
      .set('Cookie', `token=${signToken()}`)
      .attach('file', Buffer.from('这只是普通文本'), { filename: 'fake.docx' });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('无法从该 Word 文档提取文字');
  });

  it('空文档（无文字段落）→ 422「没有可提取的文字内容」', async () => {
    const docx = await buildDocx(['   ']);
    const res = await request(createApp())
      .post('/api/extract/docx')
      .set('Cookie', `token=${signToken()}`)
      .attach('file', docx, { filename: 'empty.docx' });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('没有可提取的文字内容');
  });

  it('未登录（无 cookie）→ 401', async () => {
    const docx = await buildDocx(['任意段落']);
    const res = await request(createApp()).post('/api/extract/docx').attach('file', docx, { filename: 'a.docx' });
    expect(res.status).toBe(401);
  });

  it('超过 20MB → 413「文件超过大小限制」', async () => {
    const big = Buffer.alloc(21 * 1024 * 1024, 0x41);
    const res = await request(createApp())
      .post('/api/extract/docx')
      .set('Cookie', `token=${signToken()}`)
      .attach('file', big, { filename: 'big.docx' });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('文件超过大小限制');
  });
});
