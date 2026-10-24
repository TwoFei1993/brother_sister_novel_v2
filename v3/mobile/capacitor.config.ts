/**
 * Capacitor 配置（安卓壳）：WebView 直接加载已部署的 v3 服务 URL。
 *
 * - 服务地址经环境变量 CAP_SERVER_URL 注入（构建期读取，见 scripts/mobile.sh）：
 *   生产指向 Zeabur 部署地址；联调可指向局域网 dev server（http://192.168.x.x:5173，
 *   dev 模式 vite 监听 0.0.0.0 需在 client vite.config 配置 host）。
 * - 不打包静态资产进 APK（webDir 仅指向一个占位页）：数据/鉴权/LLM 代理全部在服务端，
 *   APK 只负责全屏 WebView 壳，更新网站即更新 app，无需发版。
 */
import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.CAP_SERVER_URL ?? 'http://10.0.2.2:5173';

const config: CapacitorConfig = {
  appId: 'com.siblings.novel',
  appName: '兄妹小说',
  webDir: 'www',
  server: {
    url: serverUrl,
    cleartext: true, // 允许 http（联调期；生产 https 自动不受影响）
  },
};

export default config;
