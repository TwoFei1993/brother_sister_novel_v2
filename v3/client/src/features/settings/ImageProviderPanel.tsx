/**
 * 生图通道面板（短剧）：GLM-Image（智谱，文字渲染强 0.1元/次）/ MiniMax image-01 切换
 * + 智谱密钥录入（独立端点读-合-写，不影响对话通道密钥）。
 */
import { useCallback, useEffect, useState } from 'react';

import { getSecretsMask, putArkKey, putZhipuKey } from './api';
import { useSettingsStore } from '../../stores/settings';

const PROVIDERS: ReadonlyArray<{
  id: 'minimax' | 'zhipu' | 'seedream' | 'comfy';
  label: string;
  desc: string;
  recommended?: boolean;
  price?: string;
}> = [
  {
    id: 'comfy',
    label: '本地 ComfyUI（Z-Image-Turbo）',
    desc: '自家电脑出图：免费、秒级、中文提示词直出；需本机/局域网 ComfyUI 引擎（下方「本地引擎」面板配置地址），引擎离线时请切回云端',
    recommended: true,
    price: '免费',
  },
  {
    id: 'seedream',
    label: 'Seedream 5.0 Flash（火山方舟）',
    desc: '即梦同源 SOTA：动漫质量/文字/人物一致性全面领先；参考图输入免费（console.volcengine.com 方舟 API Key）——本地引擎不可用时的降级首选',
    price: '0.12 元/张',
  },
  {
    id: 'zhipu',
    label: 'GLM-Image（智谱）',
    desc: '中文文字渲染与多格一致性突出，需智谱密钥（bigmodel.cn）',
    price: '0.1 元/张',
  },
];

export default function ImageProviderPanel() {
  const imageProvider = useSettingsStore((s) => s.llmPrefs.imageProvider ?? 'minimax');
  const setLlmPrefs = useSettingsStore((s) => s.setLlmPrefs);
  const [maskZhipu, setMaskZhipu] = useState<boolean | null>(null);
  const [maskArk, setMaskArk] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getSecretsMask()
      .then((m) => {
        setMaskZhipu(Boolean((m as { zhipu?: boolean }).zhipu));
        setMaskArk(Boolean((m as { ark?: boolean }).ark));
      })
      .catch(() => {
        setMaskZhipu(null);
        setMaskArk(null);
      });
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
      if (imageProvider === 'seedream') {
        await putArkKey(k);
        setMsg('✅ 火山方舟密钥已保存');
      } else {
        await putZhipuKey(k);
        setMsg('✅ 智谱密钥已保存');
      }
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
        {PROVIDERS.map((pr) => {
          const active = imageProvider === pr.id;
          return (
            <label
              key={pr.id}
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors ${
                active
                  ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10'
                  : pr.recommended
                    ? 'border-[hsl(var(--accent))]/50'
                    : 'border-[hsl(var(--border-soft))]'
              }`}
            >
              <input
                type="radio"
                checked={active}
                onChange={() => setLlmPrefs({ imageProvider: pr.id })}
                className="mt-1"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium">{pr.label}</span>
                  {pr.recommended && (
                    <span className="rounded-full bg-[hsl(var(--accent))] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--accent-fg))]">
                      推荐
                    </span>
                  )}
                  {pr.price && (
                    <span className="ml-auto shrink-0 rounded bg-[hsl(var(--bg))] px-1.5 py-0.5 text-[10px] tabular-nums text-[hsl(var(--fg-muted))]">
                      {pr.price}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-[hsl(var(--fg-muted))]">{pr.desc}</span>
              </span>
            </label>
          );
        })}
      </div>

      {(imageProvider === 'zhipu' || imageProvider === 'seedream') && (
        <div className="mt-3 rounded-lg border border-[hsl(var(--border-soft))] p-3">
          <p className="mb-2 text-xs text-[hsl(var(--fg-muted))]">
            {imageProvider === 'zhipu' ? '智谱密钥：' : '火山方舟 API Key：'}
            {(imageProvider === 'zhipu' ? maskZhipu : maskArk) === true ? '✅ 已配置' : '未配置'}
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={maskZhipu || maskArk ? '已配置——输入新密钥可覆盖' : imageProvider === 'zhipu' ? '粘贴智谱 API Key…' : '粘贴火山方舟 API Key…'}
              className="h-10 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
              aria-label="生图 API Key"
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
