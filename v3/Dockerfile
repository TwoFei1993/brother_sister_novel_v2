# 兄妹小说工坊 v3 —— 多阶段生产镜像
#
# 阶段一 builder   ：node:20-alpine + corepack/pnpm，全量 install 后构建
#                    （server tsc 类型校验产物 + client vite → server/public 同源托管目录）
# 阶段二 prod-deps ：仅安装 server/shared 的生产依赖（运行时 tsx 直跑 TS 源码所需）
# 阶段三 runner    ：node:20-alpine，只拷运行必需子集，CMD 与 scripts/deploy.sh 一致
#
# 本地验证（Windows Git Bash，在 v3/ 下执行）：
#   docker build -t novel-workshop-v3 .
#   docker run --rm -p 3011:3001 -e ACCESS_PASSWORD=dockertest -v novel-v3-data:/app/data novel-workshop-v3
#   curl http://localhost:3011/api/health    # storage:ok 即数据卷可用；tts/llm 未配置属预期
#
# 数据目录：容器内固定 /app/data（DATA_DIR），须挂卷持久化；日志 /app/logs（LOG_DIR）。

# syntax=docker/dockerfile:1

# ---------- 阶段一：全量构建 ----------
FROM node:20-alpine AS builder
WORKDIR /app

# pnpm 版本与 lockfile 对齐（lockfileVersion 9.0），corepack 免全局安装
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# 先拷 manifest 装依赖（层缓存：源码变更不重装依赖）
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 再拷源码全量构建：pnpm -r build = client vite（→ server/public）+ server tsc（类型校验）
COPY tsconfig.base.json ./
COPY client ./client
COPY server ./server
COPY shared ./shared
RUN pnpm -r build

# ---------- 阶段二：生产依赖 ----------
FROM node:20-alpine AS prod-deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json

# server 运行时直引 shared TS 源码（tsx + tsconfig paths，不经包名导入），
# 故 shared 及其 zod 依赖必须一并安装
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @v3/server --filter @v3/shared

# ---------- 阶段三：运行 ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/data \
    LOG_DIR=/app/logs

# server：TS 源码（tsx 直跑）+ manifest + tsconfig（tsx 据此解析 @shared/* 路径）
COPY --from=builder /app/server/src /app/server/src
COPY --from=builder /app/server/public /app/server/public
COPY --from=builder /app/server/package.json /app/server/package.json
COPY --from=builder /app/server/tsconfig.json /app/server/tsconfig.json

# shared：被 server 直引的 TS 源码
COPY --from=builder /app/shared/src /app/shared/src
COPY --from=builder /app/shared/package.json /app/shared/package.json

# 内置资源库（/api/io/resources/* 索引与 builtin 拉取）
COPY resources ./resources

# workspace 根：pnpm 依赖布局（symlink 结构三层都在 /app 下，相对关系保持）
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/server/node_modules /app/server/node_modules
COPY --from=prod-deps /app/shared/node_modules /app/shared/node_modules
COPY tsconfig.base.json pnpm-workspace.yaml package.json ./

EXPOSE 3001
# 声明数据卷语义；Zeabur/本地 run 按此路径挂载持久卷
VOLUME ["/app/data", "/app/logs"]

# 容器级探活：仅证明进程存活（/api/health 恒 200，业务红绿看返回体）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3001}/api/health" >/dev/null || exit 1

# 与 scripts/deploy.sh 同一启动方式：cwd=server，tsx 直跑 TS 源码
WORKDIR /app/server
CMD ["node", "--import", "tsx", "src/main.ts"]
