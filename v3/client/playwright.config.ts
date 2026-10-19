/**
 * E2E 冒烟配置（Task 36）：三个进程由 webServer 数组统一编排，测试前全部就绪。
 *
 * - mock-llm（:3100）：OpenAI 兼容假上游；cwd 指到 v3/ 根，请求捕获日志落 v3/logs/（已 gitignore）
 * - server（:3001）：dev 模式；env 注入 ACCESS_PASSWORD + DATA_DIR 指向临时目录（每轮干净库）
 * - client（:5173）：vite dev，/api 代理到 3001
 *
 * globalSetup 先于 webServer 执行：清理临时 DATA_DIR 并预置 data/secrets.json，
 * 把 openai 通道 baseUrl 指向 mock-llm（前端默认通道即 openai，零 UI 配置直通假上游）。
 * reuseExistingServer 全部关闭：端口被占（如开发者自己的 dev 环境）时宁可失败也不测错环境。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url)); // v3/client
const v3Root = resolve(here, '..');
/** 每轮测试专用数据目录（globalSetup 清空重建并预置 secrets） */
export const E2E_DATA_DIR = resolve(here, '.e2e-data');

export default defineConfig({
  testDir: resolve(here, 'e2e'),
  globalSetup: resolve(here, 'e2e/global-setup.ts'),
  // 冒烟是单文件串行流程（登录→建作品→生成→…），单 worker 保证顺序与状态衔接
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/mock-llm.mjs',
      cwd: v3Root,
      port: 3100,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm dev',
      cwd: resolve(v3Root, 'server'),
      url: 'http://127.0.0.1:3001/api/ping',
      reuseExistingServer: false,
      env: { ...process.env, ACCESS_PASSWORD: 'e2etest', DATA_DIR: E2E_DATA_DIR },
    },
    {
      // --host：本机 vite 默认仅绑 ::1（IPv6 回环），统一绑全地址供 127.0.0.1 轮询；
      // --strictPort：端口被占直接失败，避免 vite 静默漂移到 5174 让就绪探测空等
      command: 'pnpm exec vite --host --strictPort',
      cwd: here,
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
    },
  ],
});
