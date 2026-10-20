/**
 * LLM 代理编排（设计 §3.2 无状态薄代理 + §9.1 错误翻译）
 *
 * 流程：读明文密钥 → convert 转换（协议适配见 upstream.ts）→ fetch 上游 → 统一事件流。
 * 服务端不落盘任何生成内容（生成与入库解耦，§9.2）；密钥绝不进任何错误消息/日志。
 * 对照酒馆 forwardFetchResponse（SillyTavern src/express-common.js）的流式转发思路。
 */
import { join } from 'node:path';

import { convert, type ChatMessage, type GenParams, type LlmSource } from '../converters';
import { dataDir } from '../routes/core/paths';
import { readJson } from '../storage/store';
import {
  buildUpstreamRequest,
  extractFullText,
  extractStreamDelta,
  sseDataLines,
  type SecretsFull,
} from './upstream';

/** 错误分类码（前端据此展示人话，设计 §9.1） */
export type LlmErrorCode =
  | 'LLM_AUTH'
  | 'LLM_QUOTA'
  | 'LLM_REJECTED'
  | 'LLM_NET'
  | 'LLM_TIMEOUT'
  | 'LLM_NOKEY'
  | 'LLM_UPSTREAM';

/** 携带分类码的业务错误：generate 未开流时转 502，test 端点转 {ok:false, code} */
export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** generate 入参（routes 层已过 zod） */
export interface GenerateInput {
  source: LlmSource;
  model: string;
  messages: ChatMessage[];
  params?: GenParams;
  stream: boolean;
  /** 外部中止信号（客户端断开时由路由层触发，中止上游以省 token，review #6） */
  signal?: AbortSignal;
}

/** 统一流事件：text=增量（raw 为上游原 chunk 供调试透传）、done=正常收束、error=分类错误 */
export type StreamEvent =
  | { kind: 'text'; text: string; raw: unknown }
  | { kind: 'done' }
  | { kind: 'error'; code: LlmErrorCode; message: string };

/**
 * 上游**空闲**超时（反馈⑩）：默认 120s，测试经 env 注入短时限。
 * 语义 = 相邻两次上游数据之间的最大间隔（每收到一个 chunk 即重置），
 * 而非请求总时长——MiniMax 等长文生成常超 120s 但流式 chunk 一直在正常到达，
 * 按总时长计时会误杀正常生成。完全无数据的真挂起仍按此超时中止。
 */
