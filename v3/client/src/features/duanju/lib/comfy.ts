/**
 * 本地 ComfyUI 客户端（视频 + 生图共用，浏览器直连：局域网/Tailscale/frp 地址）
 *
 * 架构：浏览器直连 ComfyUI，产物不经过云端 server；生成完成后经既有回流端点归档
 * （视频 uploadDuanjuVideo / 图片 uploadDuanjuImageFile），自动回流入镜头卡/设定图。
 *
 * 工作流约定（设置页粘贴 API 格式 workflow，提交前全文占位符替换）：
 *   视频 "<<FRAME>>"=分帧图文件名 "<<PROMPT>>"=镜头提示词
 *   生图 "<<PROMPT>>"/"<<WIDTH>>"/"<<HEIGHT>>"/"<<SEED>>"（空模板=用内置 Z-Image-Turbo 默认）
 */
import { Z_IMAGE_TURBO_DEFAULT_WORKFLOW } from './comfyDefaultWorkflow';

const CFG_KEY = 'v3-comfyui-config';

export interface ComfyuiConfig {
  /** ComfyUI 基地址（如 http://192.168.1.10:8188） */
  url: string;
  /** API 格式图生视频 workflow（占位符 <<FRAME>> / <<PROMPT>>） */
  videoWorkflow: string;
  /** API 格式文生图 workflow（占位符 <<PROMPT>>/<<WIDTH>>/<<HEIGHT>>/<<SEED>>；空 = 内置默认） */
  imageWorkflow: string;
}

/**
 * 引擎地址缺省：本机访问（localhost/127.0.0.1）且用户未配置时预填本地引擎默认地址——
 * 新浏览器/新会话开箱即用；远程访问（手机/生产站）留空并提示填局域网地址（127.0.0.1 在那些设备上指其自身，不可用）。
 */
const DEFAULT_LOCAL_URL = 'http://127.0.0.1:8188';

function defaultUrl(): string {
  try {
    return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? DEFAULT_LOCAL_URL : '';
  } catch {
    return '';
  }
}

export function loadComfyConfig(): ComfyuiConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ComfyuiConfig> & { workflow?: string };
      // 迁移：旧结构 {url, workflow} → {url, videoWorkflow, imageWorkflow}
      return {
        url: typeof parsed.url === 'string' && parsed.url ? parsed.url : defaultUrl(),
        videoWorkflow: typeof parsed.videoWorkflow === 'string' ? parsed.videoWorkflow : (parsed.workflow ?? ''),
        imageWorkflow: typeof parsed.imageWorkflow === 'string' ? parsed.imageWorkflow : '',
      };
    }
  } catch {
    /* 损坏即重置 */
  }
  return { url: defaultUrl(), videoWorkflow: '', imageWorkflow: '' };
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

/** 生图实际生效的 workflow 文本（用户自定义优先，空则内置默认） */
export function effectiveImageWorkflow(cfg: ComfyuiConfig): string {
  return cfg.imageWorkflow.trim() || Z_IMAGE_TURBO_DEFAULT_WORKFLOW;
}

export interface VideoGenProgress {
  phase: 'uploading' | 'queued' | 'generating' | 'downloading' | 'done';
  elapsedSec: number;
}

/** 网络层人话报错：引擎离线/地址错误时给可执行的指引（原始 Failed to fetch 对用户无意义） */
function netErr(err: unknown): Error {
  if (err instanceof Error && err.name === 'TimeoutError') return new Error('本地引擎响应超时——请稍重试或确认引擎负载');
  return new Error('无法连接本地引擎——请确认已启动（scripts/comfy-start.sh）且设置页地址正确');
}

/** 上传图片 → ComfyUI input 目录，返回可注入 LoadImage 的文件名（subfolder/name） */
async function uploadImage(url: string, blob: Blob, name: string): Promise<string> {
  const form = new FormData();
  form.append('image', new File([blob], name, { type: 'image/png' }));
  form.append('overwrite', 'true');
  let r: Response;
  try {
    r = await fetch(`${url.replace(/\/$/, '')}/upload/image`, { method: 'POST', body: form });
  } catch (err) {
    throw netErr(err);
  }
  if (!r.ok) throw new Error(`图片上传失败（HTTP ${r.status}）`);
  const j = (await r.json()) as { name?: string; subfolder?: string };
  if (!j.name) throw new Error('图片上传返回异常');
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

/** 占位符全文替换后解析 workflow：值统一 JSON 转义（提示词含换行/引号/控制字符均安全）；非法 JSON 带原始原因人话报错 */
function injectWorkflow(workflowText: string, placeholders: Record<string, string>): Record<string, unknown> {
  let text = workflowText;
  for (const [key, value] of Object.entries(placeholders)) {
    text = text.split(key).join(JSON.stringify(value).slice(1, -1));
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    const detail = err instanceof Error ? err.message : '';
    throw new Error(`工作流 JSON 不合法（${detail}）——自定义模板请到设置页检查占位符结构`);
  }
}

/** 从 /history outputs 任意节点提取文件条目（SaveImage/SaveVideo/VHS_VideoCombine 通吃） */
function extractOutputFile(entry: { outputs?: Record<string, Record<string, unknown[]>> }): {
  filename: string;
  subfolder: string;
  type: string;
} {
  for (const nodeOut of Object.values(entry.outputs ?? {})) {
    for (const arr of Object.values(nodeOut ?? {})) {
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (item && typeof item === 'object' && typeof (item as { filename?: unknown }).filename === 'string') {
          const o = item as { filename: string; subfolder?: unknown; type?: unknown };
          return {
            filename: o.filename,
            subfolder: typeof o.subfolder === 'string' ? o.subfolder : '',
            type: typeof o.type === 'string' ? o.type : 'output',
          };
        }
      }
    }
  }
  throw new Error('生成完成但未找到输出文件');
}

