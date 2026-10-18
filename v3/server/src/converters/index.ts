// 三通道转换器汇出口 + convert(source, ...) 统一分发。
export { toOpenAI } from './openai';
export { toClaude } from './claude';
export { toGemini } from './gemini';
export type { ChatMessage, GenParams, LlmSource, OpenAIBody, ClaudeBody, GeminiBody } from './types';

import { toClaude } from './claude';
import { toGemini } from './gemini';
import { toOpenAI } from './openai';
import type { ChatMessage, ClaudeBody, GenParams, GeminiBody, LlmSource, OpenAIBody } from './types';

/** 按通道分发转换；未知通道抛错 */
export function convert(
  source: LlmSource,
  messages: ChatMessage[],
  params: GenParams,
): OpenAIBody | ClaudeBody | GeminiBody {
  switch (source) {
    case 'openai':
      return toOpenAI(messages, params);
    case 'claude':
      return toClaude(messages, params);
    case 'gemini':
      return toGemini(messages, params);
    default:
      throw new Error(`未知的 LLM 通道: ${String(source)}`);
  }
}
