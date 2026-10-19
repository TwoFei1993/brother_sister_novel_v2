/**
 * remote 直链拉取（review #4 安全收口，从 resources.ts 拆出）：
 * 1. 仅 https；DNS 解析后逐地址过私网/环回/链路本地黑名单（防 SSRF 打内网）；
 * 2. redirect: 'manual' 手动逐跳校验——每跳重新过协议与 IP 黑名单，最多 3 跳；
 * 3. 响应体流式读取累计字节，超 20MB 立即中止（防先整包下载后校验的内存放大）。
 * 已知边界：DNS 解析与 fetch 之间存在 TOCTOU（重绑定）窗口，完整防御需固定 IP，
 * 当前以 lookup 黑名单 + 管理员可信索引为威胁模型内的务实防线。
 */
import { lookup } from 'node:dns/promises';

import { HttpError } from '../../middleware/validate';

/** remote 拉取体积上限：与角色卡上传同一量级（20MB） */
export const MAX_BYTES = 20 * 1024 * 1024;

/** 重定向最大跳数 */
const MAX_REDIRECTS = 3;

/** fetch 总超时（毫秒，含全部重定向跳）；env 仅供测试注入，生产默认 10s */
const fetchTimeoutMs = (): number => Number(process.env.RESOURCES_FETCH_TIMEOUT_MS ?? 10_000);

// ---------- IP 黑名单（SSRF） ----------

/** IPv4 黑名单：环回/私网/链路本地/CGNAT/组播与保留段（公网单播为 1.0.0.0–223.255.255.255） */
function isBlockedIpv4(ip: string): boolean {
  const seg = ip.split('.').map(Number);
  if (seg.length !== 4 || seg.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = seg;
  return (
    a === 0 || // 0.0.0.0/8 本网络
    a === 10 || // 10.0.0.0/8 私网
    a === 127 || // 环回
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // 链路本地
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 私网
    (a === 192 && b === 168) || // 192.168.0.0/16 私网
    a >= 224 // 组播（224/4）与保留段（240/4、255 广播）
  );
}

/** 展开 IPv6 为 8 组 16bit 数值（支持 :: 缩写与 ::ffff:x.y.z.w 尾段）；无法解析返回 null */
function expandIpv6(ip: string): number[] | null {
  if (ip.split('::').length > 2) return null;
  const [head, tail = null] = ip.split('::');
  const parseGroups = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const g of s.split(':')) {
      if (g.includes('.')) {
        const v4 = g.split('.').map(Number);
        if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        out.push(parseInt(g, 16));
      }
    }
    return out;
  };
  const h = parseGroups(head);
  const t = tail === null ? [] : parseGroups(tail);
  if (!h || !t) return null;
  if (tail === null && h.length !== 8) return null; // 无 :: 缩写必须恰好 8 组
  const fill = 8 - h.length - t.length;
  if (fill < 0) return null;
  return [...h, ...new Array<number>(fill).fill(0), ...t];
}

/** IPv6 黑名单：::/::1、fc00::/7 ULA、fe80::/10 链路本地、::ffff: 映射 IPv4 转发判定 */
function isBlockedIpv6(ip: string): boolean {
  const g = expandIpv6(ip.toLowerCase());
  if (!g) return true; // 解析失败按拒
  if (g.every((x) => x === 0)) return true; // ::/128 未指定
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1 环回
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    // ::ffff:0:0/96 IPv4 映射地址 → 按内嵌 IPv4 判定
    return isBlockedIpv4(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
  }
  if (g[0] >= 0xfc00 && g[0] <= 0xfdff) return true; // fc00::/7 ULA
  if (g[0] >= 0xfe80 && g[0] <= 0xfebf) return true; // fe80::/10 链路本地
  return false;
}

/** 解析 hostname（IPv6 字面量去方括号）并校验全部地址：任一命中黑名单即拒 */
async function assertPublicHost(hostname: string): Promise<void> {
  const bare = hostname.replace(/^\[/, '').replace(/\]$/, '');
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await lookup(bare, { all: true, verbatim: true });
  } catch {
    throw new HttpError(400, '直链域名无法解析，请检查 URL');
  }
  if (addrs.length === 0) throw new HttpError(400, '直链域名无法解析，请检查 URL');
  const blocked = addrs.some((a) => (a.family === 6 ? isBlockedIpv6(a.address) : isBlockedIpv4(a.address)));
  if (blocked) throw new HttpError(400, '直链指向内网/本机地址，已被安全策略拒绝');
}

// ---------- 响应体流式限长 ----------

/** 流式读取响应体并累计字节，超上限立即中止连接（不等下载完成） */
async function readBodyCapped(res: globalThis.Response): Promise<Buffer> {
  const reader = res.body!.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new HttpError(413, '资源超过 20MB 上限');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// ---------- 主流程（手动重定向，逐跳校验） ----------

/**
 * 拉取 remote 直链：协议/IP/体积三重校验，返回完整内容 Buffer。
 * 超时 signal 在循环外创建——总时限封顶（重定向不重置计时）。
 */
export async function fetchRemote(url: string): Promise<Buffer> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new HttpError(400, 'URL 格式不合法');
  }
  const signal = AbortSignal.timeout(fetchTimeoutMs());

  for (let hop = 0; ; hop++) {
    if (target.protocol !== 'https:') {
      throw new HttpError(400, '仅支持 https:// 直链（防明文注入）');
    }
    await assertPublicHost(target.hostname);

    let res: globalThis.Response;
    try {
      res = await fetch(target, { signal, redirect: 'manual' });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new HttpError(504, '资源拉取超时，请稍后重试或改用本地上传');
      }
      throw new HttpError(502, `资源拉取失败：${err instanceof Error ? err.message : '网络错误'}`);
    }

    // 3xx：取 Location 进入下一跳校验（协议/IP 重新过审，防重定向绕过）
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      await res.body?.cancel();
      if (!loc) throw new HttpError(502, '上游重定向缺少 Location，无法继续');
      if (hop >= MAX_REDIRECTS) {
        throw new HttpError(502, '重定向超过 3 跳上限，请直接提供最终直链');
      }
      try {
        target = new URL(loc, target); // 相对 Location 基于当前 URL 解析（继承 https）
      } catch {
        throw new HttpError(502, '上游重定向 Location 不合法');
      }
      continue;
    }

    if (!res.ok) {
      throw new HttpError(502, `资源上游返回 ${res.status}，请检查直链是否有效`);
    }
    return readBodyCapped(res);
  }
}
