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
import {
  Z_IMAGE_TURBO_DEFAULT_WORKFLOW,
  QWEN_EDIT_2511_WORKFLOW,
  QWEN_EDIT_2511_TRI_WORKFLOW,
  HYPERFLOW_I2V_DEFAULT_WORKFLOW,
  HYPERFLOW_T2V_DEFAULT_WORKFLOW,
  HYPERFLOW_FLF2V_DEFAULT_WORKFLOW,
  HYPERFLOW_REF2V_DEFAULT_WORKFLOW,
  SEEDVR2_UPSCALE_DEFAULT_WORKFLOW,
} from './comfyDefaultWorkflow';

const CFG_KEY = 'v3-comfyui-config';

export interface ComfyuiConfig {
  /** ComfyUI 基地址（如 http://192.168.1.10:8188） */
  url: string;
  /** API 格式图生视频 workflow（占位符 <<FRAME>> / <<PROMPT>> / <<LENGTH>>；空 = 内置 H3 默认） */
  videoWorkflow: string;
  /** API 格式文生图 workflow（占位符 <<PROMPT>>/<<WIDTH>>/<<HEIGHT>>/<<SEED>>；空 = 内置默认） */
  imageWorkflow: string;
  /** 视频画质预设（缺省 high = 1344×768 / 6 步；standard/draft 换取速度） */
  videoQuality?: VideoQualityPreset;
  /** C1：H3 提示词优化器（AICG3D 插件 /aicg3d/goohai/.../optimize）——注入 <<PROMPT>> 前先过一道六段式结构化 */
  promptOptimizer?: boolean;
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
        videoQuality: parsed.videoQuality ?? 'high',
        promptOptimizer: parsed.promptOptimizer === true,
      };
    }
  } catch {
    /* 损坏即重置 */
  }
  return { url: defaultUrl(), videoWorkflow: '', imageWorkflow: '', videoQuality: 'high', promptOptimizer: false };
}

/**
 * C1：H3 提示词优化器（AICG3D 插件，与 ComfyUI 同机）。
 * 六段式结构化 + <d>[Chinese]</d> 对白 + 首尾帧锚点声明；失败静默回退原 prompt（增益非依赖）。
 * 注意优化器自身需在插件设置里配好 LLM 通道（云端 API 或本地 GGUF）才会生效。
 */
