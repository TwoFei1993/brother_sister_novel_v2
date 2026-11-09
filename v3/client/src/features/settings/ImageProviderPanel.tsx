/**
 * 生图通道面板（短剧）：GLM-Image（智谱，文字渲染强 0.1元/次）/ MiniMax image-01 切换
 * + 智谱密钥录入（独立端点读-合-写，不影响对话通道密钥）。
 */
import { useCallback, useEffect, useState } from 'react';

import { getSecretsMask, putZhipuKey } from './api';
import { useSettingsStore } from '../../stores/settings';

const PROVIDERS: ReadonlyArray<{ id: 'minimax' | 'zhipu'; label: string; desc: string }> = [
  { id: 'zhipu', label: 'GLM-Image（智谱）', desc: '推荐：中文文字渲染与多格一致性突出，0.1 元/次，需智谱密钥（bigmodel.cn）' },
  { id: 'minimax', label: 'MiniMax image-01', desc: '当前默认通道；文字渲染与复杂版式较弱，用已配置的 MiniMax 密钥' },
];

export default function ImageProviderPanel() {
  const imageProvider = useSettingsStore((s) => s.llmPrefs.imageProvider ?? 'minimax');
  const setLlmPrefs = useSettingsStore((s) => s.setLlmPrefs);
  const [maskZhipu, setMaskZhipu] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getSecretsMask()
      .then((m) => setMaskZhipu(Boolean((m as { zhipu?: boolean }).zhipu)))
      .catch(() => setMaskZhipu(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function saveKey(): Promise<void> {
    const k = keyInput.trim();
    if (!k || saving) return;
    setSaving(true);
    setMsg(null);
    try {
      await putZhipuKey(k);
      setMsg('✅ 智谱密钥已保存');
      setKeyInput('');
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-[hsl(var(--border-soft))] p-5" data-testid="image-provider-panel">
      <h3 className="mb-1 text-sm font-semibold">🖼️ 生图通道（短剧出图）</h3>
      <p className="mb-3 text-xs text-[hsl(var(--fg-muted))]">
        角色/场景/四宫格出图使用的生成服务。GLM-Image 对设定图版式、中文文字与多格一致性明显更好。
      </p>
      <div className="flex flex-col gap-2">
        {PROVIDERS.map((pr) => (
          <label
            key={pr.id}
            className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors ${
              imageProvider === pr.id ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10' : 'border-[hsl(var(--border-soft))]'
            }`}
          >
            <input
              type="radio"
              checked={imageProvider === pr.id}
              onChange={() => setLlmPrefs({ imageProvider: pr.id })}
              className="mt-1"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{pr.label}</span>
              <span className="block text-xs text-[hsl(var(--fg-muted))]">{pr.desc}</span>
            </span>
          </label>
        ))}
      </div>

      {imageProvider === 'zhipu' && (
        <div className="mt-3 rounded-lg border border-[hsl(var(--border-soft))] p-3">
          <p className="mb-2 text-xs text-[hsl(var(--fg-muted))]">
            智谱密钥：{maskZhipu === true ? '✅ 已配置' : maskZhipu === false ? '未配置（bigmodel.cn 注册获取）' : '…'}
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={maskZhipu ? '已配置——输入新密钥可覆盖' : '粘贴智谱 API Key…'}
              className="h-10 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
              aria-label="智谱 API Key"
            />
            <button
              type="button"
              onClick={() => void saveKey()}
              disabled={!keyInput.trim() || saving}
              className="h-10 shrink-0 rounded-lg bg-[hsl(var(--accent))] px-4 text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
              data-testid="zhipu-key-save"
            >
              {saving ? '保存中…' : '保存密钥'}
            </button>
          </div>
          {msg && <p className="mt-2 text-xs text-[hsl(var(--fg-muted))]">{msg}</p>}
        </div>
      )}
    </section>
  );
}
