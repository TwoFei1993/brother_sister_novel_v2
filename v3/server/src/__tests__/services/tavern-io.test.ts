/**
 * 酒馆资产导入导出测试 — 世界书与预设（TDD，Task 25）
 *
 * 覆盖：fixture 导入→GET 深比较、位置归一（ANTop/EMTop→before、ANBottom/EMBottom→after）、
 * prompt_order 取 character_id=100001、导出 roundtrip。
 * 正则与错误边界见 tavern-io-regex.test.ts，共享装置见 tavern-io-setup.ts。
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { authed, eldoriaRaw, defaultPresetRaw, exportParsed, exportRaw, importJson, importOk, makeApp, UUID_RE } from './tavern-io-setup';

// ---------- 世界书：fixture roundtrip ----------

describe('世界书导入导出（Eldoria fixture）', () => {
  it('导入 Eldoria.json → GET 资产 → raw 全字段深比较无丢失，name 取文件名', async () => {
    const asset = await importOk('worldbooks', JSON.stringify(eldoriaRaw), 'Eldoria.json');
    expect(asset.id).toMatch(UUID_RE);
    expect(asset.name).toBe('Eldoria');
    // 资产读取走 Task 6 标准 CRUD 路由（io-assets 与 CRUD 共用 libraryDir 目录约定）
    const res = await request(makeApp()).get(`/api/worldbooks/${asset.id}`).set(authed());
    expect(res.status).toBe(200);
    // Eldoria 条目 position 全 0/1，无归一化改动 → 与原文件全等
    expect(res.body.raw).toEqual(eldoriaRaw);
  });

  it('导出 → raw JSON 下载 → 与导入后的 raw 深比较（归一后保真）', async () => {
    const asset = await importOk('worldbooks', JSON.stringify(eldoriaRaw), 'Eldoria.json');
    const res = await exportRaw('worldbooks', asset.id);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const exported = JSON.parse(res.text) as unknown;
    expect(exported).toEqual(asset.raw);
    expect(exported).toEqual(eldoriaRaw);
  });
});

// ---------- 位置归一化（设计 §5.2：ANTop/EMTop→before、ANBottom/EMBottom→after） ----------

describe('世界书位置归一化', () => {
  /** position 0..6 各一条 + 顶层附加字段（验证归一化不动其余字段） */
  const book = {
    name: '位置样本',
    originalMeta: { keep: true },
    entries: Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map((p) => [
        String(p),
        { uid: p, key: [`k${p}`], content: `内容${p}`, position: p, order: 100 - p },
      ]),
    ),
  };

  it('position 2/5 → 0（before），3/6 → 1（after），0/1/4 保留', async () => {
    const asset = await importOk('worldbooks', JSON.stringify(book), '位置样本.json');
    const entries = (asset.raw as { entries: Record<string, { position: number }> }).entries;
    expect(entries['2']?.position).toBe(0); // ANTop → before
    expect(entries['5']?.position).toBe(0); // EMTop → before
    expect(entries['3']?.position).toBe(1); // ANBottom → after
    expect(entries['6']?.position).toBe(1); // EMBottom → after
    expect(entries['0']?.position).toBe(0); // before 原样
    expect(entries['1']?.position).toBe(1); // after 原样
    expect(entries['4']?.position).toBe(4); // atDepth 原样（深度注入通道）
  });

  it('归一化仅动 position：条目其余字段与顶层未知字段 passthrough 保留，导出一致', async () => {
    const asset = await importOk('worldbooks', JSON.stringify(book), '位置样本.json');
    const raw = asset.raw as {
      name?: unknown;
      originalMeta?: unknown;
      entries: Record<string, Record<string, unknown>>;
    };
    expect(raw.name).toBe('位置样本');
    expect(raw.originalMeta).toEqual({ keep: true });
    expect(raw.entries['2']).toMatchObject({ uid: 2, key: ['k2'], content: '内容2', order: 98 });
    const exported = (await exportParsed('worldbooks', asset.id)) as typeof raw;
    expect(exported.entries['5']?.position).toBe(0);
    expect(exported.entries['6']?.position).toBe(1);
    expect(exported.originalMeta).toEqual({ keep: true });
  });
});

// ---------- 预设：prompt_order 规范化（设计 §4.7） ----------

describe('预设导入导出（Default.json fixture）', () => {
  it('导入 Default.json → prompt_order 只剩 character_id=100001 一条，其余字段保真', async () => {
    const asset = await importOk('presets', JSON.stringify(defaultPresetRaw), 'Default.json');
    expect(asset.name).toBe('Default'); // Default.json 无顶层 name → 取文件名
    const raw = asset.raw as {
      prompts: unknown[];
      prompt_order: Array<{ character_id: number; order: Array<{ identifier: string }> }>;
      temperature: unknown;
      wi_format: unknown;
    };
    expect(raw.prompt_order).toHaveLength(1);
    expect(raw.prompt_order[0]?.character_id).toBe(100001);
    // 100001 排序列表内容原样保留
    const orig100001 = (
      defaultPresetRaw as { prompt_order: Array<{ character_id: number; order: unknown[] }> }
    ).prompt_order.find((o) => o.character_id === 100001);
    expect(raw.prompt_order[0]?.order).toEqual(orig100001?.order);
    // 100000 那条被丢弃
    expect(JSON.stringify(raw.prompt_order)).not.toContain('100000');
    // prompts 与采样参数等其余字段保真
    expect(raw.prompts).toEqual((defaultPresetRaw as { prompts: unknown[] }).prompts);
    expect(raw.temperature).toEqual((defaultPresetRaw as { temperature: unknown }).temperature);
  });

  it('预设导出 → 与导入归一后的 raw 深比较（roundtrip）', async () => {
    const asset = await importOk('presets', JSON.stringify(defaultPresetRaw), 'Default.json');
    const exported = await exportParsed('presets', asset.id);
    expect(exported).toEqual(asset.raw);
    const raw = exported as { prompt_order: Array<{ character_id: number }> };
    expect(raw.prompt_order).toHaveLength(1);
    expect(raw.prompt_order[0]?.character_id).toBe(100001);
  });

  it('只有 character_id=100000（text completion 排序）→ 400 人话错误', async () => {
    const body = {
      prompts: [{ identifier: 'main', content: 'x' }],
      prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }] }],
    };
    const res = await importJson('presets', JSON.stringify(body), '孤儿预设.json');
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('chat completion');
  });

  it('无 100001 但仅一条非 text completion 排序列表 → 宽容取用该条', async () => {
    // 社区工具导出常见丢 dummy 标记：唯一排序且非 100000（text completion 专用）时宽容取用
    const body = {
      prompts: [{ identifier: 'main', content: 'x' }],
      prompt_order: [{ character_id: 12345, order: [{ identifier: 'chatHistory', enabled: true }] }],
    };
    const asset = await importOk('presets', JSON.stringify(body), '单条排序.json');
    const raw = asset.raw as {
      prompt_order: Array<{ character_id: number; order: Array<{ identifier: string }> }>;
    };
    expect(raw.prompt_order).toHaveLength(1);
    expect(raw.prompt_order[0]?.order).toEqual([{ identifier: 'chatHistory', enabled: true }]);
  });
});
