/**
 * E2E 驱动公共库（聂小倩实测）：node 环境跑 client 真实代码路径
 *
 * - localStorage polyfill（预置 comfy 引擎配置——loadComfyConfig 从这读）
 * - fetch 包装：相对路径补 server 绝对地址 + 自动携带/收集 Cookie（apiFetch 复用真实实现）
 * - 登录 → 后续所有 apiFetch 自动带会话
 */

// ---- polyfills（必须在任何 client import 之前） ----
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
store.set(
  'v3-comfyui-config',
  JSON.stringify({ url: 'http://127.0.0.1:8188', videoWorkflow: '', imageWorkflow: '', videoQuality: 'high' }),
);

const SERVER = 'http://localhost:3001';
let cookie = '';

// 401 钩子的 node stub（client.ts 的 window.location.assign 在 node 不存在）
(globalThis as Record<string, unknown>).window = { location: { assign: () => undefined } };

const rawFetch = globalThis.fetch.bind(globalThis);
(globalThis as { fetch: unknown }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith('/')) url = SERVER + url;
  const headers = new Headers(init?.headers ?? {});
  if (cookie) headers.set('Cookie', cookie);
  const res = await rawFetch(url, { ...init, headers });
  // undici 标准 API：getSetCookie() 返回数组（headers.get('set-cookie') 在 undici 拿不到）
  const setCookies: string[] = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    const token = /token=[^;]+/.exec(sc)?.[0];
    if (token) cookie = token;
  }
  return res;
};

export async function login(): Promise<void> {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'dev123' }),
  });
  if (!r.ok) throw new Error(`登录失败 ${r.status}`);
  console.log('[lib] 登录 ok');
}

// ---- LLM（server 转发，source=claude / MiniMax-M3.1-Flash 实测可用） ----
export const LLM = { source: 'claude', model: 'MiniMax-M3.1-Flash' } as const;

export async function llmText(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Promise<string> {
  for (let round = 0; round < 3; round += 1) {
    // 流式接收（非流式下 M3.1 思考期无数据，撞 server 120s 空闲超时）
    const r = await fetch('/api/llm/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: LLM.source,
        model: LLM.model,
        messages,
        stream: true,
        params: { max_tokens: 32000 },
      }),
    });
    if (!r.ok || !r.body) {
      const detail = (await r.text().catch(() => '')).slice(0, 200);
      // 网络瞬断退避重试（LLM_NET fetch failed 常为代理抖动）
      if (/LLM_NET|fetch failed|network/i.test(detail) && round < 2) {
        console.log(`[lib] LLM 网络抖动，${(round + 1) * 5}s 后重试`);
        await new Promise((res) => setTimeout(res, (round + 1) * 5000));
        continue;
      }
      throw new Error(`LLM ${r.status}: ${detail}`);
    }
    let text = '';
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const ev = JSON.parse(payload) as { type?: string; text?: string; content?: string };
          const chunk = ev.text ?? ev.content ?? '';
          if (chunk) text += chunk;
        } catch {
          /* 跳过坏帧 */
        }
      }
    }
    if (text.trim()) return text;
    console.log(`[lib] LLM 空输出第 ${round + 1} 轮，重试`);
  }
  throw new Error('LLM 连续空输出');
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
