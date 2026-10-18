/**
 * 设置域 API 封装：secrets / config / health / llm-test
 * 全部走统一 apiFetch（cookie 鉴权、非 2xx 抛 ApiError）。
 */
import { apiFetch } from '../../api/client';
import type { LlmSource } from '../../stores/settings';

import type { AppConfigDto, HealthDto, LlmTestResult, SecretsMask, SecretsPutBody } from './types';

/** 读取密钥掩码（哪些通道已配置） */
export function getSecretsMask(): Promise<SecretsMask> {
  return apiFetch<SecretsMask>('/api/secrets');
}

/** 写入密钥（整文件覆盖：body 里未带的通道会被清空，调用方须自行合并） */
export function putSecrets(body: SecretsPutBody): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/api/secrets', { method: 'PUT', body: JSON.stringify(body) });
}

/** 读取运行配置 */
export function getConfig(): Promise<AppConfigDto> {
  return apiFetch<AppConfigDto>('/api/config');
}

/** 写入运行配置（整文件覆盖：调用方须先 GET 合并再 PUT，避免丢 globalVariables） */
export function putConfig(config: AppConfigDto): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/api/config', { method: 'PUT', body: JSON.stringify(config) });
}

/** LLM 通道探活（model 缺省时 server 用各通道兜底小模型） */
export function testLlm(source: LlmSource, model?: string): Promise<LlmTestResult> {
  return apiFetch<LlmTestResult>('/api/llm/test', {
    method: 'POST',
    body: JSON.stringify(model ? { source, model } : { source }),
  });
}

/** 健康自检（免鉴权；TtsPanel 用 tts 三态） */
export function getHealth(): Promise<HealthDto> {
  return apiFetch<HealthDto>('/api/health');
}
