/**
 * 选段 AI 工具（Sudowrite 式局部编辑）：阅读区选中文字 → 润色/扩写/重写 → 结果弹窗 → 应用替换
 *
 * - 全局监听 selectionchange（防抖）：选段 2~2000 字才显示浮层
 * - 浮层容器 onMouseDown preventDefault：点击按钮时不清除浏览器选区
 * - 应用语义：在所属章节原文中替换选段首次出现（applySelectionResult；定位失败提示）
 * - LLM：走当前通道非流式；llmPrefs 提供模型/温度
 */
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { apiFetch } from '../../api/client';
import { generateTextOnce } from '../../api/llm';
import { applySelectionResult, selectionPrompt, SELECTION_MODES, type SelectionMode } from '../../lib/selection-actions';
import { useSettingsStore } from '../../stores/settings';
import { useWorkStore } from '../../stores/work';

interface SelectionToolsProps {
  /** 选段归属定位：返回包含该选段的章节消息 id 与原文内容（找不到返回 null） */
  getTarget: (selection: string) => { messageId: string; content: string } | null;
  /** 应用成功后回调（父级更新 store/界面） */
  onApplied?: (messageId: string, nextContent: string) => void;
}

export default function SelectionTools({ getTarget, onApplied }: SelectionToolsProps) {
  const [selText, setSelText] = useState<string | null>(null);
  const [busyMode, setBusyMode] = useState<SelectionMode | null>(null);
  const [result, setResult] = useState<{ sel: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hideTimer = useRef<number | null>(null);

  // selectionchange 防抖采集：选段 2~2000 字才记录
  useEffect(() => {
    function onChange(): void {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        const sel = document.getSelection();
        const text = (sel?.toString() ?? '').trim();
        setSelText(text.length >= 2 && text.length <= 2000 ? text : null);
      }, 200);
    }
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  async function run(mode: SelectionMode): Promise<void> {
    if (!selText) return;
    const target = getTarget(selText);
    if (!target) {
      setError('无法定位选段所属章节（可能已被编辑），请重新选择');
      return;
    }
    setBusyMode(mode);
    setError(null);
    try {
      const idx = target.content.indexOf(selText);
      const contextBefore = idx > 0 ? target.content.slice(Math.max(0, idx - 400), idx) : '';
      const prefs = useSettingsStore.getState().llmPrefs;
      // 推理模型兜底：空输出（思考吃满预算）自动加倍预算重试一次；思考跟随用户设置
      const text = (
        await generateTextOnce(
          {
            source: prefs.source,
            model: prefs.model,
            temperature: 0.7,
            maxTokens: 3000,
            thinking: prefs.thinking !== false,
            messages: [{ role: 'user', content: selectionPrompt(mode, selText, contextBefore) }],
          },
          3000,
        )
      ).trim();
      if (!text) {
        setError('模型未返回内容，请重试或更换模型');
        return;
      }
      setResult({ sel: selText, text });
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setBusyMode(null);
    }
  }

  function apply(): void {
    if (!result) return;
    const target = getTarget(result.sel);
    if (!target) {
      setError('无法定位选段所属章节，请重新选择');
      return;
    }
    const next = applySelectionResult(target.content, result.sel, result.text);
    if (next === null) {
      setError('原文已被修改，无法定位选段；请重新选择');
      return;
    }
    onApplied?.(target.messageId, next);
    setResult(null);
    setSelText(null);
  }

  return (
    <>
      {selText && !result && (
        <div
          data-testid="selection-bar"
          className="safe-bottom fixed inset-x-0 bottom-20 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 py-2 shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="truncate text-xs text-[hsl(var(--fg-muted))]">
            已选 {selText.length} 字
          </span>
          {SELECTION_MODES.map(({ mode, label, hint }) => (
            <button
              key={mode}
              type="button"
              disabled={busyMode !== null}
              onClick={() => void run(mode)}
              data-testid={`selection-${mode}`}
              title={hint}
              className="min-h-[32px] rounded-lg border border-[hsl(var(--border-soft))] px-2.5 text-xs transition-colors hover:border-[hsl(var(--accent))] disabled:opacity-40"
            >
              {busyMode === mode ? '…' : label}
            </button>
          ))}
          {error && <span className="w-full text-xs text-[hsl(var(--danger))]">{error}</span>}
        </div>
      )}

      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="selection-modal">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-[hsl(var(--surface))] p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">AI 处理结果（可编辑后应用）</p>
              <button
                type="button"
                onClick={() => setResult(null)}
                aria-label="关闭"
                className="rounded px-2 text-sm text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <textarea
              value={result.text}
              onChange={(e) => setResult({ sel: result.sel, text: e.target.value })}
              rows={10}
              data-testid="selection-result"
              className="w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(result.text).catch(() => undefined);
                }}
                className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm"
              >
                复制
              </button>
              <button
                type="button"
                onClick={() => apply()}
                data-testid="selection-apply"
                className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm text-[hsl(var(--accent-fg))]"
              >
                应用替换
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

