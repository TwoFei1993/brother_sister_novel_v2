# 使用更精简的基础镜像
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm

# 复制包管理文件
COPY package.json tsconfig.json ./

# 安装依赖（不使用 frozen-lockfile，因为没有 lock 文件）
RUN pnpm install

# 复制源代码
COPY src/ ./src/

# 构建项目
RUN pnpm run build

# 多阶段构建 - 生产镜像
FROM node:20-alpine AS production

WORKDIR /app

RUN apk add --no-cache ffmpeg

# 安装 pnpm
RUN npm install -g pnpm

COPY package.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public  ./public

RUN pnpm install --prod

ENV NODE_ENV=production
EXPOSE 3000

# 使用非 root 用户运行
USER node

# 启动命令
CMD ["pnpm", "start"]

HEALTHCHECK --interval=30s --timeout=3s \
    CMD curl --fail http://localhost:3000/health || exit 1