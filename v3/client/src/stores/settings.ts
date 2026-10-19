/**
 * 设置域 store（设计 §7.2 settingsStore）
 *
 * - config：/api/config 下发的运行配置（TTS 地址等），会话内存态，登录后由 LoginPage 拉取
 * - llmPrefs：用户 LLM 通道偏好（非敏感——密钥存服务端），localStorage 持久化
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** LLM 三通道（设计 D4）：OpenAI 兼容 / Gemini 原生 / Claude 原生 */
export type LlmSource = 'openai' | 'gemini' | 'claude';

/** 用户 LLM 偏好：仅非敏感项，持久化 localStorage */
export interface LlmPrefs {
  source: LlmSource;
  /** 该通道下的模型名（如 gpt-4o / gemini-2.0-flash / claude-sonnet-4） */
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** 上下文预算（字符/token，按 §5.4 装填策略裁剪） */
  maxContext?: number;
}

/**
 * GET /api/config 返回体（client 唯一定义；features/settings/types.ts 以
 * AppConfigDto 别名 re-export，review #9 去重后统一为本契约）。
 * 已知字段显式声明，未知字段经索引签名透传不丢失——避免 any，保持结构可演进。
 */
export interface ConfigDto {
  /** TTS 引擎地址（server configSchema 契约；TtsPanel 读写字段） */
  ttsBaseUrl?: string;
  /** 全局变量（宏 {{getvar}} 全局作用域取值源） */
  globalVariables?: Record<string, string>;
  [key: string]: unknown;
}

const DEFAULT_PREFS: LlmPrefs = { source: 'openai', model: '' };

interface SettingsState {
  config: ConfigDto | null;
  llmPrefs: LlmPrefs;
  setConfig: (config: ConfigDto) => void;
  setLlmPrefs: (patch: Partial<LlmPrefs>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      config: null,
      llmPrefs: DEFAULT_PREFS,
      setConfig: (config) => set({ config }),
      setLlmPrefs: (patch) => set((s) => ({ llmPrefs: { ...s.llmPrefs, ...patch } })),
    }),
    {
      name: 'v3-llm-prefs',
      storage: createJSONStorage(() => localStorage),
      // 只持久化偏好；config 属会话态，每次登录重新拉取
      partialize: (s) => ({ llmPrefs: s.llmPrefs }),
    },
  ),
);
