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
  /** 思考模式（D4）：claude 通道开启上游思考流；缺省（老用户无此字段）视为开，消费处用 !== false 判定 */
  thinking?: boolean;
  /** 频率惩罚（-2~2，openai 通道透传）：采样层压制重复——治重复循环的三道防线之二 */
  frequencyPenalty?: number;
  /** 存在惩罚（-2~2，openai 通道透传）：鼓励新话题 */
  presencePenalty?: number;
  /** 重复惩罚（1~2，claude/MiniMax 通道）：出现重复时小步上调，默认关闭 */
  repetitionPenalty?: number;
  /** 润色模型（可选）：正文生成后用该模型二次润色（同通道）；留空关闭 */
  polishModel?: string;
  /** 生图通道（用户决策 2026-11-11：默认强制本地 ComfyUI，不再用 minimax 生图）：zhipu / seedream 为手动切换的云端备选，comfy=本地免费秒级 */
  imageProvider?: 'minimax' | 'zhipu' | 'seedream' | 'comfy';
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

/** 默认生成通道：MiniMax（Claude 兼容端点，密钥与地址配置在服务端 secrets.json）；模型 M3.1-Flash（2026-10 实测 /models 列表在册，anthropic 端点可用）。
 *  maxContext 默认 64k（生成提速主开关）：实测 12 章书全量上下文 132k token 时上游 prefill 耗时与
 *  输出同量级（单章 140s+）——64k 下历史自动裁剪，裁掉部分由滚动摘要/章节骨架/相关性召回兜底
 *  （三者正是为此设计的长程记忆机制）；桌面「模型与预算」面板可改，更大值供长篇连贯性优先场景 */
const DEFAULT_PREFS: LlmPrefs = {
  source: 'claude',
  model: 'MiniMax-M3.1-Flash',
  maxContext: 65536,
  maxTokens: 8192,
  temperature: 0.8,
  /** 生图默认走本地 ComfyUI（用户决策：不用 minimax 生图） */
  imageProvider: 'comfy',
};

/** localStorage 持久化切片（partialize 输出；migrate 返回值同构） */
interface PersistedSettings {
  llmPrefs: LlmPrefs;
  /** 用户固定主题（null = 跟随作品题材；值 = ThemeName，见 lib/theme.ts） */
  uiTheme: string | null;
}

interface SettingsState {
  config: ConfigDto | null;
  llmPrefs: LlmPrefs;
  uiTheme: string | null;
  /** null = 清空会话内存态（登出 D5；llmPrefs 设备偏好保留不随登出清除） */
  setConfig: (config: ConfigDto | null) => void;
  setLlmPrefs: (patch: Partial<LlmPrefs>) => void;
  setUiTheme: (theme: string | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      config: null,
      llmPrefs: DEFAULT_PREFS,
      uiTheme: null,
      setConfig: (config) => set({ config }),
      setLlmPrefs: (patch) => set((s) => ({ llmPrefs: { ...s.llmPrefs, ...patch } })),
      setUiTheme: (uiTheme) => set({ uiTheme }),
    }),
    {
      name: 'v3-llm-prefs',
      version: 5,
      migrate: (persisted: unknown, version: number): PersistedSettings => {
        const prev =
          typeof persisted === 'object' && persisted !== null
            ? (persisted as { llmPrefs?: LlmPrefs })
            : {};
        // 0→1 丢弃旧偏好换新默认通道；1→2 新增 uiTheme；2→3 为缺失的预算字段补默认值
        // （保留用户已显式设置的字段，仅补缺——修复旧浏览器预算过小导致续写截断前文）
        // 3→4 生成提速：maxContext 旧默认 1M（等于不裁剪，实测 132k 上下文 prefill 拖慢单章生成）
        // 升级为 64k——仅当用户从未主动修改（仍等于旧默认值）时替换，显式设置过的其他值一律保留
        const llmPrefs =
          version < 1
            ? { ...DEFAULT_PREFS }
            : { ...DEFAULT_PREFS, ...(prev.llmPrefs ?? {}), model: prev.llmPrefs?.model ?? DEFAULT_PREFS.model };
        if (llmPrefs.maxContext === 1000000) llmPrefs.maxContext = DEFAULT_PREFS.maxContext;
        // 4→5 生图强制本地 ComfyUI（用户决策：不用 minimax 生图）——旧存储的 minimax 通道迁移为 comfy
        if (llmPrefs.imageProvider === 'minimax') llmPrefs.imageProvider = 'comfy';
        return { llmPrefs, uiTheme: null };
      },
      storage: createJSONStorage(() => localStorage),
      // 只持久化偏好；config 属会话态，每次登录重新拉取
      partialize: (s): PersistedSettings => ({ llmPrefs: s.llmPrefs, uiTheme: s.uiTheme }),
    },
  ),
);
