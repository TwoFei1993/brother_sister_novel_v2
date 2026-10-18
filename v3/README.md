# 兄妹小说 V3（酒馆化改版）

酒馆式双模式小说系统的 monorepo 工程。前端组装提示词（纯函数引擎）+ Express 薄代理（协议转换与密钥）+ JSON 文件存储；React 19 SPA 与 API 同源部署。

## 目录结构

```
v3/
├─ client/    # React 19 + Vite + Tailwind 4 前端（提示词引擎在 src/engine/）
├─ server/    # Node + Express + TS 服务端（开发端口 3001）
├─ shared/    # 前后端共享 TS 类型与 zod schema（@v3/shared）
├─ scripts/   # 全部启停/构建/测试/备份/部署脚本（bash）
├─ data/      # 运行时数据（gitignore，仅 .gitkeep 入库）
└─ logs/      # 日志输出（gitignore，仅 .gitkeep 入库）
```

## 快速开始

```bash
cd v3
bash scripts/dev.sh   # 首次运行会自动 pnpm install
```

- 前端：http://localhost:5173 （`/api` 已代理到 3001）
- 后端探活：http://localhost:3001/api/ping → `{"ok":true}`
- `Ctrl+C` 同时退出前后端。

## 常用命令（package.json scripts 全部委托到 scripts/*.sh）

| 命令 | 脚本 | 说明 |
| --- | --- | --- |
| `bash scripts/dev.sh` | dev | 并发启动 server(tsx watch)+client(vite) |
| `bash scripts/build.sh` | build | server tsc → dist/；client vite build → server/public/ |
| `bash scripts/test.sh` | test | 全 workspace vitest run（无测试的包自动跳过） |
| `bash scripts/backup.sh` | backup | data/ 打包为 backups/backup-<时间戳>.tar.gz |
| `bash scripts/deploy.sh` | deploy | 构建 + 生产模式启动 server（Zeabur/Docker 入口） |

## 文档指引

- 设计总纲（唯一权威）：`../docs/酒馆化改版设计.md`
- 实施计划与任务清单：`../docs/plans/2026-10-19-酒馆化改版实施计划.md`
- 部署指南（Task 35 产出）：`docs/部署指南.md`（环境变量清单、Zeabur 步骤、备份恢复）
