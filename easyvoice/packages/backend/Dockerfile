# 使用更精简的基础镜像
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm

# 复制包管理文件
COPY package.json tsconfig.json ./

# 安装依赖
RUN pnpm install

# 复制源代码
COPY src/ ./src/

# 构建项目
RUN pnpm run build

# 安装 ffmpeg
RUN apk add --no-cache ffmpeg

ENV NODE_ENV=production
EXPOSE 3000

# 启动命令
CMD ["pnpm", "start"]
