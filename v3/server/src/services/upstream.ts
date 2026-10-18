/**
 * LLM 上游协议适配（Task 17）：三通道请求构造与响应解析
 *
 * 只做「协议」：怎么组 URL/headers、怎么从流式 chunk / 完整响应里取文本。
 * 编排（密钥读取、错误翻译、超时控制）在 llm.ts，互不纠缠。
 * 通道细节对照酒馆 chat-completions.js / prompt-converters 的上游约定。
 */
import type { LlmSource } from '../converters';

/** secrets.json 单通道明文（gemini/claude 的 baseUrl 供中转站覆盖，默认官方地址） */
export interface ChannelSecret {
  apiKey: string;
  baseUrl?: string;
}

/** secrets.json 明文结构（与 routes/core/secrets.ts 同一文件，此处为服务端消费视角） */
export type SecretsFull = { openai?: ChannelSecret; gemini?: ChannelSecret; claude?: ChannelSecret };

/** 组好的上游请求（url 已含密钥时，禁止原样进日志/错误消息） */
export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

const trimBase = (u: string): string => u.replace(/\/+$/, '');

/** 按通道组上游 URL + headers + body（stream 决定流式端点与 stream 字段） */
export function buildUpstreamRequest(
  source: LlmSource,
  converted: object,
  secrets: SecretsFull,
  model: string,
  stream: boolean,
): UpstreamRequest {
  const withStream = stream ? { stream: true } : {};
  switch (source) {
    case 'openai': {
      const ch = secrets.openai;
      const base = trimBase(ch?.baseUrl ?? 'https://api.openai.com/v1');
      return {
        url: `${base}/chat/completions`,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ch?.apiKey}` },
        body: { ...converted, ...withStream },
      };
    }
    case 'claude': {
      const ch = secrets.claude;
      const base = trimBase(ch?.baseUrl ?? 'https://api.anthropic.com');
      return {
        url: `${base}/v1/messages`,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ch?.apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: { ...converted, model, ...withStream },
      };
    }
    case 'gemini': {
      const ch = secrets.gemini;
      const base = trimBase(ch?.baseUrl ?? 'https://generativelanguage.googleapis.com');
      const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
      const sep = action.includes('?') ? '&' : '?';
      return {
        url: `${base}/v1beta/models/${encodeURIComponent(model)}:${action}${sep}key=${ch?.apiKey ?? ''}`,
        headers: { 'Content-Type': 'application/json' },
        body: converted,
      };
    }
  }
}

// ---------- 响应解析（三通道宽松形状，只声明消费的字段） ----------

interface OpenAiChunk {
  choices?: Array<{ delta?: { content?: string } }>;
}
interface ClaudeChunk {
  type?: string;
  delta?: { type?: string; text?: string };
}
interface GeminiChunk {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}
interface OpenAiFull {
  choices?: Array<{ message?: { content?: string } }>;
}
interface ClaudeFull {
  content?: Array<{ type?: string; text?: string }>;
}

export interface DeltaResult {
  text: string;
  done: boolean;
}

/** 从上游单个 SSE chunk JSON 提取增量文本与结束信号（三通道取值路径） */
export function extractStreamDelta(source: LlmSource, json: Record<string, unknown>): DeltaResult {
  if (source === 'openai') {
    const chunk = json as OpenAiChunk;
    return { text: chunk.choices?.[0]?.delta?.content ?? '', done: false };
  }
  if (source === 'claude') {
    const chunk = json as ClaudeChunk;
    if (chunk.type === 'message_stop') return { text: '', done: true };
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      return { text: chunk.delta.text ?? '', done: false };
    }
    return { text: '', done: false };
  }
  // gemini：candidates[0].content.parts[].text 合并
  const parts = (json as GeminiChunk).candidates?.[0]?.content?.parts ?? [];
  return { text: parts.map((p) => p.text ?? '').join(''), done: false };
}

/** 非流式完整响应 → 全文（openai message.content / claude content[].text 合并 / gemini parts 合并） */
export function extractFullText(source: LlmSource, json: Record<string, unknown>): string {
  if (source === 'openai') return (json as OpenAiFull).choices?.[0]?.message?.content ?? '';
  if (source === 'claude') {
    const blocks = (json as ClaudeFull).content ?? [];
    return blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  }
  const parts = (json as GeminiChunk).candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? '').join('');
}

/** 上游响应体逐行产出 SSE data 载荷（跨 chunk 缓冲拼接，处理不完整行） */
export async function* sseDataLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
        nl = buf.indexOf('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
