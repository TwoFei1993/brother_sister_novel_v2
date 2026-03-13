# 使用 node 基础镜像
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 安装依赖（包含 ffmpeg）
RUN apk add --no-cache ffmpeg

# 复制 package.json
COPY package.json ./

# 安装依赖（使用 npm）
RUN npm install

# 复制源代码
COPY src/ ./src/

# 直接使用 tsx 运行，不需要构建
ENV NODE_ENV=production
EXPOSE 3000

# 使用 tsx 直接运行
CMD ["npx", "tsx", "src/server.ts"]
