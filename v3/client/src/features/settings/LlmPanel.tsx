/**
 * LLM 默认参数面板：source / 模型名 / 采样参数
 * 存 settingsStore.llmPrefs（zustand persist 到 localStorage，非敏感项）；
 * 更改即时生效，生成时由 useGenerate 读入 assemble 上下文（Task 19）。
 */
import type { ChangeEvent } from 'react';

import FieldHint from '../../components/FieldHint';
import { useSettingsStore, type LlmSource } from '../../stores/settings';

/** 通道选项（与 SecretsPanel 三通道一致；命名强调用途差异） */
const SOURCES: ReadonlyArray<{ value: LlmSource; label: string; hint: string }> = [
  { value: 'openai', label: 'OpenAI 兼容', hint: 'GPT 系列及各类兼容中转' },
  { value: 'gemini', label: 'Gemini', hint: 'Google Gemini 原生' },
  { value: 'claude', label: 'Claude', hint: 'Anthropic Claude 原生' },
];

/** 数字输入通用小样式（与全站表单一致） */
const inputCls =
  'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2.5 text-base outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]';

/** 可空数字解析：空串 → undefined（不发送该参数） */
function parseOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

export default function LlmPanel() {
  const llmPrefs = useSettingsStore((s) => s.llmPrefs);
  const setLlmPrefs = useSettingsStore((s) => s.setLlmPrefs);

  function onNumber(key: 'temperature' | 'maxTokens' | 'maxContext') {
    return (e: ChangeEvent<HTMLInputElement>) => {
      setLlmPrefs({ [key]: parseOptionalNumber(e.target.value) });
    };
  }

  return (
    <section aria-label="LLM 默认参数" className="flex flex-col gap-4">
      <p className="text-sm text-[hsl(var(--fg-muted))]">
        默认生成通道与采样参数，保存在本设备（localStorage），生成时自动应用。
      </p>

      <fieldset className="rounded-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-5">
        <legend className="px-1 text-sm font-semibold">生成通道</legend>
        <div className="flex flex-col gap-2">
          {SOURCES.map((s) => (
            <label
              key={s.value}
              className="flex min-h-[36px] cursor-pointer items-center gap-3 rounded-lg border border-[hsl(var(--border-soft))] px-3 py-2.5 has-checked:border-[hsl(var(--accent))] has-checked:bg-[hsl(var(--accent))]/10"
            >
              <input
                type="radio"
                name="llm-source"
                value={s.value}
                checked={llmPrefs.source === s.value}
                onChange={() => setLlmPrefs({ source: s.value })}
                className="h-4 w-4 accent-[hsl(var(--accent))]"
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium">{s.label}</span>
                <span className="text-xs text-[hsl(var(--fg-muted))]">{s.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-5">
        <legend className="px-1 text-sm font-semibold">模型与采样</legend>

        <label className="mb-1 flex items-center gap-1 text-sm" htmlFor="llm-model">
          模型名
          <FieldHint text="该通道下调用的模型 ID（如 MiniMax-M3、claude-sonnet-4），须与服务商提供的名称完全一致。" />
        </label>
        <input
          id="llm-model"
          type="text"
          value={llmPrefs.model}
          onChange={(e) => setLlmPrefs({ model: e.target.value })}
          placeholder="如 MiniMax-M3、claude-sonnet-4 等"
          autoComplete="off"
          className={`${inputCls} mb-1`}
        />
        <p className="mb-4 text-xs text-[hsl(var(--fg-muted))]">
          留空时「测试连接」会用各通道的内置探活小模型；正式生成前请填写。
        </p>

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 flex items-center gap-1 text-sm" htmlFor="llm-temperature">
              Temperature
              <FieldHint text="随机度：0 严谨固定，1 均衡，1.5+ 天马行空。小说续写建议 0.8–1.2。" />
            </label>
            <input
              id="llm-temperature"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={llmPrefs.temperature ?? ''}
              onChange={onNumber('temperature')}
              placeholder="1"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-[hsl(var(--fg-muted))]">0–2，越高越发散</p>
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1 text-sm" htmlFor="llm-max-tokens">
              最大输出 tokens
              <FieldHint text="单次生成长度上限，1 token ≈ 0.7 个汉字；一章 2000 字建议 4096 以上。" />
            </label>
            <input
              id="llm-max-tokens"
              type="number"
              min={1}
              step={100}
              value={llmPrefs.maxTokens ?? ''}
              onChange={onNumber('maxTokens')}
              placeholder="4096"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-[hsl(var(--fg-muted))]">单次生成的长度上限</p>
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1 text-sm" htmlFor="llm-max-context">
              上下文预算 tokens
              <FieldHint text="发给 AI 的总预算上限：历史装填预算 = 此值 − 最大输出。建议不超过模型窗口的 3/4。" />
            </label>
            <input
              id="llm-max-context"
              type="number"
              min={1}
              step={1000}
              value={llmPrefs.maxContext ?? ''}
              onChange={onNumber('maxContext')}
              placeholder="32768"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-[hsl(var(--fg-muted))]">
              历史装填预算 = 此值 − 最大输出
            </p>
          </div>
        </div>
      </fieldset>
    </section>
  );
}
