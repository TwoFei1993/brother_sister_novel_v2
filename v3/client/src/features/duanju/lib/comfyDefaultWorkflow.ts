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
 * 内置参考生图工作流：Qwen-Image-Edit-2511（分镜帧通道——定妆照+场景图双参考，角色与场景双一致）
 *
 * 按官方模板 image_qwen_image_edit_2511.json 连线手工构造（Lightning 4 步档）。
 * 占位符：<<PROMPT>>（分镜指令）/ <<REF>>（定妆照文件名）/ <<SCENE_REF>>（场景图文件名）/ <<SEED>>。
 * image1=定妆照（锁角色外貌），image2=场景图（锁场景环境）——TextEncodeQwenImageEditPlus 原生多参考。
 * 模型：qwen_image_edit_2511_int8_convrot（19GB 官方重打包）+ Lightning-4steps LoRA。
 */
export const QWEN_EDIT_2511_WORKFLOW = `{
  "1": {
    "class_type": "LoadImage",
    "inputs": { "image": "<<REF>>" }
  },
  "2": {
    "class_type": "LoadImage",
    "inputs": { "image": "<<SCENE_REF>>" }
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
  "1610": {
    "class_type": "FluxKontextImageScale",
    "inputs": { "image": ["2", 0] }
  },
  "151": {
    "class_type": "TextEncodeQwenImageEditPlus",
    "inputs": { "clip": ["162", 0], "vae": ["146", 0], "image1": ["160", 0], "image2": ["1610", 0], "prompt": "<<PROMPT>>" }
  },
  "149": {
    "class_type": "TextEncodeQwenImageEditPlus",
    "inputs": { "clip": ["162", 0], "vae": ["146", 0], "image1": ["160", 0], "image2": ["1610", 0], "prompt": "" }
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

/**
 * 内置默认视频工作流：HyperFlow H3 Flash i2v（MiniMax H3 开源压缩版 14B，视频+同步音轨一次出）
 *
 * 2026-11-13 本地实测通过（12GB 显存 73 帧/3s 4 分钟出片；Q4_K_M GGUF + nvfp4 文本编码器）。
 * 占位符：<<FRAME>>（首帧图）/ <<PROMPT>>（镜头动作提示词）/ <<LENGTH>>（帧数，24fps snap 17k+5，
 * 由调用方按镜头 durationSec 换算注入）。模型四件对应 HF VideoRebirthAI/hyperflow-h3-flash；
 * 设置页粘贴自定义模板即可覆盖本默认。
 */
export const HYPERFLOW_I2V_DEFAULT_WORKFLOW = `{"1":{"class_type":"HyperFlowLoader","inputs":{"unet_name":"minimax_h3_fl2va_hyperflow_flash_14b-Q4_K_M.gguf","weights_in":"auto"},"_meta":{"title":"HyperFlowLoader"}},"2":{"class_type":"CLIPLoader","inputs":{"clip_name":"qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors","type":"minimax","device":"default"},"_meta":{"title":"Text encoder (type minimax)"}},"3":{"class_type":"VAELoader","inputs":{"vae_name":"minimax_h3_video_vae_fp16.safetensors"},"_meta":{"title":"Video VAE"}},"4":{"class_type":"VAELoader","inputs":{"vae_name":"minimax_h3_audio_vae_fp32.safetensors"},"_meta":{"title":"Audio VAE"}},"5":{"class_type":"MiniMaxH3ImageToVideo","inputs":{"clip":["2",0],"vae":["3",0],"prompt":"<<PROMPT>>","width":768,"height":1344,"length":"<<LENGTH>>","first_frame":["20",0]},"_meta":{"title":"Prompt, size, length"}},"6":{"class_type":"HyperFlowSigmas","inputs":{"model":["1",0],"steps":6},"_meta":{"title":"HyperFlow Sigmas (4 / 6 / 8 steps)"}},"7":{"class_type":"KSamplerSelect","inputs":{"sampler_name":"euler"},"_meta":{"title":"Sampler (euler)"}},"8":{"class_type":"RandomNoise","inputs":{"noise_seed":"<<SEED>>"},"_meta":{"title":"Seed"}},"9":{"class_type":"BasicGuider","inputs":{"model":["1",0],"conditioning":["5",0]},"_meta":{"title":"Guider (CFG 1, no negative prompt)"}},"10":{"class_type":"SamplerCustomAdvanced","inputs":{"noise":["8",0],"guider":["9",0],"sampler":["7",0],"sigmas":["6",0],"latent_image":["5",1]},"_meta":{"title":"Sampler"}},"11":{"class_type":"VAEDecode","inputs":{"samples":["10",0],"vae":["3",0]},"_meta":{"title":"Decode video"}},"12":{"class_type":"VAEDecodeAudio","inputs":{"samples":["10",0],"vae":["4",0]},"_meta":{"title":"Decode audio"}},"13":{"class_type":"CreateVideo","inputs":{"images":["11",0],"fps":24,"audio":["12",0],"bit_depth":"auto","color_space":"sRGB","chroma_subsampling":"auto","codec":"none"},"_meta":{"title":"Video + audio, 24 fps"}},"14":{"class_type":"SaveVideo","inputs":{"video":["13",0],"filename_prefix":"hyperflow/i2v","format":"mp4","codec":"auto"},"_meta":{"title":"Save MP4 (output/hyperflow/)"}},"20":{"class_type":"LoadImage","inputs":{"image":"<<FRAME>>"},"_meta":{"title":"First frame"}}}`;
