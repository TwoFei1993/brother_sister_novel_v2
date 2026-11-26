# 项目记忆（给 Claude 看的速览）

「兄妹小说 V3」：酒馆式双模式小说 + 短剧的 AI 创作站。整体介绍与目录结构见 `v3/README.md`。
代码在 `v3/`（pnpm workspace）：`client`（React 19 + Vite + Tailwind 4，提示词引擎在 `client/src/engine/`）、`server`（Express，开发端口 3001）、`shared`（前后端共享的 TS 类型与 zod schema）。根目录的旧版 V2 站偶尔才同步，功能都做在 `v3/`。安卓 App 是 WebView 壳，网站更新即生效。

## 怎么跑（一律走 `v3/scripts/` 下的 .sh，不直接敲 pnpm / npm）

| 目的 | 命令 |
| --- | --- |
| 前后端一起起 | `bash v3/scripts/dev.sh` |
| 只起前端（后端 3001 已在跑） | `bash v3/scripts/dev-client.sh` |
| 三包类型检查 | `bash v3/scripts/typecheck.sh` |
| 单包测试（可带过滤串） | `bash v3/scripts/test-pkg.sh client\|server\|shared [过滤串…]` |
| 全量测试 | `bash v3/scripts/test.sh` |
| 生产构建 | `bash v3/scripts/build.sh` |
| 看某本书最终发给模型的提示词 | `bash v3/scripts/probe-prompt.sh <workId> [关键词…]` |
| 本地生图引擎 | `comfy-start.sh` / `comfy-stop.sh` / `comfy-status.sh` |

运行时数据在 `v3/data/`（不入库；`secrets.json` 里是密钥，不要打印），日志统一在 `v3/logs/`。

## 这里的规矩

- **常有多个会话同时改 `v3/`。** 动手前先看 `git status` 和 `git log`；提交只 `git add` 明确路径，不带别人的在途改动；不启动 / 不杀不是自己起的服务（后端 3001、引擎 8188）。
- **服务端请求体是严格校验的**（zod `strictObject`）：新增字段要同步改 `shared` 里的 schema，内部对象不要整个当请求体传。
- **校验 schema 统一放 `shared`**：只有 `server` 和 `shared` 依赖 zod，`client` 不依赖——前端要用校验规则就 import `@shared/…` 里导出的 schema，不要在 `client/src` 里写 `import { z } from 'zod'`（主工作区里也许能过，干净安装后 CI 会挂）。
- **主工作区类型检查通过不代表 CI 能过。** 工作区常混着别人未提交的改动和残留依赖；推送前用「只含自己暂存内容」的隔离检出验证一遍（做法见 `discuss/2026-11-26-短剧试验台与分集剧本实施计划.md` 的执行记录）。
- **数据模型优先强类型**；单文件不超过 300 行，每层目录不超过 8 个条目。
- **本地引擎（ComfyUI）空闲时才能用来测试**——先确认队列是空的、别的会话没在用。花钱的云端调用不自动跑。
- 推送前确认待推内容自洽（混着别人未提交的改动时尤其要单独检出验证）；推送后确认 `docker-publish` 这个 workflow 成功，并向用户说明服务器是否已拉取。
- 正式文档写 `v3/docs/`，讨论稿与设计写根目录 `discuss/`，一律中文。

## 入门读物

- `v3/README.md`
- `v3/docs/短剧功能说明.md`、`v3/docs/短剧试验台与分集剧本说明.md`
- `discuss/` 下按日期命名的设计共识与实施计划
