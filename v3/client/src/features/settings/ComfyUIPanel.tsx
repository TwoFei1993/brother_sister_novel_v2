/**
 * 本地引擎面板（frontend-design 精修标准）：ComfyUI 地址 + 视频/生图工作流 + 探活
 *
 * 生图工作流留空即用内置 Z-Image-Turbo 默认模板（零配置出图）；配置存 localStorage（非敏感）。
 */
import { useCallback, useEffect, useState } from 'react';

import { effectiveImageWorkflow, loadComfyConfig, pingComfy, saveComfyConfig } from '../../features/duanju/lib/comfy';

const WF_PLACEHOLDER = `在 ComfyUI 界面：Settings → 启用开发者模式 →
打开你的 H3 图生视频工作流 → Export (API) 导出 JSON →
把其中图片节点的 image 值改为 "<<FRAME>>"、
正向提示词节点的 text 改为 "<<PROMPT>>" → 粘贴到这里`;

const IMG_WF_PLACEHOLDER = `留空 = 使用内置 Z-Image-Turbo 默认模板（已实测，推荐）。
自定义：ComfyUI 打开生图工作流 → Export (API) 导出 JSON →
提示词节点 text 改为 "<<PROMPT>>"、尺寸节点改 "<<WIDTH>>"/"<<HEIGHT>>"、
采样 seed 改 "<<SEED>>" → 粘贴到这里`;

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
      <h3 className="mb-1 text-sm font-semibold">🎬 本地引擎（ComfyUI · 生图 + 视频）</h3>
      <p className="mb-3 text-xs leading-5 text-[hsl(var(--fg-muted))]">
        生图通道「本地 ComfyUI」与镜头卡「本地生成视频」的执行引擎：免费、数据不出家门。
        引擎离线时生图自动降级回云端（把生图通道切到 Seedream 等即可）。
        启动：项目 scripts 目录 bash scripts/comfy-start.sh。
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
            生图工作流（API 格式，占位符 {'<<PROMPT>>'} / {'<<WIDTH>>'} / {'<<HEIGHT>>'} / {'<<SEED>>'}）
          </span>
          <textarea
            value={cfg.imageWorkflow}
            onChange={(e) => setCfg({ ...cfg, imageWorkflow: e.target.value })}
            rows={4}
            placeholder={IMG_WF_PLACEHOLDER}
            className={`${inputCls} leading-5`}
            aria-label="ComfyUI 生图工作流 JSON"
          />
          {!cfg.imageWorkflow.trim() && (
            <span className="mt-1 block text-[10px] text-[hsl(var(--accent))]">
              ✅ 当前使用内置 Z-Image-Turbo 默认模板（{effectiveImageWorkflow(cfg).length} 字符，已实测）
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-[hsl(var(--fg-muted))]">
            H3 图生视频工作流（API 格式，占位符 {'<<FRAME>>'} / {'<<PROMPT>>'}）
          </span>
          <textarea
            value={cfg.videoWorkflow}
            onChange={(e) => setCfg({ ...cfg, videoWorkflow: e.target.value })}
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
