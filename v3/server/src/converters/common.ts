// 三通道转换器的共享内部工具：空校验、name 前缀、连续同 role 合并。
// 行为对照酒馆 SillyTavern src/prompt-converters.js。

import type { ChatMessage } from './types';

/** 酒馆 PROMPT_PLACEHOLDER：全 system 输入被抽干后的占位 user 消息 */
export const PROMPT_PLACEHOLDER = "Let's get started.";

/** 空 messages 直接拒绝（三通道统一语义） */
export function requireMessages(messages: ChatMessage[]): void {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages 不能为空');
  }
}

/** claude/gemini 无 name 字段：合并为 content 前缀「名字: 」（已带前缀则不重复，对齐酒馆 startsWith 防重） */
export function withNamePrefix(m: ChatMessage): ChatMessage {
  if (m.name === undefined || m.content.startsWith(`${m.name}: `)) return m;
  return { ...m, content: `${m.name}: ${m.content}` };
}

/** 连续同 role 消息以 \n\n 合并（Claude/Gemini 要求角色交替；各自 name 前缀在合并前已加好） */
export function mergeConsecutive<T extends { role: string; content: string }>(items: T[]): T[] {
  const out: T[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && last.role === item.role) {
      last.content += `\n\n${item.content}`;
    } else {
      out.push({ ...item });
    }
  }
  return out;
}
