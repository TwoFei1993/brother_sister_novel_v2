/**
 * LLM 生成流 API（设计 §3.2 / §6）：/api/llm/generate（SSE）+ /api/tokenize
 *
 * 帧协议（server routes/llm.ts）：增量 `data: {"text": "..."}`、流中错误
 * `data: {"error": {code, message}}`、收束 `data: [DONE]`。
 * generateStream 负责帧分发（text→onChunk / error→onError），onDone 仅在流正常
 * 结束（收到 [DONE]）后恰调用一次；静默断流（流结束/连接中断而未见 [DONE]）
 * 抛 ApiError{code:'streamIncomplete'}，不触发 onDone（§9.2 半成品不得 finalize）。
 */
import { apiFetch, apiStream, ApiError } from './client';
import type { LlmSource } from '../stores/settings';

/** 组装后的单条消息（与 server generateSchema 的 messageSchema 同形） */
export interface GenerateMessage {
  role: 'system' | 'user' | 'assistant';
  name?: string;
  content: string;
}

/** 采样参数（server paramsSchema：passthrough，已知键强类型） */
export interface GenerateParams {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  /** 重复惩罚（claude/MiniMax 通道）：>1 压制重复，默认 1=关闭 */
  repetition_penalty?: number;
  /** 思考模式（D4）：true = claude 通道开启上游思考流（MiniMax M3 等默认关闭需显式开启） */
  thinking?: boolean;
}

/** POST /api/llm/generate 请求体 */
export interface GenerateBody {
  source: LlmSource;
  model: string;
  messages: GenerateMessage[];
  params?: GenerateParams;
  stream: boolean;
}

export interface BuildGenerateBodyInput {
  source: LlmSource;
  model: string;
  messages: GenerateMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 频率/存在惩罚（openai 通道透传，采样层治重复） */
  frequencyPenalty?: number;
  presencePenalty?: number;
  /** 重复惩罚（claude/MiniMax 通道）：>1 压制已出现内容的再次生成概率 */
  repetitionPenalty?: number;
  /** 思考模式开关（prefs.thinking !== false 由调用方判定；老用户 localStorage 缺省 = 开） */
  thinking?: boolean;
  stream?: boolean;
}

/** 组装生成请求体：采样参数进 params（maxTokens 映射 max_tokens），默认流式 */
export function buildGenerateBody(input: BuildGenerateBodyInput): GenerateBody {
  const params: GenerateParams = {};
  if (input.temperature !== undefined) params.temperature = input.temperature;
  if (input.maxTokens !== undefined) params.max_tokens = input.maxTokens;
  if (input.frequencyPenalty !== undefined) params.frequency_penalty = input.frequencyPenalty;
  if (input.presencePenalty !== undefined) params.presence_penalty = input.presencePenalty;
  if (input.repetitionPenalty !== undefined) params.repetition_penalty = input.repetitionPenalty;
  if (input.thinking === true) params.thinking = true;
  return {
    source: input.source,
    model: input.model,
    messages: input.messages,
    ...(Object.keys(params).length > 0 ? { params } : {}),
    stream: input.stream ?? true,
  };
}

/** 流中错误帧负载（server LlmError code：LLM_AUTH/LLM_QUOTA/LLM_REJECTED/LLM_NET/LLM_TIMEOUT/...） */
export interface LlmStreamError {
  code: string;
  message: string;
}

export interface StreamHandlers {
  /** 收到一段增量文本 */
  onChunk: (text: string) => void;
  /** 思考流增量（D4：server thinking 帧；MiniMax M3 等思考模型的💭折叠数据源）。缺省时忽略 */
  onThinking?: (thinking: string) => void;
  /** 上游结束原因（帧 raw 透传：openai finish_reason / claude stop_reason；截断自动续写的决定性信号） */
  onFinish?: (reason: string) => void;
  /** 流正常结束（收到 [DONE]），恰一次；断流（streamIncomplete）不触发 */
  onDone: () => void;
  /** 收到流中错误帧 */
  onError: (error: LlmStreamError) => void;
}

/** SSE 帧形状（text/thinking/finish 可同帧共存，与 error 互斥；raw=上游原 chunk 透传） */
interface SseFrame {
  text?: unknown;
  thinking?: unknown;
  /** 上游结束原因（server 从 finish_reason/stop_reason 提取透传；截断自动续写的决定性信号） */
  finish?: unknown;
  error?: { code?: unknown; message?: unknown };
  raw?: unknown;
}

/** 从上游原 chunk 提取结束原因（openai: choices[0].finish_reason；claude: delta.stop_reason / stop_reason） */
export function extractFinishReason(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const choices = Array.isArray(r.choices) ? r.choices : [];
  const c0 = typeof choices[0] === 'object' && choices[0] !== null ? (choices[0] as Record<string, unknown>) : null;
  if (typeof c0?.finish_reason === 'string') return c0.finish_reason;
  const delta = typeof r.delta === 'object' && r.delta !== null ? (r.delta as Record<string, unknown>) : null;
  if (typeof delta?.stop_reason === 'string') return delta.stop_reason;
  if (typeof r.stop_reason === 'string') return r.stop_reason;
  return null;
}

