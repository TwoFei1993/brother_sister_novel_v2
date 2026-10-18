/**
 * 统一 API 客户端（同源相对路径 /api/*，cookie 鉴权，零硬编码后端地址）
 *
 * - apiFetch：JSON 请求包装；credentials:'include'；非 2xx 抛 ApiError{code,message}；
 *   401 自动整页跳 /login（auth 自身请求除外，避免登录失败循环）
 * - apiStream：SSE 流式 POST（fetch + ReadableStream 手写解析，data: 行 JSON.parse，[DONE] 结束）
 */

export type ApiErrorCode =
  | 'network' // 网络不可达 / 请求未发出
  | 'unauthorized' // 401
  | 'forbidden' // 403
  | 'notFound' // 404
  | 'conflict' // 409
  | 'serverError' // 5xx
  | 'http'; // 其余 4xx

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, message: string, code?: ApiErrorCode) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code ?? statusToCode(status);
  }
}

function statusToCode(status: number): ApiErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'serverError';
  if (status === 0) return 'network';
  return 'http';
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** 从错误响应提取人话消息（server 统一 {error}；上游代理风格为 {message}） */
async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown; message?: unknown };
    if (typeof data.error === 'string' && data.error) return data.error;
    if (typeof data.message === 'string' && data.message) return data.message;
  } catch {
    // 非 JSON 响应体，落到默认消息
  }
  return `请求失败（${res.status}）`;
}

/** 401 处理钩子：默认整页跳登录（整页刷新以清空会话内状态）；可注入替换便于测试 */
let unauthorizedHandler: ((path: string) => void) | null = null;

/** 注入 401 处理器；传 null 恢复默认（测试隔离用） */
export function setUnauthorizedHandler(fn: ((path: string) => void) | null): void {
  unauthorizedHandler = fn;
}

function handleUnauthorized(path: string): void {
  if (unauthorizedHandler) {
    unauthorizedHandler(path);
    return;
  }
  window.location.assign('/login');
}

export interface ApiFetchOptions extends RequestInit {
  /** 置 true 时 401 不触发自动跳转（调用方自行处理，如登录页的状态探测） */
  keepOn401?: boolean;
}

/** JSON 请求包装：返回体反序列化为 T；非 2xx 抛 ApiError */
export async function apiFetch<T = unknown>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  const { keepOn401, ...init } = opts;
  // 字符串 body 默认按 JSON 发送（未显式指定 Content-Type 时），调用方无需手写请求头
  if (typeof init.body === 'string') {
    const h = new Headers(init.headers);
    if (!h.has('Content-Type')) h.set('Content-Type', 'application/json');
    init.headers = h;
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, credentials: 'include' });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiError(0, '无法连接服务器，请检查网络', 'network');
  }
  if (!res.ok) {
    if (res.status === 401 && !keepOn401 && !path.startsWith('/api/auth/')) {
      handleUnauthorized(path);
    }
    throw new ApiError(res.status, await extractErrorMessage(res));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * SSE 流式 POST（LLM 生成代理等场景的通用预留，设计 §6 /api/llm/generate）
 *
 * 协议约定：响应体为 text/event-stream，每条事件一行 `data: <json>`，
 * `data: [DONE]` 表示正常结束。解析失败的行静默跳过（与旧站行为一致）。
 *
 * @param onEvent 收到一条完整事件（JSON.parse 后的对象），由调用方提取业务字段
 */
export async function apiStream<T = unknown>(
  path: string,
  body: unknown,
  onEvent: (event: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiError(0, '无法连接服务器，请检查网络', 'network');
  }
  if (!res.ok) {
    throw new ApiError(res.status, await extractErrorMessage(res));
  }

  const reader = res.body?.getReader();
  if (!reader) throw new ApiError(res.status, '当前环境不支持流式响应', 'http');

  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // 末段可能是半行，留待下一 chunk
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          onEvent(JSON.parse(data) as T);
        } catch {
          // 非法 JSON 行静默跳过（SSE 心跳/注释行等）
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined); // 提前 return（[DONE]/异常）时释放连接
  }
}
