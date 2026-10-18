// Vite 配置：
//  - Tailwind 4 采用 CSS-first（无 tailwind.config，样式入口见 src/index.css）
//  - 开发期 /api 代理到本地 server(3001)，生产同源部署（零硬编码后端地址）
//  - 构建产物输出到 server/public/，由 Express 同源托管
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @shared/* 直引 shared TS 源码（与 tsconfig.base paths 语义一致，Task 10 起前端消费共享类型）
  resolve: {
    alias: [
      {
        find: '@shared',
        replacement: fileURLToPath(new URL('../shared/src', import.meta.url)),
      },
    ],
  },
  // 内联空 postcss 配置：阻断 vite 向上层目录查到旧站的 Tailwind 3 postcss 配置
  css: {
    postcss: {},
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
});