/** 消费生成流：解析帧并分发；调用方以 AbortSignal 实现停止 */
export async function generateStream(
  body: GenerateBody,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await apiStream<SseFrame>('/api/llm/generate', body, (frame) => {
    if (frame.error && typeof frame.error === 'object') {
      handlers.onError({
        code: typeof frame.error.code === 'string' ? frame.error.code : 'LLM_UPSTREAM',
        message: typeof frame.error.message === 'string' ? frame.error.message : '上游未知错误',
      });
      return;
    }
    if (typeof frame.thinking === 'string' && frame.thinking.length > 0) {
      handlers.onThinking?.(frame.thinking);
    }
    if (typeof frame.text === 'string' && frame.text.length > 0) {
      handlers.onChunk(frame.text);
    }
    // 结束原因：优先显式 finish 字段（server 提取透传），raw 上游原 chunk 兜底
    if (typeof frame.finish === 'string' && frame.finish) {
      handlers.onFinish?.(frame.finish);
    } else {
      const finish = extractFinishReason(frame.raw);
      if (finish) handlers.onFinish?.(finish);
    }
  }, signal);
  handlers.onDone();
}

/**
 * 非流式文本生成（一次性拿全文）：向导/选段工具/记忆抽取等场景共用。
 *
 * 输出预算协商（「推理烧光 max_tokens」的彻底解）：思考长度不可控，任何固定预算都可能
 * 被思考流吃光——不再依赖猜的固定值，而是自适应协商：
 *  ①起步预算给足（thinking 时下限 32000，与调用方传入值取大）；
 *  ②空输出（思考吃满）→ 预算加倍重试，直到 MAX_OUTPUT_TOKENS；
 *  ③上游 4xx 拒绝（max_tokens 超上限类）→ 减半重试并按模型缓存可用值（下次起手避开）；
 *  ④成功值同样缓存（已验证可用）——协商结果跨调用记忆，同一模型只协商一次。
 */
export const MAX_OUTPUT_TOKENS = 64000;

const budgetCache = new Map<string, number>();
const modelKey = (source: string, model?: string): string => `${source}:${model ?? ''}`;

/** 该模型已协商出的可用输出预算（null=未协商过）；流式链路共以此避开已知被拒值 */
export function cachedOutputBudget(source: LlmSource, model?: string): number | null {
  return budgetCache.get(modelKey(source, model)) ?? null;
}

/** 记录协商结果（流式链路 4xx 降级后回写，与非流式共享同一份缓存） */
export function recordOutputBudget(source: LlmSource, model: string | undefined, tokens: number): void {
  budgetCache.set(modelKey(source, model), Math.max(4096, Math.min(tokens, MAX_OUTPUT_TOKENS)));
}

/** 是否为 max_tokens 超限拒绝：server 翻译层对上游 400/413+关键词打稳定前缀「【max_tokens 超限】」
 *  （统一 502 返回，不能按 status 判）；直连场景官方 400 原文的关键词也覆盖。宽匹配宁可多降一次 */
export function isMaxTokensReject(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  const msg = `${err.message}`.toLowerCase();
  return /【max_tokens 超限】|max[_\s-]?tokens|too (large|long)|context[_\s-]?length|输出长度|长度超/.test(msg);
}

export async function generateTextOnce(
  input: Omit<BuildGenerateBodyInput, 'stream'>,
  budget = 8192,
): Promise<string> {
  const key = modelKey(input.source, input.model);
  const known = budgetCache.get(key);
  // 起步：调用方理想值与 thinking 下限取大，再避开已知被拒上界
  let want = Math.min(
    Math.max(budget, input.thinking !== false ? 32000 : budget),
    known ?? MAX_OUTPUT_TOKENS,
  );
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let rejected = false;
    try {
      const body = buildGenerateBody({ ...input, maxTokens: want, stream: false });
      const r = await apiFetch<{ text?: string }>('/api/llm/generate', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const text = r.text ?? '';
      if (text.trim()) {
        budgetCache.set(key, want); // 已验证可用（比缓存大则向上修订）
        return text;
      }
      // 空输出：思考吃满预算（或上游空响应）→ 加倍
    } catch (err) {
      if (isMaxTokensReject(err)) {
        rejected = true;
        want = Math.max(4096, Math.floor(want / 2));
        budgetCache.set(key, want); // 立即记住可用上界，流式链路同步受益
        continue;
      }
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err; // 其他 4xx 业务错误不重试
      // 5xx/网络抖动按空输出处理，交由加倍重试
    }
    const next = Math.min(want * 2, MAX_OUTPUT_TOKENS);
    if (rejected && want <= 4096) break; // 已降到下限仍拒 → 真·能力不足
    if (next === want) break; // 已到上限仍空 → 无预算可用
    want = next;
  }
  throw new Error('模型无输出（预算已自动协商仍无产出），请稍后重试或更换模型');
}

/** POST /api/tokenize：按 source 精确/启发式计数（server 返回 {count, approximate}） */
export function tokenizeMessages(
  source: LlmSource,
  model: string | undefined,
  messages: GenerateMessage[],
): Promise<{ count: number; approximate: boolean }> {
  return apiFetch('/api/tokenize', {
    method: 'POST',
    body: JSON.stringify({
      source,
      ...(model ? { model } : {}),
      messages: messages.map((m) => ({ content: m.content })),
    }),
  });
}
