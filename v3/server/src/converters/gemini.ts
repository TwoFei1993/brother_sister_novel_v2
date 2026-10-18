// Gemini generateContent 通道：全部 system（无论位置）抽入 systemInstruction、
// assistant→model、name 前缀、连续同 role 合并、generationConfig 字段名映射。
// 对照酒馆 convertGooglePrompt（一期为纯文本，不含多模态/thoughtSignature）。
import { mergeConsecutive, PROMPT_PLACEHOLDER, requireMessages, withNamePrefix } from './common';
import type { ChatMessage, GenParams, GeminiBody } from './types';

/** 中间格式 → Gemini /v1beta/models/{model}:generateContent 请求体 */
export function toGemini(messages: ChatMessage[], params: GenParams): GeminiBody {
  requireMessages(messages);

  // 1. 全部 system 消息（无论位置）抽出合并进 systemInstruction.parts，每条一个 part
  const sysParts: Array<{ text: string }> = [];
  // 2. 非 system：assistant→model、name 前缀，先规整为 {role, content} 再统一合并
  const turns: Array<{ role: 'user' | 'model'; content: string }> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      sysParts.push({ text: withNamePrefix(m).content });
      continue;
    }
    turns.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      content: withNamePrefix(m).content,
    });
  }

  // 3. 输入全是 system 时 contents 为空 → 插入占位 user turn（Gemini 要求 contents 非空）
  if (turns.length === 0) turns.push({ role: 'user', content: PROMPT_PLACEHOLDER });

  const body: GeminiBody = {
    contents: mergeConsecutive(turns).map((t) => ({ role: t.role, parts: [{ text: t.content }] })),
    generationConfig: {},
  };
  if (sysParts.length > 0) body.systemInstruction = { parts: sysParts };
  if (params.temperature !== undefined) body.generationConfig.temperature = params.temperature;
  if (params.top_p !== undefined) body.generationConfig.topP = params.top_p;
  if (params.max_tokens !== undefined) body.generationConfig.maxOutputTokens = params.max_tokens;
  return body;
}
