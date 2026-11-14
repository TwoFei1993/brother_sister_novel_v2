# 聂小倩 EP1 端到端实拍驱动（2026-11-14，内存墙暂停待续）

## 用法（改天机器空闲时续拍）
```bash
cd v3/client && bash ../scripts/comfy-start.sh &   # 引擎
npx tsx ../scripts/e2e-nie/nie2-media.ts            # 媒体段续拍（全部幂等，已有资产秒跳）
```
workId 在 `v3/client/scripts-e2e/nie-state.json`（文本段已全部完成：12 镜/5 角色/6 场景已入库）。
脚本需在 client/ 下运行（相对路径 + nie-lib 的 SERVER 指向 3001）。

## 当日战况
- 文本链 100%：剧本→拆解→12 镜（机检零警）→5 角色（含 lockPhrase）→6 场景
- 媒体资产：5 角色定妆照×2 + 6 场景图已归档（Z-Image）
- 卡点：整机 commit 内存 86%（UnrealEditor+Chrome+多会话），引擎连 Z-Image 都无法存活
- 帧通道当前为 Z-Image 降级版；内存宽裕后可把 nie2-media.ts 帧循环的 ref 参数加回（2511 三参考）

## 当日环境修复清单（已永久生效）
1. AICG3D-SKILLS discover() 加缓存（object_info 饿死 bug，2-3s→0.002s）
2. ComfyUI-Manager channel_url=local（离线）
3. comfy-start.sh：--disable-dynamic-vram（aimdo 20G 模型加载崩溃）；sage 暂退（tcc 编译失败）
4. rag-system 已关停（无自启动项，不会再自动打开）