function upstreamTimeoutMs(): number {
  const n = Number(process.env.LLM_UPSTREAM_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

/** 上游**总时长**硬顶：默认 10 分钟，测试经 env 注入。防对端持续发心跳/碎帧导致的死循环。 */
function upstreamTotalTimeoutMs(): number {
  const n = Number(process.env.LLM_UPSTREAM_TOTAL_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 600_000;
}

/** 读 secrets.json 明文（LLM 调用需要原文；对外接口只回掩码，见 routes/core/secrets.ts） */
export async function readSecretsFull(): Promise<SecretsFull | null> {
  return readJson<SecretsFull>(join(dataDir(), 'secrets.json'));
}

/** 密钥脱敏：任何将要回传/落日志的文本先过这里，防 gemini query 密钥泄漏 */
function redact(text: string, secrets: SecretsFull | null): string {
  let out = text;
  for (const key of [secrets?.openai?.apiKey, secrets?.gemini?.apiKey, secrets?.claude?.apiKey]) {
    if (key) out = out.split(key).join('***');
  }
  return out;
}

// ---------- 错误翻译（设计 §9.1 分类） ----------

export function translateUpstreamError(status: number, bodyText: string): LlmError {
  const lower = bodyText.toLowerCase();
  if ((status === 400 || status === 403) && /safety|blocked|prohibited/.test(lower)) {
    return new LlmError('LLM_REJECTED', `内容被上游安全策略拒绝：${bodyText.slice(0, 200)}`);
  }
  if (status === 401 || status === 403) return new LlmError('LLM_AUTH', `密钥无效或无访问权限（上游 ${status}）`);
  if (status === 429) return new LlmError('LLM_QUOTA', '上游额度不足或触发限流（429），请稍后再试');
  if (status >= 500) return new LlmError('LLM_NET', `上游服务异常（${status}），请稍后再试`);
  return new LlmError('LLM_UPSTREAM', `上游请求失败（${status}）：${bodyText.slice(0, 200)}`);
}

function toLlmError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  const name = e instanceof Error ? e.name : (e as { name?: string } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return new LlmError('LLM_TIMEOUT', '上游请求超时，请稍后再试');
  const detail = e instanceof Error ? e.message : String(e);
  return new LlmError('LLM_NET', `无法连接上游服务：${detail}`);
}

// ---------- 代理主流程 ----------

/**
 * 统一代理入口：转换 → 注入密钥请求上游 → 产出统一事件流。
 * - 第一个 yield 之前完成 fetch 与状态码检查（未开流错误可直接 throw，路由转 502 JSON）
 * - 已产出过增量后的错误转为 error 事件（SSE 场景不能改状态码）
 */
export async function* runGenerate(input: GenerateInput): AsyncGenerator<StreamEvent> {
  const secrets = await readSecretsFull();
  const channel = secrets?.[input.source];
  if (!secrets || !channel?.apiKey) {
    throw new LlmError('LLM_NOKEY', '该通道尚未配置密钥，请先到设置页填写');
  }

  // 双超时（反馈⑩）：idle=空闲超时（每收到上游数据重置，长文流式不误杀）；
  // total=总时长硬顶（防持续碎帧/心跳死循环）。任一触发即中止上游并报 LLM_TIMEOUT。
  const idleMs = upstreamTimeoutMs();
  const totalMs = upstreamTotalTimeoutMs();
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutKind: 'idle' | 'total' | null = null;
  const armIdle = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timeoutKind = 'idle';
      controller.abort();
    }, idleMs);
  };
  const totalTimer = setTimeout(() => {
    timeoutKind = 'total';
    controller.abort();
  }, totalMs);
  armIdle();
  // 外部中止信号（客户端断开）并入同一 controller：任一触发即中止上游请求（review #6）
  const onExternalAbort = (): void => controller.abort();
  if (input.signal?.aborted) controller.abort();
  input.signal?.addEventListener('abort', onExternalAbort, { once: true });
  let emitted = false;

  try {
    const converted = convert(input.source, input.messages, { ...input.params, model: input.model });
    const upstream = buildUpstreamRequest(input.source, converted, secrets, input.model, input.stream);
    const res = await fetch(upstream.url, {
      method: 'POST',
      headers: upstream.headers,
      body: JSON.stringify(upstream.body),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw translateUpstreamError(res.status, (await res.text()).slice(0, 1000));
    }

    if (!input.stream) {
      const json = (await res.json()) as Record<string, unknown>;
      yield { kind: 'text', text: extractFullText(input.source, json), raw: null };
      emitted = true;
      yield { kind: 'done' };
      return;
    }

    if (!res.body) throw new LlmError('LLM_NET', '上游未返回可读的响应体');

    for await (const payload of sseDataLines(res.body)) {
      armIdle(); // 收到上游数据即重置空闲计时（反馈⑩核心：chunk 持续到达就不算超时）
      if (payload === '[DONE]') break;
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue; // 非 JSON 行（注释/心跳）跳过
      }
      const { text, done } = extractStreamDelta(input.source, json);
      if (text) {
        emitted = true;
        yield { kind: 'text', text, raw: json };
      }
      if (done) break;
    }
    yield { kind: 'done' };
  } catch (e) {
    // 超时中止按触发方区分语义（人话错误消息）；客户端断开（外部 abort）不走此分支，
    // 仍由 toLlmError 归类为 LLM_TIMEOUT（现状行为不变）
    const err =
      timeoutKind === 'idle'
        ? new LlmError('LLM_TIMEOUT', `上游已 ${Math.round(idleMs / 1000)} 秒没有任何数据返回，已中止（空闲超时）`)
        : timeoutKind === 'total'
          ? new LlmError('LLM_TIMEOUT', `上游生成总时长超过 ${Math.round(totalMs / 60000)} 分钟硬顶，已中止`)
          : toLlmError(e);
    if (err.code === 'LLM_NET' || err.code === 'LLM_UPSTREAM') {
      err.message = redact(err.message, secrets);
    }
    if (emitted) {
      yield { kind: 'error', code: err.code, message: err.message };
    } else {
      throw err;
    }
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    input.signal?.removeEventListener('abort', onExternalAbort);
  }
}
