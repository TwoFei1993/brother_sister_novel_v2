/**
 * 设置域类型（对齐 server Task 5/17 契约）：
 * - secrets：PUT 整文件覆盖写（三通道可选），GET 只回布尔掩码
 * - llm/test：{ok:true} 或 {ok:false, code}（HTTP 200，错误经 code 表达）
 * - health：tts 三态 ok/down/unset
 */
import type { LlmSource } from '../../stores/settings';

/** PUT /api/secrets 请求体（server secretsSchema；gemini/claude 的 baseUrl 会被服务端 strip，暂不暴露 UI） */
export interface SecretsPutBody {
  openai?: { apiKey: string; baseUrl?: string };
  gemini?: { apiKey: string };
  claude?: { apiKey: string };
}

/** GET /api/secrets 响应：通道是否已配置（掩码，不回明文） */
export type SecretsMask = Record<LlmSource, boolean>;

/** POST /api/llm/test 响应 */
export type LlmTestResult = { ok: true } | { ok: false; code: string };

/** GET /api/health 的 tts 字段三态 */
export type HealthTts = 'ok' | 'down' | 'unset';

/** GET /api/health 响应（storage/llm 顺带定义，供扩展） */
export interface HealthDto {
  storage: 'ok' | 'fail';
  tts: HealthTts;
  llm: SecretsMask;
}

/** GET/PUT /api/config 响应体（与 server configSchema 对齐；globalVariables 保存时原样透传） */
export interface AppConfigDto {
  ttsBaseUrl?: string;
  globalVariables?: Record<string, string>;
  [key: string]: unknown;
}

/** LLM 错误码 → 人话（server LlmErrorCode 全集；未知码兜底展示原码） */
export const LLM_ERROR_TEXT: Record<string, string> = {
  LLM_AUTH: '密钥无效或无访问权限',
  LLM_QUOTA: '额度不足或已触发限流',
  LLM_NET: '网络不通或上游服务异常',
  LLM_TIMEOUT: '连接超时，请稍后再试',
  LLM_REJECTED: '请求被上游安全策略拒绝',
  LLM_NOKEY: '该通道尚未配置密钥',
  LLM_UPSTREAM: '上游请求失败',
};

/** 错误码人话：有映射用映射，否则显示原码便于排查 */
export function describeLlmCode(code: string): string {
  return LLM_ERROR_TEXT[code] ?? `未知错误（${code}）`;
}
