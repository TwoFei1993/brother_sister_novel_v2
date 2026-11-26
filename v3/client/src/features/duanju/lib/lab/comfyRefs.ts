/**
 * 试验台本地出图（M2）：提交与轮询拆成两段——提交成功即拿到引擎任务号，
 * 页面重载 / 切走再回来后凭它续轮询（执行在引擎侧，不受页面生命周期影响）。
 *
 * - 没有参考图：走设置页生效的文生图模板（与正式出图同一份）。
 * - 有参考图：走本文件的 H3-Image 参考模板（conditioning 连 image_1..N，N ≤ 3；顺序即 Picture 序号）。
 *   采样器用 euler：依据 2026-11-24 四轮受控实验定稿（官方规定 euler + simple + 6 步 + CFG 1）。
 */
import {
  effectiveImageWorkflow,
  ensureComfyHeadroom,
  pollWorkflow,
  submitWorkflow,
  uploadImage,
  type ComfyuiConfig,
} from '../comfy';

/** H3-Image 参考图槽数（模板里放满，提交前按实际张数裁掉多余的） */
export const LAB_REF_SLOTS = 3;

/** H3-Image 参考生图模板（试验台专用）。占位符：<<PROMPT>> <<WIDTH>> <<HEIGHT>> <<SEED>> <<REF1>>..<<REF3>> */
export const LAB_REF_WORKFLOW = `{
  "r1": { "class_type": "LoadImage", "inputs": { "image": "<<REF1>>" } },
  "r2": { "class_type": "LoadImage", "inputs": { "image": "<<REF2>>" } },
  "r3": { "class_type": "LoadImage", "inputs": { "image": "<<REF3>>" } },
  "1": {
    "class_type": "UNETLoader",
    "inputs": { "unet_name": "minimax_h3_image_pruned_int8_convrot.safetensors", "weight_dtype": "default" }
  },
  "2": {
    "class_type": "CLIPLoader",
    "inputs": { "clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "type": "minimax", "device": "default" }
  },
  "3": { "class_type": "VAELoader", "inputs": { "vae_name": "minimax_h3_image_vae_fp16.safetensors" } },
  "30": {
    "class_type": "MiniMaxH3ImageConditioning",
    "inputs": {
      "clip": ["2", 0], "vae": ["3", 0], "prompt": "<<PROMPT>>", "width": <<WIDTH>>, "height": <<HEIGHT>>,
      "images.image_1": ["r1", 0], "images.image_2": ["r2", 0], "images.image_3": ["r3", 0]
    }
  },
  "31": { "class_type": "ConditioningZeroOut", "inputs": { "conditioning": ["30", 0] } },
  "35": { "class_type": "RandomNoise", "inputs": { "noise_seed": <<SEED>> } },
  "36": { "class_type": "CFGGuider", "inputs": { "model": ["1", 0], "positive": ["30", 0], "negative": ["31", 0], "cfg": 1 } },
  "37": { "class_type": "BasicScheduler", "inputs": { "model": ["1", 0], "scheduler": "simple", "steps": 6, "denoise": 1 } },
  "38": { "class_type": "KSamplerSelect", "inputs": { "sampler_name": "euler" } },
  "39": {
    "class_type": "SamplerCustomAdvanced",
    "inputs": {
      "noise": ["35", 0], "guider": ["36", 0], "sampler": ["38", 0],
      "sigmas": ["37", 0], "latent_image": ["30", 1]
    }
  },
  "33": {
    "class_type": "VAEDecodeTiled",
    "inputs": { "samples": ["39", 0], "vae": ["3", 0], "tile_size": 768, "overlap": 64, "temporal_size": 64, "temporal_overlap": 8 }
  },
  "34": { "class_type": "SaveImage", "inputs": { "filename_prefix": "comfy-app/lab-ref", "images": ["33", 0] } }
}`;

export interface SubmittedLabTask {
  base: string;
  promptId: string;
}

export interface LabComfyParams {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  /** 参考图字节（按 Picture 序号；最多 3 张） */
  refBlobs: ReadonlyArray<{ blob: Blob; ext: 'png' | 'jpg' }>;
}

/** 裁掉没用到的参考槽（ComfyUI 校验图里所有节点：LoadImage 的 image 为空会被拒） */
export function trimRefSlots(wf: Record<string, unknown>, count: number): void {
  const cond = (wf['30'] as { inputs: Record<string, unknown> }).inputs;
  for (let i = count + 1; i <= LAB_REF_SLOTS; i += 1) {
    delete wf[`r${i}`];
    delete cond[`images.image_${i}`];
  }
}

/** 阶段一：（有参考图则先送引擎）→ 提交 → 任务句柄 */
export async function submitLabComfy(cfg: ComfyuiConfig, params: LabComfyParams): Promise<SubmittedLabTask> {
  const base = cfg.url.replace(/\/$/, '');
  // 内存防线（同分镜参考通道）：H3 int8 主模型 + 编码器流式换页，RAM 紧张先释放引擎缓存
  await ensureComfyHeadroom(base, { ramGb: 16 });
  const placeholders: Record<string, string> = {
    '<<PROMPT>>': params.prompt,
    '<<WIDTH>>': String(params.width),
    '<<HEIGHT>>': String(params.height),
    '<<SEED>>': String(params.seed),
  };
  const count = Math.min(params.refBlobs.length, LAB_REF_SLOTS);
  if (count === 0) {
    const promptId = await submitWorkflow(base, effectiveImageWorkflow(cfg), placeholders);
    return { base, promptId };
  }
  for (let i = 0; i < count; i += 1) {
    const ref = params.refBlobs[i]!;
    placeholders[`<<REF${i + 1}>>`] = await uploadImage(
      base,
      ref.blob,
      `lab-ref-${i + 1}.${ref.ext}`,
      ref.ext === 'jpg' ? 'image/jpeg' : 'image/png',
    );
  }
  // H3 的参考图按「Picture n」序号引用（提示词里手写的「图1」注入前改写，与分镜参考通道一致）
  placeholders['<<PROMPT>>'] = params.prompt.replace(/图([0-9]+)/g, 'Picture $1');
  const promptId = await submitWorkflow(base, LAB_REF_WORKFLOW, placeholders, (wf) => trimRefSlots(wf, count));
  return { base, promptId };
}

/** 阶段二：轮询至完成并下载产物（恢复轮询安全——history 幂等，超时从调用时点起算 15 分钟） */
export async function pollLabComfy(task: SubmittedLabTask): Promise<Blob> {
  return pollWorkflow(task.base, task.promptId, 15 * 60 * 1000);
}

/**
 * 「等太久」而不是「任务丢了」：引擎里的任务多半还在跑（手机切后台时定时器被冻住、墙上时钟照走，回来就超时了）。
 * 这种失败要保留检查点——下次回到这个分区再续一次，引擎出完了就能直接归档。
 */
export const POLL_TIMEOUT_MESSAGE = '等了很久引擎还没出完——它那边可能还在跑。回到这个分区会自动接着等，稍后再来看看';

export function isPollTimeout(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'POLL_TIMEOUT';
}
