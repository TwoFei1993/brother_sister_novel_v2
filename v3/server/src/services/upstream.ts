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
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
}
interface ClaudeChunk {
  type?: string;
  delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string };
}
interface GeminiChunk {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
}
interface OpenAiFull {
  choices?: Array<{ message?: { content?: string } }>;
}
interface ClaudeFull {
  content?: Array<{ type?: string; text?: string }>;
}

export interface DeltaResult {
  text: string;
  /** 思考流增量（D4：claude thinking_delta / gemini thought part）；无思考时缺省 */
  thinking?: string;
  /** 上游结束原因（openai finish_reason / claude stop_reason / gemini finishReason；
   *  'length'/'max_tokens' = 输出被截断——客户端截断自动续写的决定性信号） */
  finish?: string;
  done: boolean;
}

/** 从上游单个 SSE chunk JSON 提取增量文本与结束信号（三通道取值路径） */
export function extractStreamDelta(source: LlmSource, json: Record<string, unknown>): DeltaResult {
  if (source === 'openai') {
    const chunk = json as OpenAiChunk;
    const finish = typeof chunk.choices?.[0]?.finish_reason === 'string' ? chunk.choices[0]!.finish_reason : undefined;
    return { text: chunk.choices?.[0]?.delta?.content ?? '', ...(finish ? { finish } : {}), done: false };
  }
  if (source === 'claude') {
    const chunk = json as ClaudeChunk;
    if (chunk.type === 'message_stop') return { text: '', done: true };
    if (chunk.type === 'message_delta') {
      const finish = typeof chunk.delta?.stop_reason === 'string' ? chunk.delta.stop_reason : undefined;
      const thinking = typeof chunk.delta?.thinking === 'string' ? chunk.delta.thinking : undefined;
      return { text: '', ...(thinking ? { thinking } : {}), ...(finish ? { finish } : {}), done: false };
    }
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      return { text: chunk.delta.text ?? '', done: false };
    }
    // 思考流增量（D4）：官方协议为 delta.type='thinking_delta' 且内容在 delta.thinking；
    // 部分兼容实现写作 'thinking'，一并接受。MiniMax M3（anthropic 兼容通道）的真实主路径。
    if (
      chunk.type === 'content_block_delta' &&
      (chunk.delta?.type === 'thinking_delta' || chunk.delta?.type === 'thinking')
    ) {
      return { text: '', thinking: chunk.delta.thinking ?? '', done: false };
    }
    // message_delta 官方语义只带 stop_reason/usage；兼容实现若内嵌 thinking 同样透传
    if (chunk.type === 'message_delta' && typeof chunk.delta?.thinking === 'string') {
      return { text: '', thinking: chunk.delta.thinking, done: false };
    }
    return { text: '', done: false };
  }
  // gemini：candidates[0].content.parts[] 合并；thought:true 的 part 是思考流（不混入正文）
  const gem = json as GeminiChunk;
  const parts = gem.candidates?.[0]?.content?.parts ?? [];
  let text = '';
  let thinking = '';
  for (const p of parts) {
    if (p.thought === true) thinking += p.text ?? '';
    else text += p.text ?? '';
  }
  const finish = typeof gem.candidates?.[0]?.finishReason === 'string' ? gem.candidates[0]!.finishReason : undefined;
  return { text, ...(thinking ? { thinking } : {}), ...(finish ? { finish } : {}), done: false };
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
