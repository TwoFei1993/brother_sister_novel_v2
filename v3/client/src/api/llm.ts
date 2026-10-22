/**
 * LLM 生成流 API（设计 §3.2 / §6）：/api/llm/generate（SSE）+ /api/tokenize
 *
 * 帧协议（server routes/llm.ts）：增量 `data: {"text": "..."}`、流中错误
 * `data: {"error": {code, message}}`、收束 `data: [DONE]`。
 * generateStream 负责帧分发（text→onChunk / error→onError），onDone 仅在流正常
 * 结束（收到 [DONE]）后恰调用一次；静默断流（流结束/连接中断而未见 [DONE]）
 * 抛 ApiError{code:'streamIncomplete'}，不触发 onDone（§9.2 半成品不得 finalize）。
 */
import { apiFetch, apiStream } from './client';
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
  /** 流正常结束（收到 [DONE]），恰一次；断流（streamIncomplete）不触发 */
  onDone: () => void;
  /** 收到流中错误帧 */
  onError: (error: LlmStreamError) => void;
}

/** SSE 帧形状（text/thinking 可同帧共存，与 error 互斥） */
interface SseFrame {
  text?: unknown;
  thinking?: unknown;
  error?: { code?: unknown; message?: unknown };
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
  }, signal);
  handlers.onDone();
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
