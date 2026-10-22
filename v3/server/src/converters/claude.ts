// Anthropic Messages 通道：头部连续 system 提取、其余 system→user、name 前缀、
// 连续同 role 合并、末尾 assistant 作为 prefill 保留、max_tokens 必填。
// 对照酒馆 convertClaudeMessages（不含 tools/多模态，一期为纯文本）。
import { mergeConsecutive, PROMPT_PLACEHOLDER, requireMessages, withNamePrefix } from './common';
import type { ChatMessage, ClaudeBody, GenParams } from './types';

/** 中间格式 → Anthropic /v1/messages 请求体 */
export function toClaude(messages: ChatMessage[], params: GenParams): ClaudeBody {
  requireMessages(messages);

  // 1. 头部连续 system 提取到 system[]（遇第一条非 system 即停，对齐酒馆）
  const system: string[] = [];
  let i = 0;
  while (i < messages.length && messages[i].role === 'system') {
    system.push(withNamePrefix(messages[i]).content);
    i++;
  }

  // 2. 其余消息：中部/尾部 system 降级为 user；name 合并为 content 前缀
  const rest = messages
    .slice(i)
    .map((m) => ({
      role: (m.role === 'system' ? 'user' : m.role) as 'user' | 'assistant',
      content: withNamePrefix(m).content,
    }));

  // 3. 输入全是 system 时提取后为空 → 插入占位 user（Messages API 要求 messages 非空，对齐酒馆）
  if (rest.length === 0) rest.push({ role: 'user', content: PROMPT_PLACEHOLDER });

  // 4. 连续同 role 以 \n\n 合并（末尾 assistant 天然保留为 assistant-prefill）
  const body: ClaudeBody = {
    messages: mergeConsecutive(rest),
    max_tokens: params.max_tokens ?? 4096,
  };
  // system 合并为单字符串：官方 Anthropic 同时接受字符串与块数组，
  // 但部分兼容端点（实测 MiniMax anthropic 端点）会静默丢弃数组——字符串是两边通吃的稳妥形态。
  if (system.length > 0) body.system = system.join('\n\n');
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.top_p !== undefined) body.top_p = params.top_p;
  // top_k（Anthropic 原生参数）：部分兼容端点不接受，仅在显式设置时透传
  if (params.top_k !== undefined) body.top_k = params.top_k;
  // 思考模式（D4）：params.thinking=true → 组装 extended-thinking 参数开启上游思考流
  // （MiniMax anthropic 端点默认关闭思考，需显式开启才返回 thinking_delta）。
  // budget 取 max_tokens 一半且 ≥1024、< max_tokens（协议约束 budget_tokens ≥1024 且必须小于 max_tokens）。
  // Anthropic 官方约束：thinking 开启时 temperature 必须未设或 1 且不可与 top_p 共用——统一锁 1 保兼容。
  if (params.thinking === true) {
    const maxTokens = body.max_tokens;
    body.thinking = {
      type: 'enabled',
      budget_tokens: Math.min(Math.max(1024, Math.floor(maxTokens / 2)), maxTokens - 1),
    };
    body.temperature = 1;
    delete body.top_p;
  }
  return body;
}
