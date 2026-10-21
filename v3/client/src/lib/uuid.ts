/**
 * 兼容的 UUID v4 生成（线上 HTTP+IP 直连部署的必需品）
 *
 * `crypto.randomUUID()` 只在「安全上下文」（HTTPS 或 localhost）可用；用 http://IP:端口 访问
 * 线上服务器时浏览器不提供该函数，调用即抛 TypeError——章节生成/重试在拿 id 的那一步就挂了
 * （表现为点「续写」没有任何反应）。`crypto.getRandomValues` 在非安全上下文仍可用，
 * 据此按 RFC 4122 v4 自行拼装，与原生输出格式一致，id 的幂等入库语义不变。
 */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    // 极端环境兜底（无 WebCrypto）：Math.random，仅用作幂等键，不涉及安全
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}
