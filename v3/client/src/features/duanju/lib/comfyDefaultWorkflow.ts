/**
 * 内置默认生图工作流：Z-Image-Turbo（阿里 6B，Apache 2.0，中文提示词原生直出）
 *
 * 2026-11-10 本地实测通过（设定图横版 / 分帧竖屏 / 场景横版三种尺寸档）。
 * 占位符：<<PROMPT>> / <<WIDTH>> / <<HEIGHT>> / <<SEED>>（提交前全文替换）。
 * 模型文件名对应 Comfy-Org/Z-Image-Turbo 重打包 int8/fp8 版；用户换权重后可在设置页覆盖本模板。
 */
export const Z_IMAGE_TURBO_DEFAULT_WORKFLOW = `{
  "28": {
    "class_type": "UNETLoader",
    "inputs": { "unet_name": "z_image_turbo_int8_convrot.safetensors", "weight_dtype": "default" }
  },
  "30": {
    "class_type": "CLIPLoader",
    "inputs": { "clip_name": "qwen_3_4b_fp8_mixed.safetensors", "type": "lumina2", "device": "default" }
  },
  "29": {
    "class_type": "VAELoader",
    "inputs": { "vae_name": "ae.safetensors" }
  },
  "27": {
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "<<PROMPT>>", "clip": ["30", 0] }
  },
  "33": {
    "class_type": "ConditioningZeroOut",
    "inputs": { "conditioning": ["27", 0] }
  },
  "13": {
    "class_type": "EmptySD3LatentImage",
    "inputs": { "width": <<WIDTH>>, "height": <<HEIGHT>>, "batch_size": 1 }
  },
  "11": {
    "class_type": "ModelSamplingAuraFlow",
    "inputs": { "shift": 3, "model": ["28", 0] }
  },
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "seed": <<SEED>>, "steps": 8, "cfg": 1,
      "sampler_name": "res_multistep", "scheduler": "simple", "denoise": 1,
      "model": ["11", 0], "positive": ["27", 0], "negative": ["33", 0], "latent_image": ["13", 0]
    }
  },
  "8": {
    "class_type": "VAEDecode",
    "inputs": { "samples": ["3", 0], "vae": ["29", 0] }
  },
  "9": {
    "class_type": "SaveImage",
    "inputs": { "filename_prefix": "comfy-app/image", "images": ["8", 0] }
  }
}`;
