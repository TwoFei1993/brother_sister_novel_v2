// LLM 三通道转换器的统一中间格式与各通道请求体类型。
// 中间格式对齐酒馆（SillyTavern）的 ChatML 形态：{role, name?, content}。

/** 统一中间消息格式（客户端装配产物 / 各通道转换的输入） */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** 说话者名（群聊/多角色场景）。openai 原生支持；claude/gemini 无此字段，转为 content 前缀「名字: 」 */
  name?: string;
  content: string;
}

/** 统一生成参数（各通道按需映射字段名） */
export interface GenParams {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  /** 透传通道差异参数（如 model） */
  [key: string]: unknown;
}

/** OpenAI Chat Completions 请求体 */
export interface OpenAIBody {
  model?: string;
  messages: Array<{ role: ChatMessage['role']; name?: string; content: string }>;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

/** Anthropic Messages 请求体（max_tokens 必填） */
export interface ClaudeBody {
  /** 合并为单字符串：兼容层（如 MiniMax anthropic 端点）不接受数组，官方两种皆可 */
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
}

/** Gemini generateContent 请求体 */
export interface GeminiBody {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  generationConfig: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
  };
}

/** LLM 通道标识 */
export type LlmSource = 'openai' | 'claude' | 'gemini';
