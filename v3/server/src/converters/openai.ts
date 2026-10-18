// OpenAI Chat Completions 通道：消息直传（name 原生支持），采样参数透传。
import { requireMessages } from './common';
import type { ChatMessage, GenParams, OpenAIBody } from './types';

/** 中间格式 → OpenAI /v1/chat/completions 请求体（消息原样直传，不做位置/角色改写） */
export function toOpenAI(messages: ChatMessage[], params: GenParams): OpenAIBody {
  requireMessages(messages);

  const body: OpenAIBody = {
    messages: messages.map((m) => (m.name === undefined ? { role: m.role, content: m.content } : { role: m.role, name: m.name, content: m.content })),
  };
  if (params.model !== undefined) body.model = String(params.model);
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.top_p !== undefined) body.top_p = params.top_p;
  if (params.max_tokens !== undefined) body.max_tokens = params.max_tokens;
  return body;
}
