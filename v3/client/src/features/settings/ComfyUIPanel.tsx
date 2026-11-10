/**
 * 本地视频引擎面板（frontend-design 精修标准）：ComfyUI 地址 + H3 工作流粘贴 + 探活
 *
 * 与生图面板同层级；配置存 localStorage（非敏感：局域网地址 + 工作流 JSON）。
 */
import { useCallback, useEffect, useState } from 'react';

import { loadComfyConfig, pingComfy, saveComfyConfig } from '../../features/duanju/lib/comfy';

const WF_PLACEHOLDER = `在 ComfyUI 界面：Settings → 启用开发者模式 →
打开你的 H3 图生视频工作流 → Export (API) 导出 JSON →
把其中图片节点的 image 值改为 "<<FRAME>>"、
正向提示词节点的 text 改为 "<<PROMPT>>" → 粘贴到这里`;

export default function ComfyUIPanel() {
  const [cfg, setCfg] = useState(loadComfyConfig);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(() => {
    pingComfy(cfg.url).then((r) =>
      setMsg(r.ok ? { ok: true, text: '✅ 连接成功——本地引擎在线' } : { ok: false, text: `无法连接：${r.detail ?? '引擎未启动或地址不对'}` }),
    );
  }, [cfg.url]);

  useEffect(() => {
    if (cfg.url.trim()) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inputCls =
    'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 font-mono text-xs outline-none focus:border-[hsl(var(--accent))]';

  return (
    <section className="rounded-xl border border-[hsl(var(--border-soft))] p-5" data-testid="comfyui-panel">
      <h3 className="mb-1 text-sm font-semibold">🎬 本地视频引擎（ComfyUI · H3）</h3>
      <p className="mb-3 text-xs leading-5 text-[hsl(var(--fg-muted))]">
        镜头卡「本地生成视频」的执行引擎：装在家里的台式机，免费出片（H3-Base 开源权重，0.12 元都不用）。
        手机/平板经隧道远程使用，引擎离线时自动降级到即梦手动路线。
      </p>

      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-[hsl(var(--fg-muted))]">ComfyUI 地址</span>
          <input
            value={cfg.url}
            onChange={(e) => setCfg({ ...cfg, url: e.target.value })}
            placeholder="http://192.168.1.10:8188"
            className="h-10 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 font-mono text-xs outline-none focus:border-[hsl(var(--accent))]"
            aria-label="ComfyUI 地址"
          />
        </label>

        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-[hsl(var(--fg-muted))]">
            H3 图生视频工作流（API 格式，占位符 {'<<FRAME>>'} / {'<<PROMPT>>'}）
          </span>
          <textarea
            value={cfg.workflow}
            onChange={(e) => setCfg({ ...cfg, workflow: e.target.value })}
            rows={4}
            placeholder={WF_PLACEHOLDER}
            className={`${inputCls} leading-5`}
            aria-label="ComfyUI 工作流 JSON"
          />
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              saveComfyConfig(cfg);
              void refresh();
            }}
            disabled={!cfg.url.trim()}
            className="h-9 rounded-lg bg-[hsl(var(--accent))] px-4 text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
            data-testid="comfyui-save"
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={!cfg.url.trim()}
            className="h-9 rounded-lg border border-[hsl(var(--border-soft))] px-4 text-xs disabled:opacity-40"
          >
            测试连接
          </button>
          {msg && (
            <span className={`text-xs ${msg.ok ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--danger))]'}`} role="status">
              {msg.text}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
