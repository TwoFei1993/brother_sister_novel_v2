/**
 * 本地 ComfyUI 视频生成客户端（第四通道：本地交付，零 API 成本）
 *
 * 架构：浏览器直连 ComfyUI（局域网/Tailscale/frp 穿透地址），视频不经过云端 server；
 * 生成完成后经既有 uploadDuanjuVideo 归档（自动回流入镜头卡）。
 *
 * 工作流约定（设置页粘贴 API 格式 workflow，占位符注入）：
 *   "<<FRAME>>"  → 图片节点的 image 值（上传分帧图后的 ComfyUI 文件名）
 *   "<<PROMPT>>" → 文本节点的 text 值（镜头视频提示词）
 */

const CFG_KEY = 'v3-comfyui-config';

export interface ComfyuiConfig {
  /** ComfyUI 基地址（如 http://192.168.1.10:8188） */
  url: string;
  /** API 格式 workflow JSON（占位符 <<FRAME>> / <<PROMPT>>） */
  workflow: string;
}

export function loadComfyConfig(): ComfyuiConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) return JSON.parse(raw) as ComfyuiConfig;
  } catch {
    /* 损坏即重置 */
  }
  return { url: '', workflow: '' };
}

export function saveComfyConfig(cfg: ComfyuiConfig): void {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

/** 探活：GET /system_stats（2 秒超时） */
export async function pingComfy(url: string): Promise<{ ok: boolean; detail?: string }> {
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/system_stats`, { signal: AbortSignal.timeout(2000) });
    return { ok: r.ok };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : '网络错误' };
  }
}

export interface VideoGenProgress {
  phase: 'uploading' | 'queued' | 'generating' | 'downloading' | 'done';
  elapsedSec: number;
}

/** 上传分帧图 → ComfyUI，返回 {image文件名} */
async function uploadFrame(url: string, frameBlob: Blob): Promise<string> {
  const form = new FormData();
  form.append('image', new File([frameBlob], `frame.png`, { type: 'image/png' }));
  form.append('overwrite', 'true');
  const r = await fetch(`${url.replace(/\/$/, '')}/upload/image`, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`分帧图上传失败（HTTP ${r.status}）`);
  const j = (await r.json()) as { name?: string; subfolder?: string };
  if (!j.name) throw new Error('分帧图上传返回异常');
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

export interface ComfyVideoResult {
  blob: Blob;
  elapsedSec: number;
}

/**
 * 完整流程：上传帧图 → 注入 workflow → 提交 → 轮询 → 下载 mp4 blob。
 * onProgress 实时回报阶段与已等待秒数（打印机式进度）。
 */
export async function generateVideoOnComfy(
  cfg: ComfyuiConfig,
  frameBlob: Blob,
  prompt: string,
  onProgress: (p: VideoGenProgress) => void,
): Promise<ComfyVideoResult> {
  const base = cfg.url.replace(/\/$/, '');
  const t0 = Date.now();
  const tick = () => onProgress({ phase: 'generating', elapsedSec: Math.round((Date.now() - t0) / 1000) });

  onProgress({ phase: 'uploading', elapsedSec: 0 });
  const frameName = await uploadFrame(base, frameBlob);

  // 占位注入：<<FRAME>> 图片名 / <<PROMPT>> 提示词（全文替换，适配任何工作流结构）
  let workflowText = cfg.workflow
    .split('<<FRAME>>').join(frameName)
    .split('<<PROMPT>>').join(prompt);
  let workflow: Record<string, unknown>;
  try {
    workflow = JSON.parse(workflowText) as Record<string, unknown>;
  } catch {
    throw new Error('工作流 JSON 不合法——请到设置页重新粘贴 ComfyUI 导出的 API workflow');
  }

  const clientId = `app-${Math.random().toString(36).slice(2, 10)}`;
  const submit = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!submit.ok) {
    const t = await submit.text().catch(() => '');
    throw new Error(`任务提交失败（HTTP ${submit.status}）：${t.slice(0, 160)}`);
  }
  const { prompt_id: promptId } = (await submit.json()) as { prompt_id: string };
  if (!promptId) throw new Error('任务提交返回异常（无 prompt_id）');

  onProgress({ phase: 'queued', elapsedSec: Math.round((Date.now() - t0) / 1000) });

  // 轮询：generating 心跳回报；完成/失败终态；20 分钟兜底
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    tick();
    let hist: Record<string, { status?: { completed?: boolean; status_str?: string }; outputs?: Record<string, Record<string, unknown[]>> }>;
    try {
      const r = await fetch(`${base}/history/${promptId}`, { signal: AbortSignal.timeout(10_000) });
      const j = (await r.json()) as typeof hist;
      hist = j?.[promptId] ? j : {};
    } catch {
      continue; // 单次轮询抖动静默重试
    }
    const entry = hist[promptId];
    if (!entry) continue;
    const statusStr = entry.status?.status_str ?? '';
    if (statusStr === 'error') throw new Error('ComfyUI 生成失败（详见 ComfyUI 界面日志）');
    if (entry.status?.completed || statusStr === 'success') {
      // 提取输出：outputs 任意节点里含 filename 的媒体条目（SaveVideo/VHS_VideoCombine/SaveImage 通吃）
      const outputs = entry.outputs ?? {};
      let filename = '';
      let subfolder = '';
      let type = 'output';
      for (const nodeOut of Object.values(outputs)) {
        for (const arr of Object.values(nodeOut ?? {})) {
          if (!Array.isArray(arr)) continue;
          for (const item of arr) {
            if (item && typeof item === 'object' && typeof (item as { filename?: unknown }).filename === 'string') {
              filename = (item as { filename: string }).filename;
              subfolder = typeof (item as { subfolder?: unknown }).subfolder === 'string' ? (item as { subfolder: string }).subfolder : '';
              type = typeof (item as { type?: unknown }).type === 'string' ? (item as { type: string }).type : 'output';
            }
          }
        }
      }
      if (!filename) throw new Error('生成完成但未找到输出文件');
      onProgress({ phase: 'downloading', elapsedSec: Math.round((Date.now() - t0) / 1000) });
      const q = new URLSearchParams({ filename, subfolder, type });
      const vr = await fetch(`${base}/view?${q.toString()}`);
      if (!vr.ok) throw new Error(`视频下载失败（HTTP ${vr.status}）`);
      const blob = await vr.blob();
      onProgress({ phase: 'done', elapsedSec: Math.round((Date.now() - t0) / 1000) });
      return { blob, elapsedSec: Math.round((Date.now() - t0) / 1000) };
    }
  }
  throw new Error('超时（20 分钟未完成）——可在 ComfyUI 界面查看任务状态');
}
