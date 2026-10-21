import { afterEach, describe, expect, it, vi } from 'vitest';

import { uuid } from '../uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uuid（HTTP 非安全上下文兼容）', () => {
  it('有原生 randomUUID 时直接使用', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555' });
    expect(uuid()).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('无 randomUUID 但有 getRandomValues（HTTP+IP 访问的真实情形）→ 手拼合法 v4，且不抛错', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (a: Uint8Array) => {
        for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 0xff;
        return a;
      },
    });
    const id = uuid();
    expect(id).toMatch(UUID_V4);
  });

  it('连续生成互不相同（幂等键不冲突）', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (a: Uint8Array) => {
        for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
        return a;
      },
    });
    const ids = new Set(Array.from({ length: 500 }, () => uuid()));
    expect(ids.size).toBe(500);
  });

  it('连 WebCrypto 都没有的极端环境 → Math.random 兜底仍产出合法格式', () => {
    vi.stubGlobal('crypto', undefined);
    expect(uuid()).toMatch(UUID_V4);
  });
});
