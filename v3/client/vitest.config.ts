/// <reference types="vitest/config" />
// Vitest 独立配置：jsdom 环境（DOM 类测试）
// css.postcss 空配置与 vite.config.ts 同理——阻断向上层目录解析到旧站 Tailwind 3 postcss 配置
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {},
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