/**
 * 通用执行：注入 → 提交 → 轮询 → 下载产物 blob。
 * deadlineMs 兜底：生图 5 分钟 / 视频 20 分钟；轮询抖动静默重试。
 */
async function runWorkflow(
  base: string,
  workflowText: string,
  placeholders: Record<string, string>,
  deadlineMs: number,
  onTick?: () => void,
): Promise<Blob> {
  const workflow = injectWorkflow(workflowText, placeholders);
  const clientId = `app-${Math.random().toString(36).slice(2, 10)}`;
  let submit: Response;
  try {
    submit = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
  } catch (err) {
    throw netErr(err);
  }
  if (!submit.ok) {
    const t = await submit.text().catch(() => '');
    throw new Error(`任务提交失败（HTTP ${submit.status}）：${t.slice(0, 160)}`);
  }
  const { prompt_id: promptId } = (await submit.json()) as { prompt_id: string };
  if (!promptId) throw new Error('任务提交返回异常（无 prompt_id）');

  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    onTick?.();
    let entry: { status?: { completed?: boolean; status_str?: string }; outputs?: Record<string, Record<string, unknown[]>> };
    try {
      const r = await fetch(`${base}/history/${promptId}`, { signal: AbortSignal.timeout(10_000) });
      const j = (await r.json()) as Record<string, typeof entry>;
      entry = j?.[promptId] ?? {};
    } catch {
      continue; // 单次轮询抖动静默重试
    }
    if (entry.status?.status_str === 'error') throw new Error('ComfyUI 生成失败（详见 ComfyUI 界面日志）');
    if (entry.status?.completed || entry.status?.status_str === 'success') {
      const { filename, subfolder, type } = extractOutputFile(entry);
      const q = new URLSearchParams({ filename, subfolder, type });
      const vr = await fetch(`${base}/view?${q.toString()}`);
      if (!vr.ok) throw new Error(`产物下载失败（HTTP ${vr.status}）`);
      return await vr.blob();
    }
  }
  throw new Error('超时未完成——可在 ComfyUI 界面查看任务状态');
}

export interface ComfyVideoResult {
  blob: Blob;
  elapsedSec: number;
}

/** 视频完整流程：上传分帧图 → 注入 → 提交 → 轮询 → 下载 mp4 blob（onProgress 打印机式进度） */
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
  const frameName = await uploadImage(base, frameBlob, 'frame.png');
  onProgress({ phase: 'queued', elapsedSec: Math.round((Date.now() - t0) / 1000) });

  const blob = await runWorkflow(
    base,
    cfg.videoWorkflow,
    { '<<FRAME>>': frameName, '<<PROMPT>>': prompt },
    20 * 60 * 1000,
    tick,
  );
  onProgress({ phase: 'done', elapsedSec: Math.round((Date.now() - t0) / 1000) });
  return { blob, elapsedSec: Math.round((Date.now() - t0) / 1000) };
}

export interface ComfyImageParams {
  prompt: string;
  width: number;
  height: number;
  /** 随机 seed——重roll 出新图；固定则同提示词复现同图 */
  seed: number;
}

/** 生图完整流程：注入提示词/尺寸/seed → 提交 → 轮询 → 下载 png blob（秒级出图，5 分钟兜底） */
export async function generateImageOnComfy(cfg: ComfyuiConfig, params: ComfyImageParams): Promise<Blob> {
  const base = cfg.url.replace(/\/$/, '');
  return runWorkflow(base, effectiveImageWorkflow(cfg), {
    '<<PROMPT>>': params.prompt,
    '<<WIDTH>>': String(params.width),
    '<<HEIGHT>>': String(params.height),
    '<<SEED>>': String(params.seed),
  }, 5 * 60 * 1000);
}
