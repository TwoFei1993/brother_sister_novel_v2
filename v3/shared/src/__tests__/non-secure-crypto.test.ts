/**
 * 非安全上下文（无 crypto.randomUUID）环境模拟测试——APK/HTTP 部署崩溃的回归防线。
 * 临时删除 globalThis.crypto.randomUUID，验证 randomUUIDSafe / aiVersion 仍可用。
 */
import { afterEach, describe, expect, it } from 'vitest';

import { aiVersion, randomUUIDSafe } from '../message';

describe('randomUUIDSafe（非安全上下文兜底）', () => {
  const originalCrypto = globalThis.crypto;
  const uuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, writable: true, configurable: true });
  });

  it('无 crypto.randomUUID 的环境（http 部署）仍能生成合法 v4 uuid', () => {
    const stripped = { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) };
    Object.defineProperty(globalThis, 'crypto', { value: stripped, writable: true, configurable: true });
    const id = randomUUIDSafe();
    expect(id).toMatch(uuidFormat);
  });

  it('aiVersion 在该环境下正常构造版本（第四章崩溃回归防线）', () => {
    const stripped = { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) };
    Object.defineProperty(globalThis, 'crypto', { value: stripped, writable: true, configurable: true });
    const v = aiVersion('正文', 'v1', 123);
    expect(v.id).toMatch(uuidFormat);
    expect(v).toMatchObject({ name: 'v1', content: '正文', origin: 'ai', createdAt: 123 });
  });

  it('完全无 WebCrypto 的极端环境也不抛（Math.random 兜底）', () => {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, writable: true, configurable: true });
    const id = randomUUIDSafe();
    expect(id).toMatch(uuidFormat);
  });
});
