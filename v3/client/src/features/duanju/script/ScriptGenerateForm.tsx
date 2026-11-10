/**
 * AI 生成剧本表单（共识 D5 来源①）：题材/基调/想法 → server 后台任务生成 → 回填
 *
 * 生成在 server 端后台执行（切出 App/锁屏后继续——手机端量大量场景核心保障）；
 * 结果经 localStorage『v3-script-gen-result』落盘，由 ScriptPane mount 消费回填
 * （原 promise 链死亡也不丢——结果落盘跨页面生命周期存活）。页面存活时保留
 * 打印机式流式预览（反馈 #10），断连时自动降级为后台轮询。
 */
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { buildGenerateBody, generateStream } from '../../../api/llm';
import { useSettingsStore } from '../../../stores/settings';
import { buildScriptGenMessages } from '../lib/prompts/prompts-script';
import { submitTask, waitAndStore, consumeResult, clearPending } from '../../../lib/llmTask';
import type { DuanjuProject } from '@shared/duanju';

interface Props {
  project: DuanjuProject;
  onClose: () => void;
  /** 生成完成（全文）；父级负责落库与关闭 */
  onGenerated: (text: string) => void;
}

const TONES = ['轻松日常', '热血爽感', '虐恋深情', '悬疑反转', '权谋博弈', '治愈温情'] as const;
const RESULT_KEY = 'v3-script-gen-result';
const SLOT = 'script-gen';

export default function ScriptGenerateForm({ project, onClose, onGenerated }: Props) {
  const [idea, setIdea] = useState('');
  const [tone, setTone] = useState<string>(TONES[0]);
  const [genreText, setGenreText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [buffer, setBuffer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const prefs = useSettingsStore((s) => s.llmPrefs);

  function buildMessages() {
    return buildScriptGenMessages({
      genre: genreText.trim() || '自由发挥',
      tone,
      idea: idea.trim(),
      protagonists: project.protagonists,
      targetEpisodes: project.targetEpisodes,
    });
  }

  /**
   * 后台模式完成处理：结果落盘 → ScriptPane mount 消费回填（跨页面生命周期存活）。
   * 本组件内直接回填一次（页面存活时立即生效，无需等 mount）。
   */
  function applyResult(text: string): void {
    localStorage.setItem(RESULT_KEY, text);
    onGenerated(text);
    localStorage.removeItem(RESULT_KEY);
  }

  /** 主路径：server 后台任务（切出安全；server 端预算协商同语义空输出加倍） */
  async function generateBg(): Promise<void> {
    setStreaming(true);
    setError(null);
    setBuffer('');
    try {
      await submitTask(SLOT, {
        source: prefs.source,
        model: prefs.model,
        messages: buildScriptGenMessages({
          genre: genreText.trim() || '自由发挥',
          tone,
          idea: idea.trim(),
          protagonists: project.protagonists,
          targetEpisodes: project.targetEpisodes,
        }),
        thinking: false,
        params: { max_tokens: 32000 },
        label: '剧本生成',
      });
      const text = await waitAndStore(SLOT, () => undefined);
      if (text.trim()) {
        applyResult(text);
        onClose();
      } else {
        setError('模型无文本输出，请重试');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请重试');
    } finally {
      setStreaming(false);
    }
  }

  /** 备选：前台流式（打印机式实时预览）——server 任务不可用时的降级路径 */
  async function generateStream_(prefs: ReturnType<typeof useSettingsStore.getState>['llmPrefs']): Promise<void> {
    setStreaming(true);
    setError(null);
    setBuffer('');
    const controller = new AbortController();
    let acc = '';
    let done = false;
    try {
      await generateStream(
        buildGenerateBody({
          source: prefs.source,
          model: prefs.model,
          messages: buildScriptGenMessages({
            genre: genreText.trim() || '自由发挥',
            tone,
            idea: idea.trim(),
            protagonists: project.protagonists,
            targetEpisodes: project.targetEpisodes,
          }),
          thinking: false,
          maxTokens: 32000,
        }),
        {
          onChunk: (t) => {
            acc += t;
            setBuffer(acc);
          },
          onDone: () => {
            done = true;
            if (acc.trim()) onGenerated(acc);
            else setError('模型无文本输出（思考流吃掉了输出），请重试');
          },
          onError: (e) => setError(e.message || '生成失败'),
        },
        controller.signal,
      );
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (!done && !isAbort) {
        setError(err instanceof Error ? err.message : '生成失败，请重试');
      }
    } finally {
      setStreaming(false);
    }
  }

  function stop(): void {
    abortRef.current?.abort();
    setStreaming(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={streaming ? undefined : onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="AI 生成剧本"
      >
        <div className="flex items-center justify-between border-b border-[hsl(var(--border-soft))] px-4 py-3">
          <h3 className="text-sm font-semibold">✨ AI 生成剧本（第 1 集）</h3>
          <button
            type="button"
            onClick={streaming ? stop : onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg))]"
            aria-label={streaming ? '停止生成' : '关闭'}
          >
            {streaming ? '⏹' : <X className="h-4 w-4" aria-hidden />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <label className="mb-3 block">
            <span className="mb-1 block text-xs text-[hsl(var(--fg-muted))]">一句话想法 *</span>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="例：外卖小哥送餐进豪门，发现大小姐是自己失散多年的妹妹……"
              rows={2}
              className="w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
            />
          </label>
          <div className="mb-3">
            <span className="mb-1 block text-xs text-[hsl(var(--fg-muted))]">基调</span>
            <div className="flex flex-wrap gap-2">
              {TONES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTone(t)}
                  className={`h-8 rounded-full border px-3 text-xs ${
                    tone === t
                      ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
                      : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <label className="mb-3 block">
            <span className="mb-1 block text-xs text-[hsl(var(--fg-muted))]">题材补充（可空）</span>
            <input
              value={genreText}
              onChange={(e) => setGenreText(e.target.value)}
              placeholder="例：都市+甜宠 / 穿越+宫斗 / 星际+机甲"
              className="h-10 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
            />
          </label>

          {buffer && (
            <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-3 text-xs leading-5">
              {buffer}
            </pre>
          )}
          {error && (
            <p className="mt-2 text-xs text-[hsl(var(--danger))]" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex gap-3 border-t border-[hsl(var(--border-soft))] px-4 py-3">
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="h-11 flex-1 rounded-lg border border-[hsl(var(--danger))]/60 text-sm text-[hsl(var(--danger))]"
            >
              停止生成
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="h-11 flex-1 rounded-lg border border-[hsl(var(--border-soft))] text-sm text-[hsl(var(--fg-muted))]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void generateBg()}
                disabled={!idea.trim()}
                className="h-11 flex-1 rounded-lg bg-[hsl(var(--accent))] text-sm font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
                data-testid="script-gen-start"
              >
                {buffer ? '重新生成' : '生成'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
