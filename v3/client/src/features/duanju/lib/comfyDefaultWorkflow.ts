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

/**
 * 内置参考生图工作流：Qwen-Image-Edit-2511（分镜帧通道——定妆照做参考，跨帧角色一致）
 *
 * 按官方模板 image_qwen_image_edit_2511.json 连线手工构造（Lightning 4 步档）。
 * 占位符：<<PROMPT>>（分镜指令）/ <<REF>>（上传后的参考图文件名）/ <<SEED>>。
 * 分镜指令只写场景/动作/景别——外貌交给参考图（社区共识，勿在 prompt 描述脸）。
 * 模型：qwen_image_edit_2511_int8_convrot（19GB 官方重打包）+ Lightning-4steps LoRA。
 */
export const QWEN_EDIT_2511_WORKFLOW = `{
  "1": {
    "class_type": "LoadImage",
    "inputs": { "image": "<<REF>>" }
  },
  "161": {
    "class_type": "UNETLoader",
    "inputs": { "unet_name": "qwen_image_edit_2511_int8_convrot.safetensors", "weight_dtype": "default" }
  },
  "145": {
    "class_type": "ModelSamplingAuraFlow",
    "inputs": { "shift": 3.1, "model": ["161", 0] }
  },
  "153": {
    "class_type": "LoraLoaderModelOnly",
    "inputs": { "lora_name": "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", "strength_model": 1, "model": ["145", 0] }
  },
  "152": {
    "class_type": "CFGNorm",
    "inputs": { "strength": 1, "disable": false, "model": ["153", 0] }
  },
  "162": {
    "class_type": "CLIPLoader",
    "inputs": { "clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors", "type": "qwen_image", "device": "default" }
  },
  "146": {
    "class_type": "VAELoader",
    "inputs": { "vae_name": "qwen_image_vae.safetensors" }
  },
  "160": {
    "class_type": "FluxKontextImageScale",
    "inputs": { "image": ["1", 0] }
  },
  "151": {
    "class_type": "TextEncodeQwenImageEditPlus",
    "inputs": { "clip": ["162", 0], "vae": ["146", 0], "image1": ["160", 0], "prompt": "<<PROMPT>>" }
  },
  "149": {
    "class_type": "TextEncodeQwenImageEditPlus",
    "inputs": { "clip": ["162", 0], "vae": ["146", 0], "image1": ["160", 0], "prompt": "" }
  },
  "156": {
    "class_type": "VAEEncode",
    "inputs": { "pixels": ["160", 0], "vae": ["146", 0] }
  },
  "169": {
    "class_type": "KSampler",
    "inputs": {
      "seed": <<SEED>>, "steps": 4, "cfg": 1,
      "sampler_name": "euler", "scheduler": "simple", "denoise": 1,
      "model": ["152", 0], "positive": ["151", 0], "negative": ["149", 0], "latent_image": ["156", 0]
    }
  },
  "158": {
    "class_type": "VAEDecode",
    "inputs": { "samples": ["169", 0], "vae": ["146", 0] }
  },
  "9": {
    "class_type": "SaveImage",
    "inputs": { "filename_prefix": "comfy-app/frame-ref", "images": ["158", 0] }
  }
}`;
