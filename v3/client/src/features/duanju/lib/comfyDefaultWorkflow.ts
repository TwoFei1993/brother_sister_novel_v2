/**
 * 内置默认生图工作流：MiniMax-H3-Image（33B DiT，文生图+参考编辑二合一，官方 6 步蒸馏）
 *
 * 2026-11-18 本地实测通过（768×1344 分镜帧 1.5-8 分钟；定妆照 704×1024 91 秒；三人四参考帧场景/脸全锁定）。
 * 占位符：<<PROMPT>> / <<WIDTH>> / <<HEIGHT>> / <<SEED>>（提交前全文替换；宽高需 32 的倍数）。
 * 权重：Comfy-Org/MiniMax-H3-Image int8_convrot 主模型 + qwen3vl_32b nvfp4_awq 编码器（与视频链共用）。
 * conditioning 节点自带 10 个参考图槽（images.image_1..10，本模板文生图不连图）；latents 由其第 2 输出直接给出。
 * 官方调优面积 2048×2048（约 4.2MP）；12GB 显存 + 32GB 内存机器上限约 2MP（4MP 换页风暴实测不可行）。
 */
export const MINIMAX_H3_IMAGE_T2I_WORKFLOW = `{
  "1": {
    "class_type": "UNETLoader",
    "inputs": { "unet_name": "minimax_h3_image_pruned_int8_convrot.safetensors", "weight_dtype": "default" }
  },
  "2": {
    "class_type": "CLIPLoader",
    "inputs": { "clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "type": "minimax", "device": "default" }
  },
  "3": {
    "class_type": "VAELoader",
    "inputs": { "vae_name": "minimax_h3_image_vae_fp16.safetensors" }
  },
  "30": {
    "class_type": "MiniMaxH3ImageConditioning",
    "inputs": { "clip": ["2", 0], "vae": ["3", 0], "prompt": "<<PROMPT>>", "width": <<WIDTH>>, "height": <<HEIGHT>> }
  },
  "31": {
    "class_type": "ConditioningZeroOut",
    "inputs": { "conditioning": ["30", 0] }
  },
  "35": {
    "class_type": "RandomNoise",
    "inputs": { "noise_seed": <<SEED>> }
  },
  "36": {
    "class_type": "CFGGuider",
    "inputs": { "model": ["1", 0], "positive": ["30", 0], "negative": ["31", 0], "cfg": 1 }
  },
  "37": {
    "class_type": "BasicScheduler",
    "inputs": { "model": ["1", 0], "scheduler": "simple", "steps": 6, "denoise": 1 }
  },
  "38": {
    "class_type": "SamplerLCM",
    "inputs": { "s_noise": 1.1, "s_noise_end": 0.9, "noise_clip_std": 0 }
  },
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
  "34": {
    "class_type": "SaveImage",
    "inputs": { "filename_prefix": "comfy-app/image", "images": ["33", 0] }
  }
}`;

/**
 * 内置参考生图工作流：MiniMax-H3-Image 编辑（分镜帧通道——定妆照+场景图双参考，角色与场景双一致）
 *
 * 2026-11-18 本地实测通过（同提示词/同种子对比 2511：站位视线服从度、胡须一致性、特效形态全面占优）。
 * 占位符：<<PROMPT>>（分镜指令）/ <<REF>>（定妆照文件名）/ <<SCENE_REF>>（场景图文件名）/ <<SEED>>。
 * image_1=定妆照（锁角色外貌），image_2=场景图（锁场景环境）——conditioning 节点最多 10 槽，此处用 2。
 * 尺寸固定 768×1344（与 2511 时代分镜帧一致）；提示词里的「图1/图2」引用由 comfy.ts 注入前改写为 Picture 1/2。
 */
