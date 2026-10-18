// Vite 配置：
//  - Tailwind 4 采用 CSS-first（无 tailwind.config，样式入口见 src/index.css）
//  - 开发期 /api 代理到本地 server(3001)，生产同源部署（零硬编码后端地址）
//  - 构建产物输出到 server/public/，由 Express 同源托管
//  - PWA（Task 33）：autoUpdate 注册 + manifest（小说工坊/standalone/portrait）+ 离线壳
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: '小说工坊',
        short_name: '小说工坊',
        description: '兄妹题材 AI 小说创作工坊：书架 / 写作台 / 听书',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // 默认暗色基调（index.css :root --bg ≈ #0c0c0e）
        background_color: '#0c0c0e',
        theme_color: '#0c0c0e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // SPA 离线壳：导航请求回落 index.html（App shell 已缓存可离线打开）
        navigateFallback: 'index.html',
        // API 请求绝不走离线壳回落
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
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
