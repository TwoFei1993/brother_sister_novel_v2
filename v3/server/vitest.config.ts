// @v3/server 测试配置：node 环境、无 setup。
// 必须显式声明，否则 vitest 会向上查找到旧站根目录的 vitest.config.ts
// （其 setupFiles 指向不存在的文件导致误报失败）。
// resolve.alias：vitest 不读 tsconfig paths，手动映射 @shared/* 到 shared 源码
// （与 tsconfig.base.json 的 paths 保持一致；tsx/tsc 走 paths，vitest 走这里）。
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
