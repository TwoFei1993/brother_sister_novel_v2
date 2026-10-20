import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      '/api/v1/tts': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  // 依赖扫描只认真正的入口：默认会爬根下所有 *.html，把 酒馆代码/（vendored SillyTavern，
  // 依赖未安装）的页面也拉进来导致 dev 启动报「依赖无法解析」
  optimizeDeps: {
    entries: ["index.html"],
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "pwa-icon-192.png", "pwa-icon-512.png"],
      manifest: {
        name: "异界兄妹 - AI长篇小说写作平台",
        short_name: "异界兄妹",
        description: "AI驱动的长篇类型小说自动写作平台",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          {
            src: "/pwa-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // 酒馆代码/ 是参考用的 vendored SillyTavern（数千文件、依赖未安装），
        // 不属于本应用产物——glob 必须排除，否则 dev 依赖扫描报警、生产预缓存爆体积
        globIgnores: ["**/酒馆代码/**"],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