export const MINIMAX_H3_IMAGE_EDIT_WORKFLOW = `{
  "1": {
    "class_type": "LoadImage",
    "inputs": { "image": "<<REF>>" }
  },
  "2": {
    "class_type": "LoadImage",
    "inputs": { "image": "<<SCENE_REF>>" }
  },
  "1u": {
    "class_type": "UNETLoader",
    "inputs": { "unet_name": "minimax_h3_image_pruned_int8_convrot.safetensors", "weight_dtype": "default" }
  },
  "2c": {
    "class_type": "CLIPLoader",
    "inputs": { "clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "type": "minimax", "device": "default" }
  },
  "3v": {
    "class_type": "VAELoader",
    "inputs": { "vae_name": "minimax_h3_image_vae_fp16.safetensors" }
  },
  "30": {
    "class_type": "MiniMaxH3ImageConditioning",
    "inputs": {
      "clip": ["2c", 0], "vae": ["3v", 0], "prompt": "<<PROMPT>>", "width": 2016, "height": 3584,
      "images.image_1": ["1", 0], "images.image_2": ["2", 0]
    }
  },
  "31": {
    "class_type": "ConditioningZeroOut",
    "inputs": { "conditioning": ["30", 0] }
  },
  "35": {
    "class_type": "RandomNoise",
    "inputs": { "noise_seed": <<SEED>> }
  },
  "36": {
    "class_type": "CFGGuider",
    "inputs": { "model": ["1u", 0], "positive": ["30", 0], "negative": ["31", 0], "cfg": 1 }
  },
  "37": {
    "class_type": "BasicScheduler",
    "inputs": { "model": ["1u", 0], "scheduler": "simple", "steps": 6, "denoise": 1 }
  },
  "38": {
    "class_type": "SamplerLCM",
    "inputs": { "s_noise": 1.1, "s_noise_end": 0.9, "noise_clip_std": 0 }
  },
  "39": {
    "class_type": "SamplerCustomAdvanced",
    "inputs": {
      "noise": ["35", 0], "guider": ["36", 0], "sampler": ["38", 0],
      "sigmas": ["37", 0], "latent_image": ["30", 1]
    }
  },
  "33": {
    "class_type": "VAEDecodeTiled",
    "inputs": { "samples": ["39", 0], "vae": ["3v", 0], "tile_size": 768, "overlap": 64, "temporal_size": 64, "temporal_overlap": 8 }
  },
  "9": {
    "class_type": "SaveImage",
    "inputs": { "filename_prefix": "comfy-app/frame-ref", "images": ["33", 0] }
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

/** 内置视频工作流（文生音视频（无输入图，纯提示词直出））。占位符 {"<<PROMPT>>"/"<<LENGTH>>"} 与对应图占位符，同 H3 Flash 四件模型。 */
export const HYPERFLOW_T2V_DEFAULT_WORKFLOW = `{"1":{"class_type":"HyperFlowLoader","inputs":{"unet_name":"minimax_h3_fl2va_hyperflow_flash_14b-Q4_K_M.gguf","weights_in":"auto"}},"2":{"class_type":"CLIPLoader","inputs":{"clip_name":"qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors","type":"minimax","device":"default"}},"3":{"class_type":"VAELoader","inputs":{"vae_name":"minimax_h3_video_vae_fp16.safetensors"}},"4":{"class_type":"VAELoader","inputs":{"vae_name":"minimax_h3_audio_vae_fp32.safetensors"}},"5":{"class_type":"MiniMaxH3ImageToVideo","inputs":{"prompt":"<<PROMPT>>","width":1344,"height":768,"length":"<<LENGTH>>","clip":["2",0],"vae":["3",0]}},"6":{"class_type":"HyperFlowSigmas","inputs":{"steps":6,"model":["1",0]}},"7":{"class_type":"KSamplerSelect","inputs":{"sampler_name":"euler"}},"8":{"class_type":"RandomNoise","inputs":{"noise_seed":42}},"9":{"class_type":"BasicGuider","inputs":{"model":["1",0],"conditioning":["5",0]}},"10":{"class_type":"SamplerCustomAdvanced","inputs":{"noise":["8",0],"guider":["9",0],"sampler":["7",0],"sigmas":["6",0],"latent_image":["5",1]}},"11":{"class_type":"VAEDecode","inputs":{"samples":["10",0],"vae":["3",0]}},"12":{"class_type":"VAEDecodeAudio","inputs":{"samples":["10",0],"vae":["4",0]}},"13":{"class_type":"CreateVideo","inputs":{"fps":24,"bit_depth":"auto","color_space":"sRGB","chroma_subsampling":"auto","codec":"none","images":["11",0],"audio":["12",0]}},"14":{"class_type":"SaveVideo","inputs":{"filename_prefix":"hyperflow/t2v","format":"mp4","codec":"auto","video":["13",0]}}}`;


/** 内置视频工作流（首尾帧控制（<<FRAME>> 首帧 + <<LAST_FRAME>> 尾帧 → 中间过渡））。占位符 {"<<PROMPT>>"/"<<LENGTH>>"} 与对应图占位符，同 H3 Flash 四件模型。 */
export const HYPERFLOW_FLF2V_DEFAULT_WORKFLOW = `{"1":{"class_type":"HyperFlowLoader","inputs":{"unet_name":"minimax_h3_fl2va_hyperflow_flash_14b-Q4_K_M.gguf","weights_in":"auto"}},"2":{"class_type":"CLIPLoader","inputs":{"clip_name":"qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors","type":"minimax","device":"default"}},"3":{"class_type":"VAELoader","inputs":{"vae_name":"minimax_h3_video_vae_fp16.safetensors"}},"4":{"class_type":"VAELoader","inputs":{"vae_name":"minimax_h3_audio_vae_fp32.safetensors"}},"5":{"class_type":"MiniMaxH3ImageToVideo","inputs":{"prompt":"<<PROMPT>>","width":768,"height":1344,"length":"<<LENGTH>>","clip":["2",0],"vae":["3",0],"first_frame":["20",0],"last_frame":["21",0]}},"6":{"class_type":"HyperFlowSigmas","inputs":{"steps":6,"model":["1",0]}},"7":{"class_type":"KSamplerSelect","inputs":{"sampler_name":"euler"}},"8":{"class_type":"RandomNoise","inputs":{"noise_seed":"<<SEED>>"}},"9":{"class_type":"BasicGuider","inputs":{"model":["1",0],"conditioning":["5",0]}},"10":{"class_type":"SamplerCustomAdvanced","inputs":{"noise":["8",0],"guider":["9",0],"sampler":["7",0],"sigmas":["6",0],"latent_image":["5",1]}},"11":{"class_type":"VAEDecode","inputs":{"samples":["10",0],"vae":["3",0]}},"12":{"class_type":"VAEDecodeAudio","inputs":{"samples":["10",0],"vae":["4",0]}},"13":{"class_type":"CreateVideo","inputs":{"fps":24,"bit_depth":"auto","color_space":"sRGB","chroma_subsampling":"auto","codec":"none","images":["11",0],"audio":["12",0]}},"14":{"class_type":"SaveVideo","inputs":{"filename_prefix":"hyperflow/flf2v","format":"mp4","codec":"auto","video":["13",0]}},"20":{"class_type":"LoadImage","inputs":{"image":"<<FRAME>>"}},"21":{"class_type":"LoadImage","inputs":{"image":"<<LAST_FRAME>>"}}}`;


/** 内置视频工作流（角色参考生视频（<<REF1>>/<<REF2>> 定妆照，MiniMaxH3ReferenceToVideo 节点））。占位符 {"<<PROMPT>>"/"<<LENGTH>>"} 与对应图占位符，同 H3 Flash 四件模型。 */
export const HYPERFLOW_REF2V_DEFAULT_WORKFLOW = `{"1":{"class_type":"HyperFlowLoader","inputs":{"unet_name":"minimax_h3_ref2va_hyperflow_flash_14b-Q4_K_M.gguf","weights_in":"auto"}},"2":{"class_type":"CLIPLoader","inputs":{"clip_name":"qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors","type":"minimax","device":"default"}},"3":{"class_type":"VAELoader","inputs":{"vae_name":"minimax_h3_video_vae_fp16.safetensors"}},"4":{"class_type":"VAELoader","inputs":{"vae_name":"minimax_h3_audio_vae_fp32.safetensors"}},"5":{"class_type":"MiniMaxH3ReferenceToVideo","inputs":{"prompt":"<<PROMPT>>","width":768,"height":1344,"length":"<<LENGTH>>","ref_image_size":"match","clip":["2",0],"vae":["3",0],"audio_vae":["4",0],"ref_images.ref_image_0":["20",0],"ref_images.ref_image_1":["21",0]}},"6":{"class_type":"HyperFlowSigmas","inputs":{"steps":6,"model":["1",0]}},"7":{"class_type":"KSamplerSelect","inputs":{"sampler_name":"euler"}},"8":{"class_type":"RandomNoise","inputs":{"noise_seed":"<<SEED>>"}},"9":{"class_type":"BasicGuider","inputs":{"model":["1",0],"conditioning":["5",0]}},"10":{"class_type":"SamplerCustomAdvanced","inputs":{"noise":["8",0],"guider":["9",0],"sampler":["7",0],"sigmas":["6",0],"latent_image":["5",1]}},"11":{"class_type":"VAEDecode","inputs":{"samples":["10",0],"vae":["3",0]}},"12":{"class_type":"VAEDecodeAudio","inputs":{"samples":["10",0],"vae":["4",0]}},"13":{"class_type":"CreateVideo","inputs":{"fps":24,"bit_depth":"auto","color_space":"sRGB","chroma_subsampling":"auto","codec":"none","images":["11",0],"audio":["12",0]}},"14":{"class_type":"SaveVideo","inputs":{"filename_prefix":"hyperflow/ref2v","format":"mp4","codec":"auto","video":["13",0]}},"20":{"class_type":"LoadImage","inputs":{"image":"<<REF1>>"}},"21":{"class_type":"LoadImage","inputs":{"image":"<<REF2>>"}}}`;

/**
 * 内置视频超分工作流：SeedVR2 3B fp8（768×1344 → 1080×1890 短边 1080，保比例）
 *
 * 12GB 显存档：batch_size 5 + temporal_overlap 4 + DiT/VAE cpu offload。
 * 模型两件（models/seedvr2/）：seedvr2_ema_3b_fp8_e4m3fn.safetensors + ema_vae_fp16.safetensors
 * （HF numz/SeedVR2_comfyUI）。占位符：<<VIDEO>>（上传的 mp4）/ <<RESOLUTION>>（短边目标，默认 1080）。
 * 音轨透传：GetVideoComponents 取原片音频回填 CreateVideo——超分不丢声音。
 */
export const SEEDVR2_UPSCALE_DEFAULT_WORKFLOW = `{"18":{"class_type":"LoadVideo","inputs":{"file":"<<VIDEO>>"}},"19":{"class_type":"GetVideoComponents","inputs":{"video":["18",0]}},"15:5":{"class_type":"SeedVR2LoadDiTModel","inputs":{"model":"seedvr2_ema_3b_fp8_e4m3fn.safetensors","attention_mode":"sdpa","blocks_to_swap":0,"cache_model":false,"device":"cuda:0","offload_device":"none","swap_io_components":false}},"15:6":{"class_type":"SeedVR2LoadVAEModel","inputs":{"model":"ema_vae_fp16.safetensors","cache_model":false,"device":"cuda:0","decode_tile_overlap":128,"decode_tile_size":512,"decode_tiled":true,"encode_tile_overlap":128,"encode_tile_size":512,"encode_tiled":true,"offload_device":"none"}},"15:4":{"class_type":"SeedVR2VideoUpscaler","inputs":{"image":["19",0],"dit":["15:5",0],"vae":["15:6",0],"batch_size":5,"color_correction":"lab","enable_debug":false,"input_noise_scale":0,"latent_noise_scale":0,"max_resolution":0,"offload_device":"none","prepend_frames":0,"resolution":"<<RESOLUTION>>","seed":825616700,"temporal_overlap":0,"uniform_batch_size":false}},"16":{"class_type":"CreateVideo","inputs":{"images":["15:4",0],"audio":["19",1],"fps":["19",2],"bit_depth":"auto","codec":"none","color_space":"sRGB","chroma_subsampling":"auto"}},"17":{"class_type":"SaveVideo","inputs":{"video":["16",0],"filename_prefix":"seedvr2/upscale","format":"mp4","codec":"auto"}}}`;

/**
 * H3 三参考工作流（分镜帧最强档）：image_1=特写脸（<<REF>>）+ image_2=正面全身（<<BODY_REF>>）
 * + image_3=场景图（<<SCENE_REF>>）——脸/身体/场景三重锁定；缺正面单图时回退双参考模板。
 * 2026-11-18 实测：三人镜头（第三角色文字锚）在 H3 四参考下脸锁与视线显著优于 2511 三槽方案。
 */
export const MINIMAX_H3_IMAGE_EDIT_TRI_WORKFLOW = `{"1":{"class_type":"LoadImage","inputs":{"image":"<<REF>>"}},"2":{"class_type":"LoadImage","inputs":{"image":"<<SCENE_REF>>"}},"3":{"class_type":"LoadImage","inputs":{"image":"<<BODY_REF>>"}},"1u":{"class_type":"UNETLoader","inputs":{"unet_name":"minimax_h3_image_pruned_int8_convrot.safetensors","weight_dtype":"default"}},"2c":{"class_type":"CLIPLoader","inputs":{"clip_name":"qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors","type":"minimax","device":"default"}},"3v":{"class_type":"VAELoader","inputs":{"vae_name":"minimax_h3_image_vae_fp16.safetensors"}},"30":{"class_type":"MiniMaxH3ImageConditioning","inputs":{"clip":["2c",0],"vae":["3v",0],"prompt":"<<PROMPT>>","width":2016,"height":3584,"images.image_1":["1",0],"images.image_3":["2",0],"images.image_2":["3",0]}},"31":{"class_type":"ConditioningZeroOut","inputs":{"conditioning":["30",0]}},"35":{"class_type":"RandomNoise","inputs":{"noise_seed":"<<SEED>>"}},"36":{"class_type":"CFGGuider","inputs":{"model":["1u",0],"positive":["30",0],"negative":["31",0],"cfg":1}},"37":{"class_type":"BasicScheduler","inputs":{"model":["1u",0],"scheduler":"simple","steps":6,"denoise":1}},"38":{"class_type":"SamplerLCM","inputs":{"s_noise":1.1,"s_noise_end":0.9,"noise_clip_std":0}},"39":{"class_type":"SamplerCustomAdvanced","inputs":{"noise":["35",0],"guider":["36",0],"sampler":["38",0],"sigmas":["37",0],"latent_image":["30",1]}},"33":{"class_type":"VAEDecodeTiled","inputs":{"samples":["39",0],"vae":["3v",0],"tile_size":768,"overlap":64,"temporal_size":64,"temporal_overlap":8}},"9":{"class_type":"SaveImage","inputs":{"filename_prefix":"comfy-app/frame-ref","images":["33",0]}}}`;
