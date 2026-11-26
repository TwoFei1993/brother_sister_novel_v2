/**
 * 短剧资产库接口的路径契约。
 *
 * 2026-11-26 走查抓到：前端请求多了 /library 一层，真实环境里三类资产全部 404（「接口不存在」）——
 * 服务端把 libraryRouter 挂在 /api 下，子路由是 /duanju-assets，没有 /library。服务端测试直接把
 * router 挂在 /api 上、前端测试又 mock 了接口，两边都没照到真实路径，所以在这里钉住。
 */
import { describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../client';
import { duanjuAssetFileUrl, duanjuAssetToWork, getDuanjuAsset, importDuanjuAssets, listDuanjuAssets } from '../duanjuAssets';

vi.mock('../client', () => ({ apiFetch: vi.fn(async () => []) }));

describe('短剧资产库接口路径', () => {
  it('与服务端挂载点一致：/api/duanju-assets（没有 /library 一层）', async () => {
    await listDuanjuAssets('characters');
    await getDuanjuAsset('scenes', 'a1');
    await importDuanjuAssets('w1', 'styles');
    await duanjuAssetToWork('characters', 'a1', 'w1');
    expect(vi.mocked(apiFetch).mock.calls.map((c) => c[0])).toEqual([
      '/api/duanju-assets/characters',
      '/api/duanju-assets/scenes/a1',
      '/api/duanju-assets/import-from/w1',
      '/api/duanju-assets/characters/a1/to-work/w1',
    ]);
  });

  it('资产图片地址：同前缀，文件名做 URL 编码', () => {
    expect(duanjuAssetFileUrl('characters', 'a1', 'duanju-assets/files/characters/a1/三视图 1.png')).toBe(
      '/api/duanju-assets/files/characters/a1/' + encodeURIComponent('三视图 1.png'),
    );
  });
});