export async function optimizePromptOnComfy(
  cfg: ComfyuiConfig,
  prompt: string,
  opts: { duration: number; task?: string } = { duration: 5 },
): Promise<string> {
  const base = cfg.url.replace(/\/$/, '');
  try {
    const r = await fetch(`${base}/aicg3d/goohai/minimax-h3/prompt-optimizer/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        task: opts.task ?? 'i2va',
        duration: opts.duration,
        request_id: `v3-${Date.now()}`,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return prompt;
    const j = (await r.json()) as { prompt?: string };
    return typeof j.prompt === 'string' && j.prompt.trim() ? j.prompt : prompt;
  } catch {
    return prompt; // 优化器不可用（未装/未配）不阻塞生成
  }
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

// ---------- 内存防线（防模型缓存累积撑爆 32G RAM / 12G VRAM） ----------

interface ComfyHeadroom {
  ramFree: number;
  vramFree: number;
}

/** 查 ComfyUI 视角空闲资源（GB）；探不到返回 null（老版本/离线不拦截） */
async function comfyHeadroom(base: string): Promise<ComfyHeadroom | null> {
  try {
    const r = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { devices?: Array<{ ram_free?: number; vram_free?: number }> };
    const d = j.devices?.[0];
    return d ? { ramFree: (d.ram_free ?? 0) / 1e9, vramFree: (d.vram_free ?? 0) / 1e9 } : null;
  } catch {
    return null;
  }
}

/** 释放 ComfyUI 已缓存的模型权重（RAM + VRAM）——POST /free */
async function freeComfyModels(base: string): Promise<boolean> {
  try {
    const r = await fetch(`${base}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * 重任务提交前的内存防线：空闲低于阈值 → 释放模型缓存再复核（返回是否满足）。
 * 背景：2511(20G)/H3(8.5G)/SeedVR2(3.7G) 权重用完驻留累积，32G RAM 叠加系统进程
 * 常态只剩 4-5G，三链连续跑会把页面文件顶爆（os error 1455 进程崩溃）——
 * 紧张时弃缓存换稳定（代价：下次生成重新加载模型，~30s-1min）。
 */
export async function ensureComfyHeadroom(
  base: string,
  need: { ramGb?: number; vramGb?: number },
): Promise<boolean> {
  const short = (h: ComfyHeadroom): boolean =>
    (need.ramGb !== undefined && h.ramFree < need.ramGb) ||
    (need.vramGb !== undefined && h.vramFree < need.vramGb);
  let h = await comfyHeadroom(base);
  if (!h || !short(h)) return true;
  await freeComfyModels(base);
  h = await comfyHeadroom(base);
  return !h || !short(h);
}

/** 生图实际生效的 workflow 文本（用户自定义优先，空则内置默认） */
export function effectiveImageWorkflow(cfg: ComfyuiConfig): string {
  return cfg.imageWorkflow.trim() || Z_IMAGE_TURBO_DEFAULT_WORKFLOW;
}

/** 视频模式（决定内置模板选择；用户自定义模板优先于全部内置） */
export type VideoWorkflowMode = 'i2v' | 't2v' | 'flf2v' | 'ref2v';

/** 视频实际生效的 workflow 文本：用户自定义优先；内置按模式选（无 extra 时 i2v） */
export function effectiveVideoWorkflow(cfg: ComfyuiConfig, mode: VideoWorkflowMode = 'i2v'): string {
  if (cfg.videoWorkflow.trim()) return cfg.videoWorkflow.trim();
  const byMode: Record<VideoWorkflowMode, string> = {
    i2v: HYPERFLOW_I2V_DEFAULT_WORKFLOW,
    t2v: HYPERFLOW_T2V_DEFAULT_WORKFLOW,
    flf2v: HYPERFLOW_FLF2V_DEFAULT_WORKFLOW,
    ref2v: HYPERFLOW_REF2V_DEFAULT_WORKFLOW,
  };
  return byMode[mode];
}

/** 镜头秒数 → 生成帧数（24fps，snap 到模型 17k+5 帧网格；官方表达式为 Python % 语义，JS 需补正负数取模） */
export function framesForDuration(sec: number): number {
  const raw = Math.max(5, Math.round(sec * 24));
  return raw + ((((5 - (raw % 17)) % 17) + 17) % 17);
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

/** 上传图片 → ComfyUI input 目录，返回可注入 LoadImage 的文件名（subfolder/name）。
 *  文件名统一加随机后缀（P1 修复）：固定名 + overwrite=true 在并发任务（批量分帧/双镜头生视频）下
 *  会互相覆盖——A 提交 workflow 时 LoadImage 读到的是 B 刚覆盖的参考图。 */
async function uploadImage(url: string, blob: Blob, name: string, type = 'image/png'): Promise<string> {
  const dot = name.lastIndexOf('.');
  const unique = dot > 0
    ? `${name.slice(0, dot)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${name.slice(dot)}`
    : `${name}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const form = new FormData();
  form.append('image', new File([blob], unique, { type }));
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

// ---------- 视频画质预设（默认高；用户在设置页切换） ----------

export type VideoQualityPreset = 'high' | 'standard' | 'draft';

/** 预设 → 尺寸/步数覆盖（未匹配字段保持模板原值 = 默认高规格） */
export const VIDEO_QUALITY_PRESETS: Record<VideoQualityPreset, { width: number; height: number; steps: number }> = {
  high: { width: 768, height: 1344, steps: 6 }, // 竖屏默认（与分镜帧同尺寸零缩放；官方推荐 6 步）
  standard: { width: 640, height: 1152, steps: 4 },
  draft: { width: 512, height: 896, steps: 4 }, // 抽卡预演（低分辨率快验）
};

/** 画质覆盖（纯函数可测）：找 H3 生成节点改 width/height、Sigmas 节点改 steps */
export function applyVideoQuality(wf: Record<string, unknown>, preset: VideoQualityPreset): void {
  const q = VIDEO_QUALITY_PRESETS[preset] ?? VIDEO_QUALITY_PRESETS.high;
  for (const node of Object.values(wf)) {
    const cls = (node as { class_type?: string }).class_type ?? '';
    const inputs = (node as { inputs?: Record<string, unknown> }).inputs;
    if (!inputs) continue;
    if (cls.startsWith('MiniMaxH3')) {
      if (typeof inputs.width === 'number') inputs.width = q.width;
      if (typeof inputs.height === 'number') inputs.height = q.height;
    }
    if (cls === 'HyperFlowSigmas' && typeof inputs.steps === 'number') inputs.steps = q.steps;
  }
}

/**
 * 对白镜头步数下限（P0 音频回血）：H3 低步数下音频是第一牺牲品（社区实测 6 步以下明显降级，
 * 8 步稳）——prompt 含 <d> 台词标签时把 HyperFlowSigmas 步数提到至少 8；纯环境音镜头维持画质档提速。
 */
export function ensureDialogSteps(wf: Record<string, unknown>, minSteps = 8): void {
  for (const node of Object.values(wf)) {
    const n = node as { class_type?: string; inputs?: Record<string, unknown> };
    if (n.class_type === 'HyperFlowSigmas' && typeof n.inputs?.steps === 'number' && (n.inputs.steps as number) < minSteps) {
      (n.inputs.steps as number) = minSteps;
    }
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
 * 提交 workflow（阶段一）：注入 → 数值覆盖 → POST /prompt → promptId。
 * 与轮询拆分的原因：手机长任务跨页面生命周期——prompt_id 持久化后可恢复轮询。
 */
async function submitWorkflow(
  base: string,
  workflowText: string,
  placeholders: Record<string, string>,
  valuePatch?: (wf: Record<string, unknown>) => void,
): Promise<string> {
  const workflow = injectWorkflow(workflowText, placeholders);
  valuePatch?.(workflow);
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
  return promptId;
}

/** 轮询 workflow（阶段二）：至完成并下载产物 blob；deadlineMs 从调用时点起算 */
async function pollWorkflow(
  base: string,
  promptId: string,
  deadlineMs: number,
  onTick?: () => void,
): Promise<Blob> {
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

/**
 * 通用执行：注入 → 提交 → 轮询 → 下载产物 blob。
 * deadlineMs 兜底：生图 5 分钟 / 视频 20 分钟；轮询抖动静默重试。
 * valuePatch：占位符替换解析后、提交前的数值级覆盖（如画质预设改 width/height/steps）。
 */
async function runWorkflow(
  base: string,
  workflowText: string,
  placeholders: Record<string, string>,
  deadlineMs: number,
  onTick?: () => void,
  valuePatch?: (wf: Record<string, unknown>) => void,
): Promise<Blob> {
  const promptId = await submitWorkflow(base, workflowText, placeholders, valuePatch);
  return pollWorkflow(base, promptId, deadlineMs, onTick);
}

export interface ComfyVideoResult {
  blob: Blob;
  elapsedSec: number;
}

/** 视频生成的额外图输入（决定内置模板：refBlobs→ref2v；lastFrameBlob→flf2v；否则 i2v/t2v） */
export interface VideoExtraInputs {
  /** 尾帧图（flf2v：首尾帧控制） */
  lastFrameBlob?: Blob;
  /** 参考图 1-2 张（ref2v：角色定妆照） */
  refBlobs?: Blob[];
}

/** 已提交的视频任务句柄（持久化到 localStorage 后可跨页面生命周期恢复轮询） */
export interface SubmittedVideoTask {
  base: string;
  promptId: string;
  startedAt: number;
}

/** 视频任务阶段一：上传图 → 注入 → 提交 → 返回任务句柄（执行在 ComfyUI 侧，手机切出/锁屏不影响） */
export async function submitVideoOnComfy(
  cfg: ComfyuiConfig,
  frameBlob: Blob | null,
  prompt: string,
  /** 镜头时长秒（缺省 5s）——换算为帧数注入 <<LENGTH>> */
  durationSec?: number,
  extra?: VideoExtraInputs,
): Promise<SubmittedVideoTask> {
  const base = cfg.url.replace(/\/$/, '');
  // 内存防线：H3 GGUF 8.5G 权重流式加载——RAM 紧张先释放模型缓存（防三链叠加撑爆）
  await ensureComfyHeadroom(base, { ramGb: 10 });
  const placeholders: Record<string, string> = {
    '<<PROMPT>>': prompt,
    '<<LENGTH>>': String(framesForDuration(durationSec ?? 5)),
    '<<SEED>>': String(Math.floor(Math.random() * 2_147_483_647)),
  };
  if (frameBlob) {
    placeholders['<<FRAME>>'] = await uploadImage(base, frameBlob, 'frame.png');
  }
  if (extra?.lastFrameBlob) {
    placeholders['<<LAST_FRAME>>'] = await uploadImage(base, extra.lastFrameBlob, 'last_frame.png');
  }
  if (extra?.refBlobs) {
    for (let i = 0; i < Math.min(extra.refBlobs.length, 2); i += 1) {
      placeholders[`<<REF${i + 1}>>`] = await uploadImage(base, extra.refBlobs[i]!, `ref${i + 1}.png`);
    }
  }
  const mode: VideoWorkflowMode = extra?.refBlobs?.length
    ? 'ref2v'
    : extra?.lastFrameBlob
      ? 'flf2v'
      : frameBlob
        ? 'i2v'
        : 't2v';
  const promptId = await submitWorkflow(base, effectiveVideoWorkflow(cfg, mode), placeholders, (wf) => {
    applyVideoQuality(wf, cfg.videoQuality ?? 'high');
    if (prompt.includes('<d>')) ensureDialogSteps(wf); // 对白镜头步数≥8（音频质量；试跑验口型也需要）
  });
  return { base, promptId, startedAt: Date.now() };
}

/** 视频任务阶段二：轮询至完成并下载 mp4 blob（恢复轮询安全——history 幂等，超时从恢复时点起算 20 分钟） */
export async function pollVideoOnComfy(
  task: SubmittedVideoTask,
  onProgress: (p: VideoGenProgress) => void,
): Promise<ComfyVideoResult> {
  const t0 = task.startedAt;
  onProgress({ phase: 'generating', elapsedSec: Math.round((Date.now() - t0) / 1000) });
  const tick = () => onProgress({ phase: 'generating', elapsedSec: Math.round((Date.now() - t0) / 1000) });
  const blob = await pollWorkflow(task.base, task.promptId, 20 * 60 * 1000, tick);
  onProgress({ phase: 'done', elapsedSec: Math.round((Date.now() - t0) / 1000) });
  return { blob, elapsedSec: Math.round((Date.now() - t0) / 1000) };
}

/** 视频完整流程（组合版）：提交 + 轮询。手机端建议改用 submit/poll 拆分版 + localStorage 持久化 */
export async function generateVideoOnComfy(
  cfg: ComfyuiConfig,
  frameBlob: Blob | null,
  prompt: string,
  onProgress: (p: VideoGenProgress) => void,
  durationSec?: number,
  extra?: VideoExtraInputs,
): Promise<ComfyVideoResult> {
  const task = await submitVideoOnComfy(cfg, frameBlob, prompt, durationSec, extra);
  return pollVideoOnComfy(task, onProgress);
}

export interface ComfyUpscaleResult {
  blob: Blob;
  elapsedSec: number;
}

/**
 * 视频超分完整流程：上传 mp4 → SeedVR2（短边 → resolution，保比例，音轨透传）→ 下载 mp4 blob。
 * 典型：H3 出片 768×1344 → 1080×1890（约 41 秒处理 10 秒片，12GB 显存档参数内置）。
 */
export async function upscaleVideoOnComfy(
  cfg: ComfyuiConfig,
  videoBlob: Blob,
  onProgress: (p: VideoGenProgress) => void,
  resolution = 1080,
): Promise<ComfyUpscaleResult> {
  const base = cfg.url.replace(/\/$/, '');
  const t0 = Date.now();
  const tick = () => onProgress({ phase: 'generating', elapsedSec: Math.round((Date.now() - t0) / 1000) });

  // 内存防线：SeedVR2 DiT(3.2G)+VAE+tiled 解码峰值——刚跑完 H3（8.5G 驻留）时必触发释放
  await ensureComfyHeadroom(base, { vramGb: 5, ramGb: 6 });
  onProgress({ phase: 'uploading', elapsedSec: 0 });
  const videoName = await uploadImage(base, videoBlob, 'to-upscale.mp4', 'video/mp4');
  onProgress({ phase: 'queued', elapsedSec: Math.round((Date.now() - t0) / 1000) });

  const blob = await runWorkflow(
    base,
    SEEDVR2_UPSCALE_DEFAULT_WORKFLOW,
    { '<<VIDEO>>': videoName, '<<RESOLUTION>>': String(resolution) },
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
  /** 参考图 blob（分镜参考生图通道）：上传 ComfyUI 后注入 <<REF>>；传值时走 Qwen-Edit-2511 workflow */
  refBlob?: Blob;
  /** 正面全身单图 blob（可选，三参考档）：注入 <<BODY_REF>>（image2）——身体/服装与定妆照一致；传入即用三参考模板 */
  bodyRefBlob?: Blob;
  /** 场景图 blob（可选，分镜参考通道）：注入 <<SCENE_REF>>——与定妆照双重锁定，跨帧场景一致（双参考档 image2 / 三参考档 image3） */
  sceneRefBlob?: Blob;
  /** 指定 workflow（默认 Z-Image-Turbo；'qwen-edit-2511' = 分镜参考通道） */
  workflow?: 'qwen-edit-2511';
}

/** 生图完整流程：注入提示词/尺寸/seed → 提交 → 轮询 → 下载 png blob（秒级出图，5 分钟兜底；参考通道 15 分钟） */
export async function generateImageOnComfy(cfg: ComfyuiConfig, params: ComfyImageParams): Promise<Blob> {
  const base = cfg.url.replace(/\/$/, '');
  if (params.workflow === 'qwen-edit-2511') {
    if (!params.refBlob) throw new Error('参考生图缺少定妆照（refBlob）');
    // 内存防线：2511 int8 权重 20G 流式分页——RAM 余量不足先释放（分镜批量重roll 时高频触发）
    await ensureComfyHeadroom(base, { ramGb: 12 });
    const refName = await uploadImage(base, params.refBlob, 'ref.png');
    const placeholders: Record<string, string> = {
      '<<PROMPT>>': params.prompt,
      '<<REF>>': refName,
      '<<SEED>>': String(params.seed),
    };
    if (params.bodyRefBlob) {
      placeholders['<<BODY_REF>>'] = await uploadImage(base, params.bodyRefBlob, 'body-ref.png');
    }
    if (params.sceneRefBlob) {
      placeholders['<<SCENE_REF>>'] = await uploadImage(base, params.sceneRefBlob, 'scene-ref.png');
    }
    // 有正面全身 → 三参考模板（脸+身体+场景）；存量角色无正面图回退双参考
    return runWorkflow(
      base,
      params.bodyRefBlob ? QWEN_EDIT_2511_TRI_WORKFLOW : QWEN_EDIT_2511_WORKFLOW,
      placeholders,
      15 * 60 * 1000,
    );
  }
  return runWorkflow(base, effectiveImageWorkflow(cfg), {
    '<<PROMPT>>': params.prompt,
    '<<WIDTH>>': String(params.width),
    '<<HEIGHT>>': String(params.height),
    '<<SEED>>': String(params.seed),
  }, 5 * 60 * 1000);
}
