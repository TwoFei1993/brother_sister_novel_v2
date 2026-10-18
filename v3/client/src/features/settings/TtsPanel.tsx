/**
 * TTS 面板：easyvoice 服务地址查看/修改（GET/PUT /api/config）+ 连通测试（GET /api/health）
 *
 * PUT /api/config 为整文件覆盖写 → 保存前先 GET 最新配置合并（保留 globalVariables）；
 * 保存成功后同步 settingsStore.config（TTS 消费方从 store 取地址）。
 */
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../../api/client';
import { useSettingsStore } from '../../stores/settings';

import { getConfig, getHealth, putConfig } from './api';
import type { AppConfigDto, HealthTts } from './types';

/** tts 三态 → 人话 + 颜色 */
const TTS_STATE_TEXT: Record<HealthTts, { text: string; cls: string }> = {
  ok: { text: 'TTS 服务连通正常', cls: 'text-emerald-400' },
  down: { text: 'TTS 服务无法连通，请检查地址或服务是否在线', cls: 'text-[hsl(var(--danger))]' },
  unset: { text: '未设置 TTS 地址', cls: 'text-[hsl(var(--fg-muted))]' },
};

const inputCls =
  'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2.5 text-base outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]';

export default function TtsPanel() {
  const setConfig = useSettingsStore((s) => s.setConfig);
  const [ttsUrl, setTtsUrl] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [ttsState, setTtsState] = useState<HealthTts | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(() => {
    getConfig()
      .then((c) => {
        setTtsUrl(c.ttsBaseUrl ?? '');
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : '配置加载失败，请刷新重试'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(): Promise<void> {
    if (saving) return;
    const url = ttsUrl.trim();
    if (url) {
      try {
        new URL(url);
      } catch {
        setSaveMsg({ kind: 'err', text: '地址格式不正确，须为完整 URL（含 https://）' });
        return;
      }
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      // 整文件覆盖写：先取最新配置合并，避免丢 globalVariables 等字段
      const current = await getConfig();
      const next: AppConfigDto = { ...current, ttsBaseUrl: url || undefined };
      await putConfig(next);
      setConfig(next); // 同步会话 store，TTS 消费方立即取到新地址
      setSaveMsg({ kind: 'ok', text: '已保存' });
    } catch (err) {
      setSaveMsg({
        kind: 'err',
        text: err instanceof ApiError ? err.message : '保存失败，请稍后重试',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(): Promise<void> {
    if (testing) return;
    setTesting(true);
    setTtsState(null);
    try {
      const h = await getHealth();
      setTtsState(h.tts);
    } catch {
      setTtsState('down'); // 健康检查本身不可达 ≈ 探测失败
    } finally {
      setTesting(false);
    }
  }

  return (
    <section aria-label="TTS 设置" className="flex flex-col gap-4">
      <div className="rounded-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-5">
        <h3 className="mb-1 text-base font-semibold">TTS 听书服务</h3>
        <p className="mb-4 text-xs text-[hsl(var(--fg-muted))]">
          对接 easyvoice 语音合成服务的地址（部署时由服务端 TTS_BASE_URL 初始化，可在此修改）。
        </p>

        {loadError ? (
          <p role="alert" className="mb-3 text-sm text-[hsl(var(--danger))]">
            {loadError}
          </p>
        ) : (
          <>
            <label className="mb-1 block text-sm" htmlFor="tts-url">
              服务地址
            </label>
            <input
              id="tts-url"
              type="url"
              value={ttsUrl}
              onChange={(e) => setTtsUrl(e.target.value)}
              placeholder="https://your-easyvoice.example.com"
              autoComplete="off"
              className={`${inputCls} mb-4`}
            />

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent-fg))] transition-opacity disabled:opacity-40"
              >
                {saving ? '保存中…' : '保存'}
              </button>
              <button
                type="button"
                disabled={testing}
                onClick={() => void handleTest()}
                className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-4 text-sm transition-colors hover:border-[hsl(var(--accent))] disabled:opacity-40"
              >
                {testing ? '测试中…' : '测试连通'}
              </button>
            </div>

            {saveMsg && (
              <p
                role={saveMsg.kind === 'err' ? 'alert' : 'status'}
                className={`mt-3 text-sm ${
                  saveMsg.kind === 'err' ? 'text-[hsl(var(--danger))]' : 'text-emerald-400'
                }`}
              >
                {saveMsg.text}
              </p>
            )}
            {ttsState && (
              <p role="status" className={`mt-3 text-sm ${TTS_STATE_TEXT[ttsState].cls}`}>
                {TTS_STATE_TEXT[ttsState].text}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
